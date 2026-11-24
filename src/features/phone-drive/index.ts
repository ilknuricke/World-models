/**
 * Phone driver, big screen side (plan 12-04; ARCHITECTURE-M2 §12.3; research m2/17). `?screen=1` only, never in e2e
 * mode: a "Drive from your phone" card with a QR to `/remote.html?room=CODE#d=<driverKey>` (the key only in the
 * fragment), the DRIVE source `'phone'` fed by the room's `in` frames (so the drive feature's arbitration, takeover
 * edges, conditioning and aids all apply), the failsafe (decay after 250 ms, Returning after 1 s or when the room
 * reports the driver gone, with a note), a link badge, the honest "Driven from a phone" line, and `tel` back to the
 * phone at about 5 Hz. Without a room, a driver key or a driver, it shows nothing and its source stays neutral.
 */
import type { DriveIntent } from '../../contracts/drive';
import type { FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import { REMOTE_PAGE } from '../../contracts/net';
import { DRIVE, ROOM } from '../../contracts/services';
import { h, mount } from '../../ui/dom';
import { createPhoneLink, deliberate, LINK, linkLevel, telFrame, type LinkLevel, type LinkOutput, type LinkPhase } from './link';
import './phone-drive.css';

/** `tel` spacing, s: just over 1/5 s so the room's 5/s bucket (burst 5) never drops one. */
const TEL_S = 0.21;
/** A driver counts as present this long after its last frame (presence is coalesced to 1 Hz). */
const PRESENT_MS = 2000;
/** The worst link level is held this long so the badge does not flicker, ms. */
const LEVEL_HOLD_MS = 1000;
const TOAST_S = 6;
/** Beyond this distance from the driving line a failsafe hand-back is an immediate release (drive/handback.ts). */
const LOOP_NEAR = 40;

const LEVEL_WORD: Readonly<Record<LinkLevel, string>> = { ok: 'İyi bağlantı', amber: 'Yavaş bağlantı', red: 'Zayıf bağlantı' };
const LEVEL_RANK: Readonly<Record<LinkLevel, number>> = { ok: 0, amber: 1, red: 2 };

let frameHandler: ((frame: FrameInfo) => void) | undefined;

function init(ctx: FeatureContext): void {
  if (!ctx.flags.screen || ctx.flags.e2e) return; // e2e: no network room (§6.6)
  const { store, bus } = ctx;
  const room = ctx.services.get(ROOM);
  const drive = ctx.services.get(DRIVE);
  const link = createPhoneLink();
  const out: LinkOutput = { steer: 0, throttle: 0, brake: 0, handbrake: 0, wanted: false };
  let phase: LinkPhase = 'idle';
  let drivers = 0;
  let ageAtArrival = 0;

  // ---------------------------------------------------------------- the 'phone' intent source
  const source = {
    id: 'phone' as const,
    read(intent: DriveIntent): boolean {
      const d = ctx.sim.frame.drive;
      phase = link.sample(performance.now(), Math.hypot(d.u, d.v) > 1, out);
      intent.steer = out.steer;
      intent.throttle = out.throttle;
      intent.brake = out.brake;
      intent.handbrake = out.handbrake;
      intent.digital = false;
      intent.source = 'phone';
      return deliberate(out);
    },
  };
  ctx.addDisposer(drive.addSource(source));

  let wantedBefore = false;
  ctx.addDisposer(
    room.on('in', (m) => {
      const now = performance.now();
      if (!link.receive(m, now)) return;
      // room → screen transit (clocks synced); before the first sync only the silence counts
      ageAtArrival = ctx.clock.synced ? Math.max(0, ctx.clock.serverNow() - m.r) : 0;
      const wanted = (m.f & LINK.flagWanted) !== 0;
      if (wantedBefore && !wanted) handBack(false); // the phone's "Hand back"
      wantedBefore = wanted;
    }),
  );
  const onPresence = (n: number | undefined) => {
    const next = n ?? 0;
    if (drivers > 0 && next === 0) link.drop(); // the phone's socket closed: no need to wait for the silence
    drivers = next;
  };
  ctx.addDisposer(room.on('welcome', (m) => (onPresence(m.presence.drivers), render())));
  ctx.addDisposer(room.on('presence', (m) => onPresence(m.drivers)));

  // ---------------------------------------------------------------- hand-back (failsafe or the phone asked)
  let annexOf: unknown = null;
  let annex: ReadonlySet<string> = new Set();
  const handBack = (lost: boolean) => {
    if (store.get().driveMode !== 'manual' || drive.activeSource !== 'phone') return;
    const def = ctx.sim.current.world?.def ?? null;
    if (def !== annexOf) {
      annexOf = def;
      annex = new Set(def ? [...def.zones.map((z) => z.id), 'field'] : []);
    }
    const d = ctx.sim.frame.drive;
    const onLoop = !annex.has(d.zone) && Math.abs(d.lineOffset) <= LOOP_NEAR;
    bus.emit('drive:request', onLoop ? { mode: 'auto' } : { mode: 'auto', immediate: true });
    if (lost) toast(onLoop ? 'Otomobil tura dönüyor.' : 'Otomobil tura döndü.');
  };

  // ---------------------------------------------------------------- DOM: the card and the note
  const title = h('span', { class: 'sl-phone-drive-title sl-label' }, 'Telefonunuzdan sürün');
  const fold = h('button', { class: 'sl-phone-drive-fold', type: 'button', 'aria-expanded': 'true' }, 'Gizle');
  const qr = h('div', { class: 'sl-phone-drive-qr' });
  const body = h(
    'div',
    { class: 'sl-phone-drive-body' },
    qr,
    h(
      'div',
      { class: 'sl-phone-drive-meta' },
      h('p', { class: 'sl-phone-drive-lead' }, 'Telefon kamerasıyla tarayın'),
      h('p', { class: 'sl-phone-drive-note' }, 'Direksiyon gibi tutun: sürgü ve pedalları kullanın; isterseniz eğerek yön verin. Aynı anda tek sürücü.'),
    ),
  );
  const dot = h('span', { class: 'sl-phone-drive-dot', 'aria-hidden': 'true' });
  const statusText = h('span', { class: 'sl-phone-drive-status-text' });
  const linkWord = h('span', { class: 'sl-phone-drive-link' });
  const status = h('div', { class: 'sl-phone-drive-status', role: 'status' }, dot, statusText, linkWord);
  const root = h(
    'section',
    { class: 'sl-phone-drive', 'aria-label': 'Telefonunuzdan sürün', hidden: true },
    h('header', { class: 'sl-phone-drive-head' }, title, fold),
    body,
    status,
  );
  const toastText = h('span');
  const toastEl = h(
    'div',
    { class: 'sl-phone-drive-toast', role: 'status', 'aria-live': 'polite', hidden: true },
    h('span', { class: 'sl-phone-drive-toast-title' }, 'Telefon kumandasıyla bağlantı kesildi'),
    toastText,
  );
  ctx.addDisposer(mount(ctx.dom.overlay, root));
  ctx.addDisposer(mount(ctx.dom.overlay, toastEl));

  let folded = false;
  let rendered = '';
  let toastS = 0;
  function toast(text: string): void {
    toastText.textContent = text;
    toastEl.hidden = false;
    toastS = TOAST_S;
  }
  function render(): void {
    const code = room.code;
    const key = room.driverKey ?? null;
    if (!code || !key) return;
    const target = `${location.origin}${REMOTE_PAGE}?room=${code}#d=${key}`;
    if (target === rendered) return;
    rendered = target;
    // the QR encoder (uqr) only loads on a big screen that has a driver key
    void import('./qr').then(({ qrSvg }) => rendered === target && qr.replaceChildren(qrSvg(target, `QR kodu: ${code} odasında telefonunuzdan sürün`)));
  }
  fold.addEventListener('click', (e) => {
    if (e.detail > 0) fold.blur();
    folded = !folded;
    root.toggleAttribute('data-folded', folded);
    fold.setAttribute('aria-expanded', String(!folded));
    fold.textContent = folded ? 'Kodu göster' : 'Gizle';
  });

  // ---------------------------------------------------------------- per frame: phases, badge, tel, card state
  const shown = { state: '', level: '' as LinkLevel | '', visible: false, text: '' };
  let telS = 0;
  let bits = 0;
  let worst: LinkLevel = 'ok';
  let worstUntil = 0;
  let lastPhase: LinkPhase = 'idle';
  ctx.on('drive:event', (e) => {
    if (e.kind === 'strike') bits |= 1;
    else if (e.kind === 'slide') bits |= 2;
  });

  frameHandler = ({ dt, t }) => {
    const now = performance.now();
    const present = drivers > 0 || now - link.lastArrival < PRESENT_MS;
    const mode = store.get().driveMode;
    const phoneDriving = mode === 'manual' && drive.activeSource === 'phone';

    if (phase === 'lost' && (lastPhase === 'live' || lastPhase === 'decay')) handBack(true);
    lastPhase = phase;

    // link badge: room → screen transit plus the silence since the last frame; worst level held for a second
    const age = phase === 'idle' || phase === 'lost' ? Infinity : ageAtArrival + link.silentMs;
    const level = linkLevel(age);
    if (LEVEL_RANK[level] >= LEVEL_RANK[worst] || now > worstUntil) {
      worst = level;
      worstUntil = now + LEVEL_HOLD_MS;
    }

    // tel to the phone (only while one is there): speed, gear, mode, haptic bits since the last frame
    telS -= dt;
    if (present && room.connected && telS <= 0) {
      telS = TEL_S;
      const d = t.drive;
      const driving = mode === 'manual' || mode === 'returning';
      room.send(telFrame(driving ? Math.hypot(d.u, d.v) : t.speed, driving ? d.gear : 0, mode, phoneDriving ? bits : 0));
      bits = 0;
    }

    if (toastS > 0) {
      toastS -= dt;
      if (toastS <= 0) toastEl.hidden = true;
    }

    // the card
    const s = store.get();
    const visible = rendered !== '' && room.connected && s.hudVisible && !s.attract && ctx.sim.current.drive?.available === true;
    if (visible !== shown.visible) root.hidden = !(shown.visible = visible);
    if (!visible) return;
    const state = phoneDriving ? 'driving' : present && phase !== 'lost' ? 'paired' : 'waiting';
    if (state !== shown.state) {
      shown.state = state;
      root.dataset['state'] = state;
      if (state === 'paired' && !folded) fold.click(); // the code steps aside once a phone is there
      if (state === 'waiting' && folded) fold.click();
    }
    const text = state === 'driving' ? 'Telefondan kontrol ediliyor' : state === 'paired' ? (mode === 'returning' ? 'Telefon bağlı · tura dönülüyor' : 'Telefon bağlı · sürmek için Gaza basın') : 'Telefon bekleniyor';
    if (text !== shown.text) statusText.textContent = shown.text = text;
    const lv: LinkLevel | '' = state === 'waiting' ? '' : worst;
    if (lv !== shown.level) {
      shown.level = lv;
      root.dataset['link'] = lv;
      linkWord.textContent = lv ? LEVEL_WORD[lv] : '';
    }
  };
  ctx.addDisposer(() => (frameHandler = undefined));
  render();
}

export default {
  id: 'phone-drive',
  requires: ['drive', 'live-lab'],
  phase: 'overlay',
  init,
  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
