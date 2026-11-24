/**
 * Coach (plan 11-02; ARCHITECTURE-M2 §9, §10.5; research m2/13): while the visitor drives, one plain line explains a
 * moment right after it happened (a slide, a lift-off rotation, a lock-up, wheelspin, an assist stepping in, a kerb or
 * bump strike, a wheel going light, a hard stop, a suspension swap), and entering a station's zone shows what to try
 * there. Same place and look as the insights caption (insights stay with Auto), one polite announcement per line,
 * silent in attract mode and with the HUD hidden. Lines and their rate limits live in rules.ts.
 *
 * The moments come from the bus only (11-05): the plant runs the sim-core detectors once per fixed step and the kernel
 * forwards them as 'drive:event' (slide, lockup, wheelspin, aid, strike, hard-stop), so brief events are never missed
 * at low frame rates.
 */
import type { FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import type { DriveEvent } from '../../contracts/drive';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { h, mount } from '../../ui/dom';
import { acquireNarration, type MessageNarration } from '../../ui/narration';
import { CoachEngine, compose, stationIn, stationLine, templateFor, type CoachMoment, type Line } from './rules';
import './coach.css';

/** Visible time and exit fade, simulation seconds (as the insights caption). */
const VISIBLE_S = 6;
const CARD_VISIBLE_S = 9;
const LEAVE_S = 0.3;
/** Moments right after a takeover are the engage transient, not the driver's doing. */
const TAKEOVER_QUIET_S = 1;

interface State {
  readonly ctx: FeatureContext;
  readonly root: HTMLElement;
  readonly caption: HTMLElement;
  readonly text: HTMLElement;
  readonly chip: HTMLElement;
  readonly announce: HTMLElement;
  readonly narration: MessageNarration;
  readonly engine: CoachEngine;
  quiet: boolean;
  hideAt: number;
}

let st: State | undefined;

const driving = (t: TelemetryFrame) => t.drive.mode === 'manual';

function present(s: State, line: Line, visible: number): void {
  const t = s.ctx.sim.frame;
  s.hideAt = t.simTime + visible;
  s.text.textContent = line.text;
  s.chip.textContent = line.chip;
  s.chip.hidden = line.chip === '';
  s.caption.classList.toggle('is-warn', line.warn);
  s.caption.classList.remove('is-leaving');
  s.caption.hidden = true;
  void s.caption.offsetWidth; // restart the enter animation
  s.caption.hidden = false;
  // one polite announcement of the sentence; the number chip stays silent (07-03: numbers never sit in a live region)
  s.announce.textContent = line.text;
  s.narration.say(line.text);
  s.ctx.bus.emit('insight:shown', { id: `coach:${line.id}`, text: line.text });
}

function hide(s: State, finishSpeaking = false): void {
  s.narration.clear(!finishSpeaking);
  s.caption.hidden = true;
  s.caption.classList.remove('is-leaving');
  s.hideAt = Number.POSITIVE_INFINITY;
}

function label(c: FeatureContext, id: string): string {
  return c.registries.suspensions.get(id)?.copy.label ?? id;
}

function offer(s: State, m: CoachMoment): void {
  const t = s.ctx.sim.frame;
  if (s.quiet || !driving(t)) return;
  const tpl = templateFor(m);
  if (tpl) s.engine.offer(compose(tpl, m, t, (id) => label(s.ctx, id)), t.simTime);
}

function onDriveEvent(s: State, e: DriveEvent): void {
  const t = s.ctx.sim.frame;
  switch (e.kind) {
    case 'mode':
      s.engine.clear(e.mode === 'manual' ? t.simTime + TAKEOVER_QUIET_S : Number.NEGATIVE_INFINITY);
      if (e.mode !== 'manual') hide(s);
      return;
    case 'reset':
      s.engine.noteReset(t.simTime);
      s.engine.clear(t.simTime + TAKEOVER_QUIET_S);
      return;
    case 'zone': {
      const world = s.ctx.sim.current.world?.def;
      if (!e.entered || !world || s.quiet || !driving(t)) return;
      const station = stationIn(world.stations, e.zone, t.drive.x, t.drive.y);
      const line = station && s.engine.card(stationLine(station), t.simTime);
      if (line) present(s, line, CARD_VISIBLE_S);
      return;
    }
    case 'slide':
    case 'lockup':
    case 'wheelspin':
    case 'aid':
    case 'strike':
    case 'hard-stop':
      offer(s, e);
      return;
    default:
      return;
  }
}

function resetVehicle(s: State): void {
  s.engine.forget();
  hide(s);
}

const coach: FeatureModule = {
  id: 'coach',
  requires: [],
  phase: 'overlay',

  init(c) {
    const narration = acquireNarration(c.dom.overlay);
    c.addDisposer(() => narration.dispose());
    const text = h('span', { class: 'sl-coach-text' });
    const chip = h('span', { class: 'sl-coach-chip sl-num', hidden: true });
    const caption = h('p', { class: 'sl-coach-caption', hidden: true }, text, chip);
    const root = h('div', { class: 'sl-coach' }, caption);
    const announce = h('div', { class: 'sl-coach-announce sl-visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
    c.addDisposer(mount(c.dom.overlay, root));
    c.addDisposer(mount(c.dom.overlay, announce));
    const s: State = {
      ctx: c,
      root,
      caption,
      text,
      chip,
      announce,
      narration,
      engine: new CoachEngine(),
      quiet: false,
      hideAt: Number.POSITIVE_INFINITY,
    };
    st = s;

    c.on('sim:vehicle', () => resetVehicle(s));
    c.on('drive:event', (e) => onDriveEvent(s, e));
    c.on('sim:event', (e) => {
      if (e.kind === 'liftoff') offer(s, { kind: 'wheel-lift', corner: e.corner });
      else if (e.kind === 'bump-stop') offer(s, { kind: 'bump-stop', corner: e.corner });
    });
    c.on('sim:suspension', ({ suspensionId, previous }) => offer(s, { kind: 'swap', previous, next: suspensionId }));
    c.watch((state) => {
      s.quiet = state.attract || !state.hudVisible;
      root.hidden = s.quiet;
      if (s.quiet) {
        s.engine.clear();
        s.narration.clear();
      }
    });
    c.addDisposer(() => {
      st = undefined;
    });
  },

  update(frame: FrameInfo) {
    const s = st;
    if (!s) return;
    const t = frame.t;
    if (t.simTime >= s.hideAt) {
      s.caption.classList.add('is-leaving');
      if (t.simTime >= s.hideAt + LEAVE_S) hide(s, true);
    }
    if (!driving(t) || t.vehicleClass !== 'car' || s.quiet) return;
    const line = s.engine.tick(t.simTime);
    if (line) present(s, line, VISIBLE_S);
  },
};

export default coach;
