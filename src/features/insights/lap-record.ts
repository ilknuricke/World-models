/**
 * Delta chip data (pure). Per suspension id, TRUE camber/travel per corner and body pitch are binned by track
 * position. After a swap, the previous suspension's value at the car's CURRENT position is compared with the new
 * one, so the chip compares the same road. Only in a steady section (constant radius/speed) may it fall back to
 * the value just before the swap. Only Auto (the shared driving line and speed) is recorded or compared: a driven
 * car is somewhere else on the road at another speed, so "the same track position" means nothing there.
 */
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { Phenomenon } from '../../contracts/track';
import { deg, fmt, mm } from '../../ui/format';

export type DeltaMetric = 'camber' | 'travel' | 'pitch';

const STEADY: readonly Phenomenon[] = ['steady-state-roll', 'sustained-roll', 'settle'];
const VERTICAL: readonly Phenomenon[] = ['heave', 'single-wheel-bump', 'harshness', 'ride-resonance'];

/**
 * The quantity a section is about: pitch under braking, wheel travel over bumps, camber everywhere else. A single-track
 * vehicle's wheel camber is its lean, which the suspension does not set, so it compares travel instead.
 */
export function deltaMetric(p: Phenomenon | undefined, singleTrack = false): DeltaMetric {
  return p === 'brake-dive' ? 'pitch' : singleTrack || (p !== undefined && VERTICAL.includes(p)) ? 'travel' : 'camber';
}

export function isSteady(p: Phenomenon | undefined): boolean {
  return p !== undefined && STEADY.includes(p);
}

const MAX_FILL_BINS = 8;

export class LapRecord {
  readonly stride: number;
  private readonly records = new Map<string, Float32Array>();
  private lastBin = -1;
  private lastId = '';

  constructor(
    readonly corners: number,
    readonly trackLength: number,
    readonly bins = 1024,
  ) {
    this.stride = corners * 2 + 1;
  }

  bin(s: number): number {
    const u = (((s % this.trackLength) + this.trackLength) % this.trackLength) / this.trackLength;
    return Math.min(this.bins - 1, Math.floor(u * this.bins));
  }

  /** Seek: the next write starts a fresh run (no gap filling across the jump). */
  break(): void {
    this.lastBin = -1;
  }

  write(id: string, t: TelemetryFrame): void {
    if (t.drive.mode !== 'auto') {
      this.lastBin = -1;
      return;
    }
    let r = this.records.get(id);
    if (!r) {
      r = new Float32Array(this.bins * this.stride).fill(Number.NaN);
      this.records.set(id, r);
    }
    if (id !== this.lastId) this.lastBin = -1;
    this.lastId = id;
    const b = this.bin(t.s);
    const gap = this.lastBin < 0 ? 0 : (b - this.lastBin + this.bins) % this.bins;
    const fill = gap > 1 && gap <= MAX_FILL_BINS ? gap : 1;
    for (let i = 0; i < fill; i++) {
      const at = ((b - i + this.bins) % this.bins) * this.stride;
      for (let c = 0; c < this.corners; c++) {
        r[at + c * 2] = t.corners[c]!.camber;
        r[at + c * 2 + 1] = t.corners[c]!.travel;
      }
      r[at + this.corners * 2] = t.pitch;
    }
    this.lastBin = b;
  }

  /** Value recorded at s; with `back` > 0, the nearest recorded bin up to `back` bins behind s. */
  value(id: string, s: number, metric: DeltaMetric, corner: number, back = 0): number {
    const r = this.records.get(id);
    if (!r) return Number.NaN;
    const off = metric === 'pitch' ? this.corners * 2 : corner * 2 + (metric === 'travel' ? 1 : 0);
    const b = this.bin(s);
    for (let i = 0; i <= back; i++) {
      const v = r[((b - i + this.bins) % this.bins) * this.stride + off]!;
      if (v === v) return v;
    }
    return Number.NaN;
  }
}

export interface Delta {
  readonly metric: DeltaMetric;
  /** Corner index (-1 for a body quantity). */
  readonly corner: number;
  /** SI, previous suspension. */
  readonly before: number;
  /** SI, current suspension. */
  readonly after: number;
}

function current(t: TelemetryFrame, metric: DeltaMetric, corner: number): number {
  return metric === 'pitch' ? t.pitch : metric === 'travel' ? t.corners[corner]!.travel : t.corners[corner]!.camber;
}

/**
 * Previous suspension vs the live frame for the section's metric; per-corner metrics report the corner with the
 * largest difference. `fallbackS` (track position just before the swap) is used only when the same spot was never
 * driven by the previous suspension and the section is steady. Null when no honest comparison exists (always outside
 * Auto).
 */
export function computeDelta(rec: LapRecord, previous: string, t: TelemetryFrame, phenomenon: Phenomenon | undefined, fallbackS: number | null): Delta | null {
  if (t.drive.mode !== 'auto') return null;
  const metric = deltaMetric(phenomenon, t.corners.every((c) => c.side === 0));
  const pick = (s: number, back: number): Delta | null => {
    if (metric === 'pitch') {
      const before = rec.value(previous, s, metric, 0, back);
      return Number.isFinite(before) ? { metric, corner: -1, before, after: t.pitch } : null;
    }
    let best: Delta | null = null;
    for (let c = 0; c < t.corners.length; c++) {
      const before = rec.value(previous, s, metric, c, back);
      const after = current(t, metric, c);
      if (Number.isFinite(before) && (!best || Math.abs(after - before) > Math.abs(best.after - best.before))) best = { metric, corner: c, before, after };
    }
    return best;
  };
  return pick(t.s, 0) ?? (fallbackS !== null && isSteady(phenomenon) ? pick(fallbackS, MAX_FILL_BINS) : null);
}

const LABEL: Readonly<Record<DeltaMetric, string>> = { camber: 'Kamber', travel: 'Hareket', pitch: 'Öne yatma' };

/** Display parts of a delta (format.ts only): label, before, after. */
export function formatDelta(d: Delta, cornerLabel: string): { label: string; before: string; after: string } {
  const f = (v: number) => (d.metric === 'travel' ? fmt(mm(v), 0) + ' mm' : fmt(deg(v), d.metric === 'pitch' ? 2 : 1) + '°');
  return { label: d.corner < 0 ? LABEL[d.metric] : `${LABEL[d.metric]} ${cornerLabel}`, before: f(d.before), after: f(d.after) };
}
