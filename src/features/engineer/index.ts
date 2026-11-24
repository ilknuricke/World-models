/**
 * AI Race Engineer panel (ARCHITECTURE §12.5, plan 06-02): a small "Ask the engineer" affordance with three
 * section-dependent question chips and "Why did it do that?". Sends a compact telemetry snapshot to
 * POST /api/engineer, shows the answer as a caption card (textContent only) and executes whitelisted actions
 * through the store and bus. Offline / busy / error -> the local rule-based answer, labelled as such.
 * While the visitor drives (12-03, ARCH-M2 §12.4) the payload carries the `drive` block: the detected event (bus
 * 'drive:event', wheel lift / bump stop, a swap) with a snapshot captured at its moment and the inputs just before it;
 * event chips replace the section chips; seek actions are skipped outside Auto.
 */
import type { FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import type { DriveAids, DriveEvent } from '../../contracts/drive';
import type { EngineerAction, EngineerResponse, EngineerTurn } from '../../contracts/engineer';
import { API, NET_LIMITS } from '../../contracts/net';
import type { CornerId } from '../../contracts/units';
import { h, mount } from '../../ui/dom';
import { acquireNarration } from '../../ui/narration';
import './engineer.css';
import { driveKey, driveLabel, ruleAnswer, type DriveMoment } from './rules';
import { buildTelemetry, CHIPS, createSnap, DRIVE_CHIPS, EVENT_CHIPS, fillSnap, placeOf, SnapshotRing, type DriveContext, type Snap } from './snapshot';

const SAMPLE_S = 0.1;
const RING = 20; // 2 s at 10 Hz
const WHY_WINDOW_S = 1;
// Allow the worker's primary (9 s) and error-fallback (6 s) attempts to finish.
const REQUEST_TIMEOUT_MS = 17_000;
const HIGHLIGHT_MS = 4000;
const WHY = 'Bunu neden yaptı?';
/** A detected drive event counts for questions this long after it (ARCH-M2 §12.4)... */
const EVENT_WINDOW_S = 5;
/** ...or this long once the visitor engaged with it (opened the panel, focused the input, its chips were shown). */
const ENGAGED_WINDOW_S = 30;
/** Driver inputs looked at before an event, s. */
const BEFORE_S = 0.5;
/** Event priorities (as the coach's): the most telling event in the window is explained first. */
const PRIORITY: Readonly<Record<string, number>> = {
  'slide-rear-lift': 5, 'slide-rear': 4, 'slide-front': 4, lockup: 4, wheelspin: 3, 'hard-stop': 3, 'strike-kerb': 3,
  'strike-bump': 2, 'wheel-lift': 2, 'bump-stop': 2, 'aid-abs': 2, 'aid-traction': 2, 'aid-stability': 2, swap: 1,
};

interface Detected {
  readonly label: string;
  readonly key: string;
  readonly priority: number;
  /** performance.now() / 1000 at detection. */
  readonly time: number;
  readonly snap: Snap;
  readonly before: { throttle: number; brake: number; steer: number } | undefined;
}

let ctx: FeatureContext | undefined;
let ring: SnapshotRing | undefined;
let lastSample = -Infinity;
let shownSection = -1;
let chipRow: HTMLElement | undefined;
let pending: AbortController | undefined;
const history: EngineerTurn[] = [];
/** Recent detected drive events (newest last, at most 4) and the one the visitor engaged with. */
let recent: Detected[] = [];
let engaged: { event: Detected; at: number } | undefined;
let chipEvent: Detected | undefined;
let chipsDriving = false;
let rootEl: HTMLElement | undefined;

const now = () => performance.now() / 1000;

/** The event a question is about: the most telling one of the last EVENT_WINDOW_S, else the engaged one. */
function currentEvent(t = now()): { primary: Detected; also: Detected | undefined } | undefined {
  const fresh = recent.filter((e) => t - e.time <= EVENT_WINDOW_S);
  if (fresh.length === 0) return engaged && t - engaged.at <= ENGAGED_WINDOW_S ? { primary: engaged.event, also: undefined } : undefined;
  const primary = fresh.reduce((a, b) => (b.priority >= a.priority ? b : a));
  const also = [...fresh].reverse().find((e) => e !== primary && e.label !== primary.label);
  return { primary, also };
}

function engage(): void {
  const ev = currentEvent();
  if (ev) engaged = { event: ev.primary, at: now() };
}

const AID_NAMES: Readonly<Record<keyof DriveAids, string>> = { abs: 'anti-lock', traction: 'traction', stability: 'stability', steering: 'steering help' };

function clientId(): string {
  const key = 'sl-client-id';
  try {
    const id = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function resetRing(c: FeatureContext): void {
  ring = new SnapshotRing(RING, c.sim.frame.corners.map((k) => k.id));
  lastSample = -Infinity;
}

function sectionOf(c: FeatureContext, index: number) {
  return c.sim.current.track.sections[index];
}

function payload(c: FeatureContext, snap: Snap, drive?: DriveContext) {
  const sim = c.sim.current;
  const section = sectionOf(c, snap.sectionIndex);
  const place = drive ? placeOf(sim.world?.def, snap.zone, snap.x, snap.y) : undefined;
  const k = sim.kinematics();
  return buildTelemetry(
    snap,
    ring!.cornerIds,
    {
      vehicleClass: sim.vehicle.class,
      vehicleId: sim.vehicle.id,
      suspensionId: sim.suspension.id,
      sectionId: place?.id ?? section?.id ?? 'unknown',
      sectionName: place?.name ?? section?.def.name ?? 'Pist',
      summaries: { front: k.front.summary, rear: k.rear.summary },
    },
    drive,
  );
}

/** While driving: the snapshot and drive context for a question (the detected event's moment when there is one). */
function driveRequest(c: FeatureContext, latest: Snap | undefined): { snap: Snap; drive: DriveContext } | undefined {
  if (c.store.get().driveMode === 'auto' || !latest) return undefined;
  const aids = c.store.get().driveAids;
  const aidsOff = (Object.keys(AID_NAMES) as (keyof DriveAids)[]).filter((k) => !aids[k]).map((k) => AID_NAMES[k]);
  const ev = currentEvent();
  if (!ev) return { snap: latest, drive: { detected: 'none', aidsOff } };
  const { primary, also } = ev;
  const detected = also && primary.label.length + also.label.length < 150 ? `${primary.label}; also ${also.label}` : primary.label;
  return {
    snap: primary.snap,
    drive: { detected, aidsOff, eventAge: Math.max(0, now() - primary.time), ...(primary.before ? { before: primary.before } : {}) },
  };
}

/** Whitelisted dispatcher: only store keys and contract events; every argument re-checked against live content. */
function execute(c: FeatureContext, a: EngineerAction): void {
  const corners = c.sim.frame.corners.map((k) => k.id);
  const okCorner = (k: CornerId | 'all' | undefined): k is CornerId => k !== undefined && k !== 'all' && corners.includes(k);
  switch (a.tool) {
    case 'switch_suspension':
      if (c.store.get().driveMode === 'auto' && c.sim.current.vehicle.suspensions.includes(a.args.id)) c.store.setKey('suspensionId', a.args.id);
      break;
    case 'set_view':
      c.store.setKey('view', a.args.view);
      if (okCorner(a.args.corner)) {
        c.store.setKey('focusCorner', a.args.corner);
        c.bus.emit('camera:focus', { corner: a.args.corner });
      }
      break;
    case 'set_slow_motion':
      if (c.store.get().driveMode !== 'auto') break; // a delayed answer must not alter driving or replay speed
      c.store.setKey('timeScale', Math.min(1, Math.max(0.1, a.args.scale)));
      if (a.args.scale < 1) c.store.setKey('paused', false); // "show" should move even from a paused scene
      break;
    case 'highlight_component':
      if (a.args.corner === 'all' || okCorner(a.args.corner)) c.bus.emit('highlight', { role: a.args.component, corner: a.args.corner, durationMs: HIGHLIGHT_MS });
      break;
    case 'jump_to_section': {
      if (c.store.get().driveMode !== 'auto') break; // a seek is an Auto action: never while driving or replaying
      const s = c.sim.current.track.sections.find((x) => x.id === a.args.section);
      if (s) c.bus.emit('sim:seek-to', { lapTime: c.sim.current.lapTimeAt(s.s0) });
      break;
    }
  }
}

function isResponse(v: unknown): v is EngineerResponse {
  const r = v as EngineerResponse | null;
  return typeof r?.text === 'string' && Array.isArray(r.actions) && (r.source === 'model' || r.source === 'fallback');
}

const engineer: FeatureModule = {
  id: 'engineer',
  requires: [],
  phase: 'overlay',

  init(c) {
    ctx = c;
    resetRing(c);
    const id = clientId();

    const text = h('p', { class: 'sl-engineer-text' });
    const badge = h('span', { class: 'sl-engineer-badge sl-label', hidden: true });
    const answer = h('div', { class: 'sl-engineer-answer', role: 'status', 'aria-label': 'Mühendis yanıtı', 'aria-live': 'polite', hidden: true }, text, badge);
    let hasAnswer = false;
    let lastNarrated: string | null = null;
    const syncAnswer = () => {
      const state = c.store.get();
      answer.hidden = !hasAnswer || !state.engineerOpen || !state.hudVisible || state.attract;
      // The visible engineer card owns the voice, including while a reply is loading or has finished speaking.
      // Background captions are hidden by the shared message layout and must stay silent too.
      const audible = !answer.hidden && !document.hidden;
      narration.setFocused(audible);
      if (!audible || answer.classList.contains('is-busy')) {
        lastNarrated = null;
        narration.clear();
        return;
      }
      const message = text.textContent ?? '';
      if (message && message !== lastNarrated) {
        lastNarrated = message;
        narration.say(message);
      }
    };
    chipRow = h('div', { class: 'sl-engineer-chips' });
    const input = h('input', { class: 'sl-engineer-input', type: 'text', maxlength: NET_LIMITS.engineerQuestionChars, placeholder: 'Süspansiyon hakkında sorun…', 'aria-label': 'Yarış mühendisine sorunuz' });
    const send = h('button', { class: 'sl-engineer-send', type: 'submit', 'aria-label': 'Sor' }, '↵');
    const form = h('form', { class: 'sl-engineer-form' }, input, send);
    const why = h('button', { class: 'sl-engineer-why', type: 'button' }, WHY);
    const panel = h('section', { class: 'sl-engineer-panel', id: 'sl-engineer-panel', 'aria-label': 'Yarış mühendisi', hidden: true }, why, chipRow, form);
    const toggle = h('button', { class: 'sl-engineer-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sl-engineer-panel' }, 'Mühendise sor');
    const root = h('div', { class: 'sl-engineer' }, panel, toggle);
    rootEl = root;
    c.addDisposer(mount(c.dom.overlay, root));
    c.addDisposer(mount(c.dom.overlay, answer));

    const narration = acquireNarration(c.dom.overlay, { priority: 10 });
    c.addDisposer(() => narration.dispose());
    document.addEventListener('visibilitychange', syncAnswer);
    c.addDisposer(() => document.removeEventListener('visibilitychange', syncAnswer));
    const show = (msg: string, label: string | null, busy = false) => {
      hasAnswer = true;
      answer.classList.toggle('is-busy', busy);
      text.textContent = msg;
      badge.hidden = label === null;
      badge.textContent = label ?? '';
      syncAnswer();
    };

    c.on('sim:vehicle', () => {
      // A response and its conversation belong to the vehicle whose telemetry was sent.
      pending?.abort();
      pending = undefined;
      history.length = 0;
      recent = [];
      engaged = undefined;
      chipEvent = undefined;
      chipsDriving = false;
      shownSection = -1;
      resetRing(c);
      hasAnswer = false;
      text.textContent = '';
      badge.hidden = true;
      input.value = '';
      root.classList.remove('is-fresh');
      syncAnswer();
    });

    async function ask(question: string, latest: Snap | undefined): Promise<void> {
      const driving = driveRequest(c, latest);
      const snap = driving?.snap ?? latest;
      if (!snap) return;
      const telemetry = payload(c, snap, driving?.drive);
      const phenomenon = sectionOf(c, snap.sectionIndex)?.def.phenomenon;
      const local = (label: string) => show(ruleAnswer(question, phenomenon, telemetry), label);
      pending?.abort();
      const ctl = new AbortController();
      pending = ctl;
      const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
      show('Düşünüyor…', null, true);
      try {
        const res = await fetch(API.engineer, {
          method: 'POST',
          signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-client-id': id },
          body: JSON.stringify({ question, telemetry, history: history.slice(-NET_LIMITS.engineerHistoryMax) }),
        });
        const body: unknown = res.ok ? await res.json() : undefined;
        if (pending !== ctl) return;
        if (res.status === 429) return local('Mühendis meşgul · kural tabanlı yanıt');
        if (!isResponse(body)) return local('Çevrimdışı · kural tabanlı yanıt');
        show(body.text, body.source === 'fallback' ? 'Kural tabanlı yanıt' : null);
        history.push({ role: 'user', content: question }, { role: 'assistant', content: body.text.slice(0, NET_LIMITS.engineerHistoryChars) });
        history.splice(0, Math.max(0, history.length - NET_LIMITS.engineerHistoryMax));
        for (const a of body.actions.slice(0, 2)) execute(c, a);
      } catch {
        if (pending === ctl) local('Çevrimdışı · kural tabanlı yanıt');
      } finally {
        clearTimeout(timer);
        if (pending === ctl) pending = undefined;
      }
    }

    const askNow = (q: string) => void ask(q, ring?.latest());
    why.addEventListener('click', () => {
      engage();
      // driving: the detected event's own snapshot (driveRequest); Auto: the most eventful moment of the last second
      void ask(WHY, ring?.peak(now() - WHY_WINDOW_S));
    });
    chipRow.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('button');
      if (chipEvent && now() - chipEvent.time <= ENGAGED_WINDOW_S) engaged = { event: chipEvent, at: now() };
      if (chip?.textContent) {
        // Explicit preset buttons respond immediately, even while inference is unavailable.
        if (chip.textContent === 'Ağır çekimde göster' || chip.textContent === 'Tümseği ağır çekimde göster') {
          execute(c, { tool: 'set_slow_motion', args: { scale: 0.25 } });
        }
        askNow(chip.textContent);
      }
    });
    input.addEventListener('focus', engage);

    /** A detected drive moment while driving: remembered with its snapshot and the inputs just before it. */
    const detect = (m: DriveMoment) => {
      if (c.store.get().driveMode === 'auto' || !ring) return;
      const label = driveLabel(m);
      const key = driveKey(label) ?? '';
      const t = now();
      // the moment itself (the frame sampled when the event was drained), not the last 10 Hz sample
      const frameSnap = createSnap(ring.cornerIds);
      fillSnap(frameSnap, c.sim.frame, t);
      const ev: Detected = { label, key, priority: PRIORITY[key] ?? 1, time: t, snap: frameSnap, before: ring.inputs(t - BEFORE_S - 0.15, t - 0.05) };
      recent = [...recent.slice(-3), ev];
      chipEvent = ev;
      chipsDriving = false; // re-render chips
      root.classList.toggle('is-fresh', !c.store.get().engineerOpen);
    };
    c.on('drive:event', (e: DriveEvent) => {
      switch (e.kind) {
        case 'slide':
        case 'lockup':
        case 'wheelspin':
        case 'aid':
        case 'strike':
        case 'hard-stop':
          detect(e);
          return;
        case 'mode':
          if (e.mode === 'manual' && e.previous === 'auto') [recent, engaged, chipEvent] = [[], undefined, undefined];
          chipsDriving = false;
          return;
        default:
          return;
      }
    });
    c.on('sim:event', (e) => {
      if (e.kind === 'liftoff') detect({ kind: 'wheel-lift', corner: e.corner });
      else if (e.kind === 'bump-stop') detect({ kind: 'bump-stop', corner: e.corner });
    });
    c.on('sim:suspension', ({ suspensionId, previous }) => detect({ kind: 'swap', previous, next: suspensionId }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) askNow(q);
      input.value = '';
    });
    toggle.addEventListener('click', () => {
      if (!c.store.get().engineerOpen) engage();
      root.classList.remove('is-fresh');
      c.store.setKey('engineerOpen', !c.store.get().engineerOpen);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        c.store.setKey('engineerOpen', false);
        toggle.focus();
      }
    });
    c.watch((s) => {
      panel.hidden = !s.engineerOpen;
      toggle.setAttribute('aria-expanded', String(s.engineerOpen));
      root.classList.toggle('is-open', s.engineerOpen);
      if (s.engineerOpen) root.classList.remove('is-fresh');
      root.hidden = !s.hudVisible || s.attract; // H and attract mode hide it with the rest of the HUD
      syncAnswer();
    });
    c.addDisposer(() => {
      pending?.abort();
      pending = undefined;
      ctx = undefined;
      ring = undefined;
      chipRow = undefined;
      shownSection = -1;
      history.length = 0;
      recent = [];
      engaged = undefined;
      chipEvent = undefined;
      chipsDriving = false;
      rootEl = undefined;
    });
  },

  update(frame: FrameInfo) {
    if (!ctx || !ring) return;
    if (frame.time - lastSample >= SAMPLE_S) {
      lastSample = frame.time;
      ring.push(frame.t, frame.time);
    }
    if (!chipRow) return;
    const chip = (q: string) => h('button', { class: 'sl-engineer-chip', type: 'button' }, q);
    if (frame.t.drive.mode !== 'auto' && frame.t.vehicleClass === 'car') {
      // driving: 2-3 questions about the last detected event while it is fresh, else general driving questions
      if (chipEvent && frame.time - chipEvent.time > ENGAGED_WINDOW_S) {
        chipEvent = undefined;
        chipsDriving = false;
        rootEl?.classList.remove('is-fresh');
      }
      if (!chipsDriving) {
        chipsDriving = true;
        shownSection = -1;
        chipRow.replaceChildren(...(chipEvent ? (EVENT_CHIPS[chipEvent.key] ?? DRIVE_CHIPS) : DRIVE_CHIPS).map(chip));
      }
    } else if (frame.t.sectionIndex !== shownSection || chipsDriving) {
      chipsDriving = false;
      shownSection = frame.t.sectionIndex;
      const phenomenon = sectionOf(ctx, shownSection)?.def.phenomenon;
      chipRow.replaceChildren(...(phenomenon ? CHIPS[phenomenon] : []).map(chip));
    }
  },
};

export default engineer;
