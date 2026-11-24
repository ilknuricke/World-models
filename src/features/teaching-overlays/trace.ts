/**
 * Camber-vs-travel trace (research 21 §2 item 5): one small plot per axle. The curve is the suspension's signature
 * (from `sim.kinematics()`), the previous suspension's curve stays faint after a swap, and one dot per wheel rides it
 * at the TRUE travel / body camber of this frame. Motorcycle: motion ratio vs travel (camber is zero there).
 * Static parts are drawn once per layout change into an offscreen canvas; a tick blits it and draws dots and numbers
 * with a glyph table, so ticks allocate nothing.
 */
import type { KinematicsCurves, VehicleKinematics } from '../../contracts/suspension';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { RAD_TO_DEG } from '../../contracts/units';
import { h } from '../../ui/dom';
import { fmt } from '../../ui/format';

export type TraceMetric = 'camber' | 'motionRatio';

export interface AxlePlot {
  readonly travel: Float64Array;
  readonly value: Float64Array;
}

/** Display value of a curve sample: camber in degrees, motion ratio as is. */
export const display = (metric: TraceMetric, v: number): number => (metric === 'camber' ? v * RAD_TO_DEG : v);

/**
 * Copies one axle's curve in display units (so later kinematics() objects cannot change what we keep), limited to
 * the usable travel [-droop, bump] when given (the solver's table runs a little past the bump stops).
 */
export function plotOf(curves: KinematicsCurves, metric: TraceMetric, droop = Infinity, bump = Infinity): AxlePlot {
  const keep: number[] = [];
  for (let i = 0; i < curves.travel.length; i++) if (curves.travel[i]! >= -droop - 1e-9 && curves.travel[i]! <= bump + 1e-9) keep.push(i);
  return { travel: Float64Array.from(keep, (i) => curves.travel[i]!), value: Float64Array.from(keep, (i) => display(metric, curves[metric][i]!)) };
}

/** Usable travel per axle (front, rear) as [droop, bump]; unlimited when the definition has no per-axle linkage. */
export type TravelLimits = readonly (readonly [number, number])[];

/** Plot window [x0, x1, y0, y1] covering every finite sample of the plots, y padded, with a minimum y span. */
export function plotRange(plots: readonly (AxlePlot | null)[], minSpan: number): [number, number, number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of plots) {
    if (!p) continue;
    for (let i = 0; i < p.travel.length; i++) {
      const x = p.travel[i]!;
      const y = p.value[i]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (!(x1 > x0)) [x0, x1] = [-0.1, 0.1];
  if (!(y1 >= y0)) [y0, y1] = [-minSpan / 2, minSpan / 2];
  const pad = Math.max(minSpan, y1 - y0) * 0.5 - (y1 - y0) / 2;
  const m = Math.max(minSpan, y1 - y0) * 0.12;
  return [x0, x1, y0 - pad - m, y1 + pad + m];
}

/** Minimal 2D context surface used by the glyph writer (lets tests pass a recorder). */
export interface GlyphTarget {
  fillText(text: string, x: number, y: number): void;
}

const GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const digitBuf = new Int8Array(16);

/**
 * Writes `value` right-aligned at x (fixed glyph advance, monospace font), with `decimals` places, a true minus and
 * no "-0". Draws one constant glyph string per character: no string is built. Returns the left edge.
 */
export function drawNumber(g: GlyphTarget, value: number, decimals: number, xRight: number, y: number, advance: number): number {
  let x = xRight;
  if (!Number.isFinite(value)) {
    x -= advance;
    g.fillText('—', x, y);
    return x;
  }
  const scale = 10 ** decimals;
  let n = Math.round(Math.abs(value) * scale);
  const negative = value < 0 && n !== 0;
  let count = 0;
  do {
    digitBuf[count++] = n % 10;
    n = Math.floor(n / 10);
  } while ((n > 0 || count <= decimals) && count < digitBuf.length);
  for (let i = 0; i < count; i++) {
    if (decimals > 0 && i === decimals) {
      x -= advance * 0.6;
      g.fillText('.', x, y);
    }
    x -= advance;
    g.fillText(GLYPHS[digitBuf[i]!]!, x, y);
  }
  if (negative) {
    x -= advance;
    g.fillText('−', x, y);
  }
  return x;
}

// ---------------------------------------------------------------- panel

const W = 248;
const PAD = 12;
/** Left gutter for the value labels. */
const GUT = 30;
const HEAD = 22;
const ROW = 16;
const PLOT_H = 66;
const GAP = 10;

interface Palette {
  text1: string;
  text2: string;
  text3: string;
  hair: string;
  accent: string;
  warn: string;
  mono: string;
  sans: string;
}

function palette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    text1: v('--text-1', '#edeef0'),
    text2: v('--text-2', '#a3a8b0'),
    text3: v('--text-3', '#6b7079'),
    hair: v('--hair-strong', 'rgba(255,255,255,0.22)'),
    accent: v('--accent', '#7cf0d4'),
    warn: v('--warn', '#ffb454'),
    mono: v('--font-mono', 'monospace'),
    sans: v('--font-sans', 'sans-serif'),
  };
}

