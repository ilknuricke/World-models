/**
 * Telemetry card (plan 04-03, research 14 B1/D5): g-g with trail, per-corner camber arc + travel bar + load
 * square laid out like the car seen from above, and one sparkline (Camber | Travel | Load) for a chosen corner
 * with the previous suspension's trace at the same track positions as a dashed ghost (Auto only: a driven car is off
 * the shared line, so its samples have no ghost and the legend says so). TRUE values only;
 * draws at <= 30 Hz of simulation time, numbers at half that and only when their displayed digits change.
 */
import type { FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { G } from '../../contracts/units';
import { h, mount } from '../../ui/dom';
import { deg, fmt, gUnits, kN, mm } from '../../ui/format';
import { begin, CAMBER_RANGE, drawCorner, drawGg, drawSpark, GgTrail, LEAN_RANGE, readPalette, surface, type CornerGlyph, type Palette, type SparkScale, type Surface } from './draw';
import { History, METRICS, metricValue, type Metric } from './history';
import './telemetry-panel.css';

const SAMPLE_DT = 1 / 30;
const TRAIL = 45; // 1.5 s at 30 Hz
const CORNER_LABEL: Readonly<Record<string, string>> = { fl: 'SÖ', fr: 'SĞÖ', rl: 'SA', rr: 'SĞA', f: 'ÖN', r: 'ARKA' };
const METRIC_LABEL: Readonly<Record<Metric, string>> = { camber: 'Kamber', travel: 'Hareket', load: 'Yük' };
/** A motorcycle's wheel camber to the road is its lean: same field, honest name. */
const BIKE_LABEL: Readonly<Record<Metric, string>> = { ...METRIC_LABEL, camber: 'Yatma' };
/** Smallest sparkline span per metric (SI), so a quiet signal is not magnified into noise. */
const MIN_SPAN: Readonly<Record<Metric, number>> = { camber: (1 * Math.PI) / 180, travel: 0.02, load: 1000 };

const MOBILE_PANEL_QUERY = '(max-width: 720px), (max-width: 960px) and (max-height: 500px)';

/** Keep the phone's scene clear until the visitor asks for the telemetry sheet. */
export function mountTelemetryDisclosure(c: FeatureContext, root: HTMLElement, header: HTMLElement, refresh: () => void = () => {}): void {
  const toggle = h('button', {
    class: 'sl-telemetry-toggle', type: 'button', hidden: true,
    'aria-label': 'Telemetri', 'aria-expanded': 'false', 'aria-controls': 'sl-telemetry-panel',
  }, 'Telemetri');
  const close = h('button', { class: 'sl-telemetry-close', type: 'button', 'aria-label': 'Telemetriyi kapat', hidden: true }, '×');
  header.append(close);
  c.addDisposer(mount(c.dom.overlay, toggle));
  const media = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(MOBILE_PANEL_QUERY) : null;
  let mobile = media?.matches ?? false;
  let expanded = false;
  let driveMode = c.store.get().driveMode;

  const sync = () => {
    const state = c.store.get();
    const visible = state.hudVisible && !state.attract;
    const wasHidden = root.hidden;
    root.hidden = !visible || (mobile ? !expanded : state.engineerOpen);
    root.classList.toggle('is-mobile-expanded', mobile && expanded);
    toggle.hidden = !mobile || !visible;
    close.hidden = !mobile;
    toggle.setAttribute('aria-expanded', String(mobile && expanded));
    toggle.title = expanded ? 'Telemetriyi kapat' : 'Telemetriyi aç';
    if (wasHidden && !root.hidden) refresh(); // Opening a sheet while paused still shows the current sample.
  };
  const collapse = (focus = false) => {
    expanded = false;
    sync();
    if (focus && !toggle.hidden) toggle.focus();
  };
  toggle.addEventListener('click', () => {
    if (!mobile) return;
    expanded = !expanded;
    if (expanded) c.store.setKey('engineerOpen', false);
    sync();
  });
  close.addEventListener('click', () => collapse(true));
  const resize = () => {
    mobile = media?.matches ?? false;
    collapse(); // A desktop panel must not become an open phone sheet after rotation/resizing.
  };
  const escape = (event: KeyboardEvent) => {
    if (!mobile || !expanded || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    collapse(true);
  };
  media?.addEventListener?.('change', resize);
  document.addEventListener('keydown', escape);
  c.watch((state) => {
    // Release the dock before touch pedals appear; a CSS-hidden expanded sheet must not keep other controls hidden.
    const takingOver = mobile && state.driveMode !== 'auto' && state.driveMode !== driveMode;
    if (takingOver || state.engineerOpen || !state.hudVisible || state.attract) expanded = false;
    driveMode = state.driveMode;
    sync();
  });
  sync();
  c.addDisposer(() => {
    media?.removeEventListener?.('change', resize);
    document.removeEventListener('keydown', escape);
  });
}

/** Display form of a TRUE corner metric (format.ts conversions). */
export const DISPLAY: Readonly<Record<Metric, { readonly convert: (si: number) => number; readonly decimals: number; readonly unit: string }>> = {
  camber: { convert: deg, decimals: 1, unit: '°' },
  travel: { convert: mm, decimals: 0, unit: ' mm' },
  load: { convert: kN, decimals: 1, unit: ' kN' },
};

/** Static vertical load per corner from the vehicle's mass and CG position, N. */
export function staticLoads(t: TelemetryFrame, mass: number, wheelbase: number, cgToFront: number): Float64Array {
  const front = (wheelbase - cgToFront) / wheelbase;
  const out = new Float64Array(t.corners.length);
  const onAxle = (axle: string) => t.corners.filter((c) => c.axle === axle).length;
  t.corners.forEach((c, i) => {
    out[i] = (G * mass * (c.axle === 'front' ? front : 1 - front)) / onAxle(c.axle);
  });
  return out;
}

/** Linear interpolation of a tabulated curve at x (clamped). */
export function interp(xs: Float64Array, ys: Float64Array, x: number): number {
  const n = xs.length;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 1;
  while (xs[i]! < x) i++;
  const u = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + u * (ys[i]! - ys[i - 1]!);
}

/** Grid cell for a corner: front row first, the car's left on the screen's left (plan view, nose up). */
export function cornerCell(axle: string, side: number, twoColumns: boolean): { row: number; col: number } {
  return { row: axle === 'front' ? 1 : 2, col: !twoColumns ? 1 : side > 0 ? 1 : 2 };
}

interface Corner {
  readonly button: HTMLButtonElement;
  readonly value: HTMLElement;
  readonly glyph: Surface;
  readonly state: CornerGlyph;
}

interface State {
  readonly ctx: FeatureContext;
  readonly root: HTMLElement;
  readonly cornerGrid: HTMLElement;
  readonly tabs: readonly HTMLButtonElement[];
  readonly gg: Surface;
  readonly spark: Surface;
  readonly latG: HTMLElement;
  readonly roll: HTMLElement;
  readonly rollLabel: HTMLElement;
  readonly scaleNote: HTMLElement;
  readonly liveLegend: HTMLElement;
  readonly ghostLegend: HTMLElement;
  readonly ghostName: HTMLElement;
  /** " · Auto only" after the ghost's name while the visitor drives (no shared line, so no ghost). */
  readonly ghostNote: HTMLElement;
  driving: boolean;
  readonly trail: GgTrail;
  readonly scale: SparkScale;
  palette: Palette;
  corners: Corner[];
  history: History;
  staticLoad: Float64Array;
  staticCamber: Float64Array;
  metric: number;
  selected: number;
  lastSimTime: number;
  ticks: number;
  /** Last displayed integers (value * 10^decimals) for change-gated text writes: latG, roll, corners... */
  shown: Float64Array;
  reducedMotion: boolean;
}

let st: State | undefined;

function label(ctx: FeatureContext, suspensionId: string): string {
  return ctx.registries.suspensions.get(suspensionId)?.copy.short ?? '';
}

/** (Re)builds everything that depends on the vehicle layout or the suspension geometry. */
function configure(s: State, previous?: string): void {
  const { ctx } = s;
  const sim = ctx.sim.current;
  const t = ctx.sim.frame;
  const k = sim.kinematics();
  const v = sim.vehicle;
  s.staticLoad = staticLoads(t, v.mass, v.wheelbase, v.cgToFront);
  s.staticCamber = Float64Array.from(t.corners, (c) => interp(k[c.axle].curves.travel, k[c.axle].curves.camber, 0));
  t.corners.forEach((c, i) => {
    const curves = k[c.axle].curves;
    const glyph = s.corners[i]?.state;
    if (!glyph) return;
    glyph.staticCamber = s.staticCamber[i]!;
    glyph.droop = Math.max(1e-3, -curves.travel[0]!);
    glyph.bump = Math.max(1e-3, curves.travel[curves.travel.length - 1]!);
  });
  s.history.setSuspension(sim.suspension.id, previous);
  s.liveLegend.textContent = label(ctx, sim.suspension.id);
  s.ghostName.textContent = previous === undefined ? '' : label(ctx, previous);
  s.ghostLegend.hidden = !s.history.hasGhost;
  s.scale.lo = s.scale.hi = 0;
}

function buildCorners(s: State): void {
  const t = s.ctx.sim.frame;
  const twoColumns = t.corners.some((c) => c.side !== 0);
  s.cornerGrid.replaceChildren();
  s.cornerGrid.classList.toggle('is-single', !twoColumns);
  s.corners = t.corners.map((c, i) => {
    const value = h('span', { class: 'sl-telemetry-panel-value sl-num' }, '—');
    const canvas = h('canvas', { class: 'sl-telemetry-panel-glyph', 'aria-hidden': 'true' });
    const id = CORNER_LABEL[c.id] ?? c.id.toLocaleUpperCase('tr-TR');
    const button = h(
      'button',
      { class: 'sl-telemetry-panel-corner', type: 'button', 'aria-pressed': String(i === s.selected), 'aria-label': `${id} eğrisi` },
      h('span', { class: 'sl-telemetry-panel-corner-head' }, h('span', { class: 'sl-telemetry-panel-corner-id sl-label' }, id), value),
      canvas,
    );
    const cell = cornerCell(c.axle, c.side, twoColumns);
    button.style.gridRow = String(cell.row);
    button.style.gridColumn = String(cell.col);
    button.addEventListener('click', () => select(s, i));
    s.cornerGrid.append(button);
    return {
      button,
      value,
      glyph: surface(canvas, 64, 30),
      state: { camber: 0, staticCamber: 0, side: c.side, travel: 0, bump: 0.1, droop: 0.1, loadRatio: 1, stop: 0, range: twoColumns ? CAMBER_RANGE : LEAN_RANGE },
    };
  });
}

function select(s: State, corner: number): void {
  s.selected = corner;
  s.corners.forEach((c, i) => c.button.setAttribute('aria-pressed', String(i === corner)));
  s.scale.lo = s.scale.hi = 0;
  s.shown.fill(Number.NaN);
  draw(s);
}

function setMetric(s: State, metric: number): void {
  s.metric = metric;
  s.tabs.forEach((b, i) => b.setAttribute('aria-pressed', String(i === metric)));
  s.scale.lo = s.scale.hi = 0;
  s.shown.fill(Number.NaN);
  draw(s);
}

function resetVehicle(s: State): void {
  const t = s.ctx.sim.frame;
  s.selected = 0;
  s.history = new History(t.corners.length, s.ctx.sim.current.track.length, s.ctx.sim.current.suspension.id);
  s.shown = new Float64Array(2 + t.corners.length).fill(Number.NaN);
  s.trail.clear();
  buildCorners(s);
  configure(s);
  // Single track: both wheels lean with the bike, so camber (= lean) is shown as Lean and Travel is the default trace.
  const bike = s.ctx.sim.current.vehicle.class === 'motorcycle';
  const labels = bike ? BIKE_LABEL : METRIC_LABEL;
  s.tabs.forEach((b, i) => (b.textContent = labels[METRICS[i]!]));
  s.rollLabel.textContent = bike ? 'Yatma' : 'Yatma';
  setMetric(s, bike ? METRICS.indexOf('travel') : 0);
}

/** Writes text only when the displayed digits change (the only allocation in the loop). */
function text(s: State, slot: number, el: HTMLElement, v: number, decimals: number, unit: string): void {
  const q = Math.round(v * 10 ** decimals);
  if (q === s.shown[slot]) return;
  s.shown[slot] = q;
  el.textContent = fmt(v, decimals) + unit;
}

function draw(s: State): void {
  const t = s.ctx.sim.frame;
  const dpr = globalThis.devicePixelRatio;
  drawGg(s.gg, s.palette, dpr, s.trail, !s.reducedMotion);
  const metric = METRICS[s.metric]!;
  for (let i = 0; i < s.corners.length; i++) {
    const c = s.corners[i]!;
    const k = t.corners[i]!;
    const g = c.state;
    g.camber = k.camber;
    g.travel = k.travel;
    g.loadRatio = k.load / s.staticLoad[i]!;
    g.stop = k.stop;
    drawCorner(c.glyph, s.palette, dpr, g);
  }
  const ref = metric === 'camber' ? s.staticCamber[s.selected]! : metric === 'load' ? s.staticLoad[s.selected]! : 0;
  if (s.history.count > 0) drawSpark(s.spark, s.palette, dpr, s.history, s.selected, s.metric, ref, MIN_SPAN[metric], s.scale);
  else begin(s.spark, dpr);
}

function writeNumbers(s: State): void {
  const t = s.ctx.sim.frame;
  text(s, 0, s.latG, Math.abs(gUnits(t.ay)), 2, ' g');
  text(s, 1, s.roll, Math.abs(deg(t.roll)), 1, '°');
  const metric = METRICS[s.metric]!;
  const d = DISPLAY[metric];
  for (let i = 0; i < s.corners.length; i++) {
    text(s, 2 + i, s.corners[i]!.value, d.convert(metricValue(t.corners[i]!, metric)), d.decimals, d.unit);
  }
}

const telemetryPanel: FeatureModule = {
  id: 'telemetry-panel',
  requires: [],
  phase: 'overlay',

  init(c) {
    const gg = h('canvas', { class: 'sl-telemetry-panel-gg', 'aria-hidden': 'true' });
    const spark = h('canvas', { class: 'sl-telemetry-panel-spark', 'aria-hidden': 'true' });
    const latG = h('b', { class: 'sl-telemetry-panel-hero' }, '—');
    const roll = h('b', { class: 'sl-telemetry-panel-hero' }, '—');
    const rollLabel = h('span', { class: 'sl-label' }, 'Yatma');
    const scaleNote = h('span', { class: 'sl-telemetry-panel-note sl-label', hidden: true }, 'Gerçek ölçek');
    const cornerGrid = h('div', { class: 'sl-telemetry-panel-corners' });
    const tabs = METRICS.map((m, i) =>
      h('button', { class: 'sl-telemetry-panel-tab sl-label', type: 'button', 'aria-pressed': String(i === 0) }, METRIC_LABEL[m]),
    );
    const liveLegend = h('span', { class: 'sl-telemetry-panel-legend is-live' });
    const ghostName = h('span');
    const ghostNote = h('span');
    const ghostLegend = h('span', { class: 'sl-telemetry-panel-legend is-ghost', hidden: true }, ghostName, ghostNote);
    const header = h('header', { class: 'sl-telemetry-panel-head' }, h('span', { class: 'sl-label' }, 'Telemetri'), scaleNote);
    const root = h(
      'section',
      { class: 'sl-telemetry-panel', id: 'sl-telemetry-panel', 'aria-label': 'Telemetri' },
      header,
      h(
        'div',
        { class: 'sl-telemetry-panel-top' },
        h(
          'div',
          { class: 'sl-telemetry-panel-ggbox' },
          gg,
          h(
            'div',
            { class: 'sl-telemetry-panel-heroes' },
            h('span', { class: 'sl-telemetry-panel-stat' }, h('span', { class: 'sl-label', title: 'Yanal ivme' }, 'Yanal'), latG),
            h('span', { class: 'sl-telemetry-panel-stat' }, rollLabel, roll),
          ),
        ),
        cornerGrid,
      ),
      h(
        'div',
        { class: 'sl-telemetry-panel-sparkhead' },
        h('div', { class: 'sl-telemetry-panel-tabs', role: 'group', 'aria-label': 'Grafik büyüklüğü' }, ...tabs),
        h('div', { class: 'sl-telemetry-panel-legends' }, liveLegend, ghostLegend),
      ),
      spark,
    );
    c.addDisposer(mount(c.dom.overlay, root));

    const s: State = {
      ctx: c,
      root,
      cornerGrid,
      tabs,
      gg: surface(gg, 84, 84),
      spark: surface(spark, 290, 44),
      latG,
      roll,
      rollLabel,
      scaleNote,
      liveLegend,
      ghostLegend,
      ghostName,
      ghostNote,
      driving: false,
      trail: new GgTrail(TRAIL),
      scale: { lo: 0, hi: 0 },
      palette: readPalette(root),
      corners: [],
      history: new History(1, 1, ''),
      staticLoad: new Float64Array(0),
      staticCamber: new Float64Array(0),
      metric: 0,
      selected: 0,
      lastSimTime: -Infinity,
      ticks: 0,
      shown: new Float64Array(0),
      reducedMotion: false,
    };
    st = s;
    tabs.forEach((b, i) => b.addEventListener('click', () => setMetric(s, i)));
    resetVehicle(s);
    mountTelemetryDisclosure(c, root, header, () => { draw(s); writeNumbers(s); });

    c.on('sim:vehicle', () => resetVehicle(s));
    c.on('sim:suspension', ({ previous }) => configure(s, previous));
    c.on('sim:seek', () => {
      s.history.resetWindow();
      s.trail.clear();
      s.lastSimTime = -Infinity;
    });
    c.watch((state) => {
      // Close-up: the wheel is the hero; the card folds to the g-g and its two numbers (the camber trace takes over).
      root.classList.toggle('is-compact', state.view === 'closeup');
      scaleNote.hidden = state.amplification === 1;
      s.reducedMotion = state.reducedMotion;
    });
    c.addDisposer(() => {
      st = undefined;
    });
  },

  update(frame: FrameInfo) {
    const s = st;
    if (!s) return;
    const t = frame.t;
    // Driven by simulation time: paused = frozen, slow motion = denser trace, e2e advance() = deterministic.
    if (t.simTime - s.lastSimTime < SAMPLE_DT - 1e-9) return;
    s.lastSimTime = t.simTime;
    s.history.push(t);
    const driving = t.drive.mode !== 'auto';
    if (driving !== s.driving) {
      s.driving = driving;
      s.ghostNote.textContent = driving ? ' · Yalnızca otomatik' : '';
    }
    s.trail.push(gUnits(t.ay), gUnits(t.ax));
    if (s.root.hidden) return; // keep recording (the ghost needs the lap), skip the drawing
    draw(s);
    if ((s.ticks++ & 1) === 0) writeNumbers(s);
  },
};

export default telemetryPanel;
