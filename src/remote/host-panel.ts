/** Presenter's phone panel: every control writes a `ctl`/`cue`/`poll` message; the big screen applies it. */
import type { ClientMessage, PollState, PresenterControls, PresenterState } from '../contracts/net';
import { initialState } from '../contracts/store';
import { h } from '../ui/dom';
import { AMPLIFY, CAMERA_CUES, SECTIONS, SPEEDS, VEHICLES, VIEWS, suspensionForOption, suspensionPoll, vehicleOf } from './catalogue';
import { card, pollRows, segmented, shares, toggle, votesText } from './widgets';

const START = initialState();

export interface HostPanel {
  readonly el: HTMLElement;
  ctl(state: PresenterState): void;
  poll(poll: PollState | null): void;
}

export function createHostPanel(send: (message: ClientMessage) => void): HostPanel {
  let ctl: PresenterState = { seq: 0 };
  let poll: PollState | null = null;

  const set = (patch: PresenterControls) => {
    ctl = { ...ctl, ...patch }; // optimistic; the room's broadcast confirms with a new seq
    render();
    send({ t: 'ctl', set: patch });
  };

  const vehicle = segmented('Araç', VEHICLES, (id) => {
    const v = vehicleOf(id);
    set({ vehicleId: v.id, suspensionId: v.suspensions[0]!.id });
  });
  const suspensionSlot = h('div');
  let suspension = segmented('Süspansiyon', vehicleOf(undefined).suspensions, (id) => set({ suspensionId: id }));
  let suspensionFor = '';
  const view = segmented('Görünüm', VIEWS, (id) => set({ view: id }));
  const speed = segmented('Hız', SPEEDS, (id) => set({ timeScale: id }));
  const xray = toggle('Röntgen', 'Bağlantıları görün', (on) => set({ xray: on }));
  const amplify = toggle('Büyüt', `Hareket ×${AMPLIFY}, ekranda belirtilir`, (on) => set({ amplification: on ? AMPLIFY : 1 }));
  const attract = toggle('Tanıtım', 'Otomatik gösterim', (on) => set({ attract: on }));
  const lines = toggle('Katmanlar', 'Yalpa merkezleri, yükler', (on) => set({ overlay: on ? 'engineer' : 'clean' }));

  const sectionButtons = SECTIONS.map((s) => {
    const b = h('button', { type: 'button', class: 'rm-chip', 'aria-pressed': 'false' }, h('span', {}, s.label), h('span', { class: 'rm-chip-sub' }, 'Tekrar oynat'));
    b.addEventListener('click', () => (ctl.section === s.id ? send({ t: 'cue', cue: 'replay-section' }) : set({ section: s.id })));
    return [s.id, b] as const;
  });
  const cueButtons = CAMERA_CUES.map((c) => {
    const b = h('button', { type: 'button', class: 'rm-button' }, c.label);
    b.addEventListener('click', () => send({ t: 'cue', cue: c.id }));
    return b;
  });

  const pollBody = h('div', { class: 'rm-poll-body' });

  const el = h(
    'div',
    { class: 'rm-panel' },
    card('Araç', vehicle.el),
    card('Süspansiyon', suspensionSlot),
    card('Görünüm', view.el, h('div', { class: 'rm-grid' }, xray.el, lines.el)),
    card('Hareket', speed.el, h('div', { class: 'rm-grid' }, amplify.el, attract.el)),
    card('Kamera', h('div', { class: 'rm-grid' }, ...cueButtons)),
    card('Pist bölümü', h('p', { class: 'rm-note' }, 'Otomobili bir bölüme taşıyın. Yeniden oynatmak için tekrar dokunun.'), h('div', { class: 'rm-chips' }, ...sectionButtons.map(([, b]) => b))),
    card('İzleyici anketi', pollBody),
  );

  function renderPoll(): void {
    const ask = () => send({ t: 'poll', poll: suspensionPoll(ctl.vehicleId) });
    const button = (label: string, onClick: () => void, primary = false) => {
      const b = h('button', { type: 'button', class: primary ? 'rm-button rm-primary' : 'rm-button' }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    if (!poll) {
      const preview = suspensionPoll(ctl.vehicleId);
      pollBody.replaceChildren(
        h('p', { class: 'rm-poll-q' }, preview.question),
        h('p', { class: 'rm-note' }, `${preview.options.join(' · ')}. Sonuç çubukları büyük ekranda canlı görünür.`),
        button('Anketi aç', ask, true),
      );
      return;
    }
    const s = shares(poll.counts);
    const head = h('p', { class: 'rm-poll-q' }, poll.question);
    const meta = h('p', { class: 'rm-note' }, `${poll.open ? 'Canlı' : 'Kapandı'} · ${votesText(s.total)}`);
    const rows = pollRows(poll.options, poll.counts, null, null);
    if (poll.open) {
      pollBody.replaceChildren(head, meta, rows, button('Anketi kapat', () => send({ t: 'poll', poll: null }), true));
      return;
    }
    const winner = s.leader === null ? null : poll.options[s.leader]!;
    const winnerId = winner ? suspensionForOption(ctl.vehicleId, winner) : null;
    pollBody.replaceChildren(
      head,
      meta,
      rows,
      h(
        'div',
        { class: 'rm-grid' },
        winnerId ? button(`${winner} ile dene`, () => set({ suspensionId: winnerId }), true) : null,
        button('Yeni anket', ask, !winnerId),
        button('Ekrandan kaldır', () => send({ t: 'poll', poll: null }), false),
      ),
    );
  }

  function render(): void {
    // Fields the presenter has not set yet show the app's start state (contracts/store initialState).
    const v = vehicleOf(ctl.vehicleId);
    vehicle.set(v.id);
    if (suspensionFor !== v.id) {
      suspensionFor = v.id;
      suspension = segmented('Süspansiyon', v.suspensions, (id) => set({ suspensionId: id }));
      suspensionSlot.replaceChildren(suspension.el);
    }
    suspension.set(ctl.suspensionId ?? (v.id === START.vehicleId ? START.suspensionId : v.suspensions[0]!.id));
    view.set(ctl.view ?? START.view);
    speed.set(ctl.timeScale ?? START.timeScale);
    xray.set(ctl.xray);
    lines.set(ctl.overlay === 'engineer');
    amplify.set((ctl.amplification ?? 1) > 1);
    attract.set(ctl.attract);
    for (const [id, b] of sectionButtons) b.setAttribute('aria-pressed', String(ctl.section === id));
    renderPoll();
  }

  render();
  return {
    el,
    ctl(state) {
      if (state.seq < ctl.seq) return;
      ctl = state;
      render();
    },
    poll(next) {
      poll = next;
      renderPoll();
    },
  };
}