export interface TracePanel {
  readonly root: HTMLElement;
  /** Current curves; `previous` (copied by the caller before the swap) stays faint. Allocates: layout changes only. */
  setCurves(kin: VehicleKinematics, metric: TraceMetric, limits: TravelLimits, previous: readonly (AxlePlot | null)[] | null, previousLabel: string): void;
  /** Current curves in display units, per axle (front, rear): what the caller keeps as "previous" on a swap. */
  readonly plots: readonly (AxlePlot | null)[];
  draw(t: TelemetryFrame): void;
  setVisible(on: boolean): void;
}

export function createTracePanel(): TracePanel {
  const canvas = h('canvas', { class: 'sl-teaching-overlays-canvas', 'aria-hidden': 'true' });
  const root = h('section', { class: 'sl-teaching-overlays-trace', 'aria-label': 'Tekerlek hareketine göre kamber', hidden: true }, canvas);
  const stat = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const sg = stat.getContext('2d');
  let pal: Palette | null = null;
  let dpr = 1;
  let advance = 6.6;
  let metric: TraceMetric = 'camber';
  let plots: (AxlePlot | null)[] = [null, null];
  let ranges: [number, number, number, number][] = [];
  let height = 0;

  const top = (ai: number) => HEAD + ai * (ROW + PLOT_H + GAP) + ROW;
  const px = (ai: number, x: number) => {
    const r = ranges[ai]!;
    return PAD + GUT + ((x - r[0]) / (r[1] - r[0])) * (W - 2 * PAD - GUT);
  };
  const py = (ai: number, y: number) => {
    const r = ranges[ai]!;
    return top(ai) + PLOT_H - ((y - r[2]) / (r[3] - r[2])) * PLOT_H;
  };

  const curve = (c: CanvasRenderingContext2D, ai: number, p: AxlePlot) => {
    c.beginPath();
    let started = false;
    for (let i = 0; i < p.travel.length; i++) {
      const y = p.value[i]!;
      if (!Number.isFinite(y)) continue;
      const X = px(ai, p.travel[i]!);
      const Y = py(ai, y);
      if (started) c.lineTo(X, Y);
      else c.moveTo(X, Y);
      started = true;
    }
    c.stroke();
  };

  return {
    root,
    get plots() {
      return plots;
    },
    setCurves(kin, m, limits, previous, previousLabel) {
      metric = m;
      pal ??= palette(root);
      dpr = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
      plots = [plotOf(kin.front.curves, m, ...(limits[0] ?? [])), plotOf(kin.rear.curves, m, ...(limits[1] ?? []))];
      const minSpan = m === 'camber' ? 1 : 0.2;
      ranges = [0, 1].map((ai) => plotRange([plots[ai] ?? null, previous?.[ai] ?? null], minSpan));
      height = HEAD + 2 * (ROW + PLOT_H + GAP) - GAP + PAD;
      for (const c of [canvas, stat]) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(height * dpr);
      }
      canvas.style.width = `${W}px`;
      canvas.style.height = `${height}px`;
      if (!sg || !g) return;
      sg.setTransform(dpr, 0, 0, dpr, 0, 0);
      sg.clearRect(0, 0, W, height);
      sg.textBaseline = 'alphabetic';
      sg.font = `600 10px ${pal.sans}`;
      sg.fillStyle = pal.text1;
      sg.fillText(m === 'camber' ? 'KAMBER / HAREKET' : 'HAREKET ORANI / MESAFE', PAD, 15);
      sg.font = `500 10px ${pal.sans}`;
      sg.fillStyle = pal.text3;
      sg.textAlign = 'right';
      if (previous && previousLabel) sg.fillText(`soluk: ${previousLabel}`, W - PAD, 15);
      for (let ai = 0; ai < 2; ai++) {
        const y0 = top(ai);
        const r = ranges[ai]!;
        sg.textAlign = 'left';
        sg.fillStyle = pal.text2;
        sg.font = `600 10px ${pal.sans}`;
        sg.fillText(ai === 0 ? 'ÖN' : 'ARKA', PAD, y0 - 4);
        // frame: zero travel + zero value guides, plot box hairlines
        sg.strokeStyle = pal.hair;
        sg.lineWidth = 1;
        sg.strokeRect(PAD + GUT + 0.5, y0 + 0.5, W - 2 * PAD - GUT - 1, PLOT_H - 1);
        sg.setLineDash([2, 3]);
        sg.beginPath();
        if (r[0] < 0 && r[1] > 0) {
          sg.moveTo(Math.round(px(ai, 0)) + 0.5, y0);
          sg.lineTo(Math.round(px(ai, 0)) + 0.5, y0 + PLOT_H);
        }
        const zeroY = m === 'camber' ? 0 : 1;
        if (r[2] < zeroY && r[3] > zeroY) {
          sg.moveTo(PAD + GUT, Math.round(py(ai, zeroY)) + 0.5);
          sg.lineTo(W - PAD, Math.round(py(ai, zeroY)) + 0.5);
        }
        sg.stroke();
        // axis word + range values (from the curves, not hand-typed)
        sg.font = `500 9px ${pal.sans}`;
        sg.fillStyle = pal.text3;
        sg.textAlign = 'right';
        // camber falls with bump, motion ratio usually rises: put the word where the curve is not
        sg.fillText('sıkışma →', W - PAD - 3, m === 'camber' ? y0 + 10 : y0 + PLOT_H - 3);
        sg.font = `500 9px ${pal.mono}`;
        const unit = m === 'camber' ? '°' : '';
        const label = (v: number) => `${fmt(v, 1)}${unit}`;
        sg.fillText(label(r[3]), PAD + GUT - 4, y0 + 8);
        sg.fillText(label(r[2]), PAD + GUT - 4, y0 + PLOT_H);
        const zy = py(ai, zeroY);
        if (zy > y0 + 16 && zy < y0 + PLOT_H - 14) sg.fillText(label(zeroY), PAD + GUT - 4, zy + 3);
        // previous suspension: faint dashed
        const prev = previous?.[ai];
        if (prev) {
          sg.strokeStyle = pal.text3;
          sg.lineWidth = 1.25;
          sg.setLineDash([3, 3]);
          curve(sg, ai, prev);
        }
        sg.setLineDash([]);
        const cur = plots[ai];
        if (cur) {
          sg.strokeStyle = pal.accent;
          sg.lineWidth = 1.75;
          curve(sg, ai, cur);
        }
      }
      g.font = `500 10px ${pal.mono}`;
      advance = g.measureText('0').width;
    },
    draw(t) {
      if (!g || !pal || height === 0) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, height);
      g.drawImage(stat, 0, 0, W, height);
      for (let ai = 0; ai < 2; ai++) {
        // live TRUE readout in the axle header: RC height (car) / mean motion ratio (motorcycle)
        const ax = t.axles[ai];
        const y0 = top(ai);
        g.fillStyle = pal.text1;
        if (metric === 'camber' && ax && Number.isFinite(ax.rollCentreHeight)) {
          g.font = `500 9px ${pal.sans}`;
          g.fillStyle = pal.text3;
          g.textAlign = 'right';
          g.fillText('mm', W - PAD, y0 - 4);
          g.textAlign = 'left';
          g.font = `500 10px ${pal.mono}`;
          g.fillStyle = pal.text1;
          const left = drawNumber(g, ax.rollCentreHeight * 1000, 0, W - PAD - 17, y0 - 4, advance);
          g.font = `500 9px ${pal.sans}`;
          g.fillStyle = pal.text3;
          g.textAlign = 'right';
          g.fillText('yalpa merkezi', left - 5, y0 - 4);
          g.textAlign = 'left';
        }
      }
      // one dot per wheel at its TRUE travel and body camber (left filled, right ring)
      for (let i = 0; i < t.corners.length; i++) {
        const c = t.corners[i]!;
        const ai = c.axle === 'front' ? 0 : 1;
        if (!ranges[ai]) continue;
        const r = ranges[ai];
        const v = metric === 'camber' ? c.camberBody * RAD_TO_DEG : c.motionRatio;
        if (!Number.isFinite(v) || !Number.isFinite(c.travel)) continue;
        const X = px(ai, Math.min(r[1], Math.max(r[0], c.travel)));
        const Y = py(ai, Math.min(r[3], Math.max(r[2], v)));
        g.beginPath();
        g.arc(X, Y, 3.6, 0, Math.PI * 2);
        if (c.side >= 0) {
          g.fillStyle = pal.text1;
          g.fill();
        } else {
          g.strokeStyle = pal.text1;
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      // legend
      g.font = `500 9px ${pal.sans}`;
      g.fillStyle = pal.text3;
      g.textAlign = 'right';
      g.fillText(t.corners.length === 4 ? '● sol  ○ sağ' : '● tekerlek', W - PAD, height - 3);
      g.textAlign = 'left';
    },
    setVisible(on) {
      root.hidden = !on;
    },
  };
}
