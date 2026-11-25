/**
 * Insights (plan 04-03, research 14 D7 / A7): one compact caption below the right-hand controls, driven by the section's phenomenon
 * and simulation events (rules.ts), at most one per 8 s, 6 s visible, announced politely to screen readers and
 * on the bus (`insight:shown`). On a suspension swap, after 1 s of settling, a delta chip compares the previous
 * suspension with the new one at the same place on the lap (lap-record.ts). Silent during attract mode.
 * Quiet outside Auto (11-02): while the visitor drives the coach feature explains the driven car instead; a caption on
 * screen leaves on the takeover and a swap made while driving gets no delta (the coach acknowledges it).
 */
import type { FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { Phenomenon } from '../../contracts/track';
import { h, mount } from '../../ui/dom';
import { acquireNarration, type MessageNarration } from '../../ui/narration';
import { computeDelta, formatDelta, LapRecord } from './lap-record';
import { fill, InsightEngine, type Insight } from './rules';
import './insights.css';

const SAMPLE_DT = 1 / 30;
const SETTLE_S = 1;
const CORNER_LABEL: Readonly<Record<string, string>> = { fl: 'SÖ', fr: 'SĞÖ', rl: 'SA', rr: 'SĞA', f: 'ÖN', r: 'ARKA' };
/** Visible time and exit fade, in SIMULATION seconds: a paused or slowed lab keeps the caption readable. */
const VISIBLE_S = 6;
const LEAVE_S = 0.3;

interface Swap {
  readonly previous: string;
  readonly at: number;
  readonly s: number;
  section: number;
}

interface State {
  readonly ctx: FeatureContext;
  readonly root: HTMLElement;
  readonly caption: HTMLElement;
  readonly text: HTMLElement;
  readonly chip: HTMLElement;
  /** Screen-reader copy of each new caption; the live chip numbers are not announced. */
  readonly announce: HTMLElement;
  readonly narration: MessageNarration;
  engine: InsightEngine;
  rec: LapRecord;
  lastSimTime: number;
  section: number;
  swap: Swap | null;
  quiet: boolean;
  /** Simulation time the caption starts leaving; +LEAVE_S it is hidden. */
  hideAt: number;
  /** Section caption on screen: its chip keeps reading the live frame so it matches the telemetry card. */
  live: Insight | null;
  ticks: number;
}

let st: State | undefined;

function phenomenonAt(c: FeatureContext, index: number): Phenomenon | undefined {
  return c.sim.current.track.sections[index]?.def.phenomenon;
}

function present(s: State, id: string, text: string, chip: readonly (Node | string)[], warn: boolean): void {
  s.live = null;
  s.hideAt = s.ctx.sim.frame.simTime + VISIBLE_S;
  s.text.textContent = text;
  s.chip.replaceChildren(...chip);
  s.chip.hidden = chip.length === 0;
  s.caption.classList.toggle('is-warn', warn);
  s.caption.classList.remove('is-leaving');
  // restart the enter animation for back-to-back captions
  s.caption.hidden = true;
  void s.caption.offsetWidth;
  s.caption.hidden = false;
  const shown = s.caption.textContent ?? text;
  s.announce.textContent = shown;
  s.narration.say(text);
  s.ctx.bus.emit('insight:shown', { id, text: shown });
}

function showInsight(s: State, i: Insight): void {
  present(s, i.id, i.text, i.chip ? [i.chip] : [], i.warn);
  // event captions describe a moment (a wheel went light): their numbers stay as they were
  if (i.rule.chip && !i.rule.event) s.live = i;
}

function suspensionLabel(c: FeatureContext, id: string): string {
  return c.registries.suspensions.get(id)?.copy.label ?? id;
}

function showDelta(s: State, t: TelemetryFrame, swap: Swap): boolean {
  const c = s.ctx;
  const p = phenomenonAt(c, t.sectionIndex);
  const pair = `${suspensionLabel(c, swap.previous)} → ${suspensionLabel(c, c.sim.current.suspension.id)}`;
  const d = computeDelta(s.rec, swap.previous, t, p, swap.section === t.sectionIndex ? swap.s : null);
  if (!d) return false;
  const cornerId = d.corner < 0 ? '' : t.corners[d.corner]!.id;
  const f = formatDelta(d, CORNER_LABEL[cornerId] ?? cornerId.toLocaleUpperCase('tr-TR'));
  present(
    s,
    'delta',
    pair,
    [
      h('span', { class: 'sl-insights-chip-label' }, f.label),
      h('span', { class: 'sl-insights-before' }, f.before),
      h('span', { class: 'sl-insights-arrow', 'aria-label': 'sonra' }, '→'),
      h('span', { class: 'sl-insights-after' }, f.after),
    ],
    false,
  );
  return true;
}

function resetVehicle(s: State): void {
  s.narration.clear();
  s.caption.hidden = true;
  s.caption.classList.remove('is-warn', 'is-leaving');
  s.text.textContent = '';
  s.chip.replaceChildren();
  s.chip.hidden = true;
  s.announce.textContent = '';
  s.live = null;
  s.hideAt = Number.POSITIVE_INFINITY;
  s.lastSimTime = Number.NEGATIVE_INFINITY;
  s.ticks = 0;
  const sim = s.ctx.sim.current;
  s.rec = new LapRecord(s.ctx.sim.frame.corners.length, sim.track.length);
  s.swap = null;
  s.section = -1;
  // A different vehicle owns a fresh cooldown and hysteresis history as well as fresh section timers.
  s.engine = new InsightEngine();
}

const insights: FeatureModule = {
  id: 'insights',
  requires: [],
  phase: 'overlay',

  init(c) {
    const narration = acquireNarration(c.dom.overlay);
    c.addDisposer(() => narration.dispose());
    const text = h('span', { class: 'sl-insights-text' });
    const chip = h('span', { class: 'sl-insights-chip sl-num', hidden: true });
    const caption = h('p', { class: 'sl-insights-caption', hidden: true }, text, chip);
    const root = h('div', { class: 'sl-insights' }, caption);
    const announce = h('div', { class: 'sl-insights-announce sl-visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
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
      engine: new InsightEngine(),
      rec: new LapRecord(1, 1),
      lastSimTime: Number.NEGATIVE_INFINITY,
      section: -1,
      swap: null,
      quiet: false,
      hideAt: Number.POSITIVE_INFINITY,
      live: null,
      ticks: 0,
    };
    st = s;
    resetVehicle(s);

    c.on('sim:vehicle', () => resetVehicle(s));
    c.on('sim:suspension', ({ previous }) => {
      const t = c.sim.frame;
      s.swap = { previous, at: t.simTime, s: t.s, section: t.sectionIndex };
    });
    c.on('sim:seek', () => {
      s.rec.break();
      s.engine.resetSection();
      s.lastSimTime = Number.NEGATIVE_INFINITY;
      if (s.swap) s.swap.section = -1; // the before-swap position is no longer "just before"
    });
    c.on('drive:mode', ({ mode }) => {
      if (mode !== 'auto') {
        s.narration.clear();
        s.caption.hidden = true;
        s.hideAt = Number.POSITIVE_INFINITY;
        s.live = null;
        s.swap = null;
      }
      s.rec.break();
      s.engine.resetSection();
      if (s.swap) s.swap.section = -1; // a fallback "just before the swap" spot is no longer on the same run
    });
    c.on('sim:event', (e) => {
      if (s.quiet || e.kind === 'section' || e.kind === 'lap') return;
      const t = c.sim.frame;
      const i = s.engine.event(e, t, t.simTime);
      if (i) showInsight(s, i);
    });
    c.watch((state) => {
      s.quiet = state.attract || !state.hudVisible || state.driveMode !== 'auto';
      root.hidden = s.quiet;
      if (s.quiet) s.narration.clear();
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
      if (t.simTime >= s.hideAt + LEAVE_S) {
        s.narration.clear(false);
        s.caption.hidden = true;
        s.hideAt = Number.POSITIVE_INFINITY;
        s.live = null;
      }
    }
    if (t.simTime - s.lastSimTime < SAMPLE_DT - 1e-9) return;
    s.lastSimTime = t.simTime;
    s.rec.write(t.suspensionId, t);
    if (s.live && s.ticks++ % 2 === 0) {
      const chip = fill(s.live.rule.chip!, t, s.live.corner);
      if (chip !== s.chip.textContent) s.chip.textContent = chip;
    }
    if (t.sectionIndex !== s.section) {
      s.section = t.sectionIndex;
      s.engine.resetSection();
    }
    if (t.drive.mode !== 'auto') {
      s.swap = null;
      return;
    }
    if (s.swap && t.simTime - s.swap.at >= SETTLE_S) {
      const swap = s.swap;
      s.swap = null;
      if (!s.quiet && showDelta(s, t, swap)) s.engine.markShown(t.simTime);
      return;
    }
    if (s.quiet) return;
    const i = s.engine.tick(t, phenomenonAt(s.ctx, t.sectionIndex), t.simTime);
    if (i) showInsight(s, i);
  },
};

export default insights;
