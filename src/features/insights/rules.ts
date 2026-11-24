/**
 * Insight rules (pure). Each rule is keyed by a section phenomenon (a live signal crossing a threshold for a
 * sustained time) or by a simulation event. Templates contain NO digits: `{placeholders}` are filled from the
 * TRUE fields of the frame through src/ui/format.ts. No template ranks one suspension type over another; anything
 * not computed is worded as a tendency (ARCHITECTURE §14).
 */
import type { SimEvent } from '../../contracts/sim';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { Phenomenon } from '../../contracts/track';
import { deg, fmt, gUnits, kN, mm } from '../../ui/format';

export interface Rule {
  readonly id: string;
  readonly text: string;
  /** Number chip shown after the text; omitted = text only. */
  readonly chip?: string;
  /** Amber: a limit was reached (stop, lift, grip). */
  readonly warn?: boolean;
  /** Section rules: phenomena where the rule may fire, and the signal that must stay >= threshold for `sustain` s. */
  readonly phenomena?: readonly Phenomenon[];
  readonly signal?: (t: TelemetryFrame) => number;
  readonly threshold?: number;
  readonly sustain?: number;
  /** Fires on a sign flip of the signal while |signal| >= threshold (roll reversal) instead of on a level. */
  readonly flip?: boolean;
  /** Event rules. */
  readonly event?: SimEvent['kind'];
  /** Corner the placeholders {corner}/{wheel}/{camber}/{travel}/{load}/{grip} describe (event rules use the event's corner). */
  readonly focus?: (t: TelemetryFrame) => number;
  /** Rule only applies when it returns true (e.g. a car with a finite roll centre). */
  readonly applies?: (t: TelemetryFrame) => boolean;
}

export interface Insight {
  readonly id: string;
  readonly rule: Rule;
  /** Corner the placeholders describe. */
  readonly corner: number;
  readonly text: string;
  readonly chip: string;
  readonly warn: boolean;
}

const ROLL: readonly Phenomenon[] = ['sustained-roll', 'steady-state-roll', 'off-camber', 'steering-lock'];
const ROUGH: readonly Phenomenon[] = ['harshness', 'ride-resonance'];

const absAy = (t: TelemetryFrame) => Math.abs(gUnits(t.ay));
const ay = (t: TelemetryFrame) => gUnits(t.ay);
const braking = (t: TelemetryFrame) => -gUnits(t.ax);
const steer = (t: TelemetryFrame) => Math.abs(deg(t.steer));
function mostLoaded(t: TelemetryFrame): number {
  let best = 0;
  for (let i = 1; i < t.corners.length; i++) if (t.corners[i]!.load > t.corners[best]!.load) best = i;
  return best;
}
function mostTravel(t: TelemetryFrame): number {
  let best = 0;
  for (let i = 1; i < t.corners.length; i++) if (Math.abs(t.corners[i]!.travel) > Math.abs(t.corners[best]!.travel)) best = i;
  return best;
}
const maxTravel = (t: TelemetryFrame) => Math.abs(t.corners[mostTravel(t)]!.travel);
function maxRate(t: TelemetryFrame): number {
  let m = 0;
  for (let i = 0; i < t.corners.length; i++) m = Math.max(m, Math.abs(t.corners[i]!.travelRate));
  return m;
}
function meanTravel(t: TelemetryFrame): number {
  let sum = 0;
  for (let i = 0; i < t.corners.length; i++) sum += t.corners[i]!.travel;
  return Math.abs(sum / t.corners.length);
}
/** Left and right wheels: the body rolls outward in a turn (a motorcycle leans in, so these rules stay quiet). */
function twoTrack(t: TelemetryFrame): boolean {
  for (let i = 0; i < t.corners.length; i++) if (t.corners[i]!.side !== 0) return true;
  return false;
}
const singleTrack = (t: TelemetryFrame) => !twoTrack(t);
const accel = (t: TelemetryFrame) => gUnits(t.ax);
const cornerOf = (axle: 'front' | 'rear') => (t: TelemetryFrame) => {
  for (let i = 0; i < t.corners.length; i++) if (t.corners[i]!.axle === axle) return i;
  return 0;
};
const hasRollCentres = (t: TelemetryFrame) => twoTrack(t) && Number.isFinite(t.axles[0]!.rollCentreHeight) && Number.isFinite(t.axles[1]!.rollCentreHeight);

export const RULES: readonly Rule[] = [
  // ---- section phenomena
  {
    id: 'roll',
    phenomena: ROLL,
    signal: absAy,
    threshold: 0.35,
    sustain: 0.6,
    applies: twoTrack,
    text: 'Gövde virajın dışına yatar; dış lastikler daha fazla yük taşır.',
    chip: 'Yatma {roll}',
  },
  {
    id: 'outer-camber',
    phenomena: [...ROLL, 'lane-change'],
    signal: absAy,
    threshold: 0.45,
    sustain: 1,
    applies: twoTrack,
    focus: mostLoaded,
    text: 'Gövde yattıkça yük taşıyan tekerleğin yola göre kamber açısı değişir.',
    chip: 'Kamber {corner} {camber}',
  },
  {
    id: 'roll-centre',
    phenomena: ROLL,
    signal: absAy,
    threshold: 0.3,
    sustain: 2,
    applies: hasRollCentres,
    text: 'Bağlantılar, gövdenin etrafında yattığı yalpa merkezini belirler.',
    chip: 'Yalpa merkezi ön {rcFront} · arka {rcRear}',
  },
  {
    id: 'roll-reversal',
    phenomena: ['roll-reversal', 'lane-change'],
    signal: ay,
    threshold: 0.3,
    flip: true,
    applies: twoTrack,
    text: 'Yön değişir: yük diğer tarafa geçer.',
    chip: 'Yatma {roll}',
  },
  {
    id: 'brake-dive',
    phenomena: ['brake-dive'],
    signal: braking,
    threshold: 0.5,
    sustain: 0.3,
    applies: twoTrack,
    text: 'Frenleme yükü öne aktarır ve burun öne dalar.',
    chip: 'Öne yatma {pitch}',
  },
  // ---- single track (motorcycle): no roll centre or body roll; the whole bike leans and the fork carries the dive
  {
    id: 'lean',
    phenomena: ROLL,
    signal: absAy,
    threshold: 0.35,
    sustain: 0.6,
    applies: singleTrack,
    text: 'Motosiklet, yerçekimi viraj kuvvetini dengeleyene kadar virajın içine yatar.',
    chip: 'Yatma {roll} · yanal {ay}',
  },
  {
    id: 'fork-dive',
    phenomena: ['brake-dive'],
    signal: braking,
    threshold: 0.5,
    sustain: 0.3,
    applies: singleTrack,
    focus: cornerOf('front'),
    text: 'Frenlemede ön taraf yüklenir: çatal sıkışır ve direksiyon geometrisi değişir.',
    chip: 'Ön hareket {travel} · iz mesafesi {trail} · öne yatma {pitch}',
  },
  {
    id: 'squat',
    phenomena: ['ride-resonance', 'steering-lock', 'settle'],
    signal: accel,
    threshold: 0.25,
    sustain: 0.5,
    applies: singleTrack,
    focus: cornerOf('rear'),
    text: 'Gaz verildiğinde zincir salıncağı çeker; çökmeyi veya yükselmeyi geometri belirler.',
    chip: 'Arka hareket {travel} · çökmeye direnç {antiPitch}',
  },
  {
    id: 'steer',
    phenomena: ['steering-lock'],
    signal: steer,
    threshold: 5,
    sustain: 0.3,
    applies: twoTrack,
    text: 'Dar virajda ön tekerlekler direksiyon eksenleri etrafında döner.',
    chip: 'Direksiyon {steer}',
  },
  {
    id: 'heave',
    phenomena: ['heave'],
    signal: meanTravel,
    threshold: 0.015,
    sustain: 0.1,
    focus: mostTravel,
    text: 'Tepede hafifler, çukurda ağırlaşır: tekerlekler birlikte hareket eder.',
    chip: 'Hareket {corner} {travel}',
  },
  {
    id: 'single-bump',
    phenomena: ['single-wheel-bump'],
    signal: maxTravel,
    threshold: 0.025,
    sustain: 0,
    focus: mostTravel,
    text: 'Tümseği tek tekerlek karşılar: gövde yerine tekerleğin hareketini izleyin.',
    chip: 'Hareket {corner} {travel}',
  },
  {
    id: 'rough',
    phenomena: ROUGH,
    signal: maxRate,
    threshold: 0.3,
    sustain: 0.5,
    focus: mostTravel,
    text: 'Bozuk yolda tekerlekler hızlı hareket eder; yaylar ve amortisörler darbeleri süzer.',
    chip: 'Hareket {corner} {travel}',
  },
  // ---- simulation events
  { id: 'liftoff', event: 'liftoff', warn: true, text: '{wheel} tekerlek hafifler: üzerinde neredeyse hiç yük yoktur.', chip: 'Yük {corner} {load}' },
  { id: 'grip-limit', event: 'grip-limit', warn: true, text: '{wheel} lastik tutuş sınırına yaklaşıyor.', chip: 'Tutuş kullanımı {corner} {grip} · model' },
  { id: 'bump-stop', event: 'bump-stop', warn: true, text: '{wheel} tekerlek darbe takozuna dayandı.', chip: 'Hareket {corner} {travel}' },
];

const CORNER_NAME: Readonly<Record<string, string>> = { fl: 'sol ön', fr: 'sağ ön', rl: 'sol arka', rr: 'sağ arka', f: 'ön', r: 'arka' };
const CORNER_SHORT: Readonly<Record<string, string>> = { fl: 'SÖ', fr: 'SĞÖ', rl: 'SA', rr: 'SĞA', f: 'ön', r: 'arka' };
const signed = (v: number, d: number, unit: string) => (v > 0 && fmt(v, d) !== fmt(0, d) ? '+' : '') + fmt(v, d) + unit;

/** Fills `{placeholders}` from the frame (TRUE values) for `corner`. Unknown placeholders are left visible (test catches them). */
export function fill(template: string, t: TelemetryFrame, corner: number): string {
  const c = t.corners[corner] ?? t.corners[0]!;
  const rc = (i: number) => fmt(mm(t.axles[i]!.rollCentreHeight), 0) + ' mm';
  const values: Readonly<Record<string, () => string>> = {
    roll: () => fmt(Math.abs(deg(t.roll)), 1) + '°',
    pitch: () => fmt(Math.abs(deg(t.pitch)), 1) + '°',
    steer: () => fmt(Math.abs(deg(t.steer)), 1) + '°',
    ay: () => fmt(Math.abs(gUnits(t.ay)), 2) + ' g',
    corner: () => CORNER_SHORT[c.id] ?? c.id,
    wheel: () => CORNER_NAME[c.id] ?? c.id,
    camber: () => fmt(deg(c.camber), 1) + '°',
    travel: () => signed(mm(c.travel), 0, ' mm'),
    load: () => fmt(kN(c.load), 1) + ' kN',
    grip: () => fmt(c.gripUse * 100, 0) + '%',
    trail: () => fmt(mm(t.trail), 0) + ' mm',
    antiPitch: () => fmt(t.axles[c.axle === 'front' ? 0 : 1]!.antiPitch * 100, 0) + '%',
    rcFront: () => rc(0),
    rcRear: () => rc(1),
  };
  return template.replace(/\{(\w+)\}/g, (m, key: string) => values[key]?.() ?? m);
}

export function compose(rule: Rule, t: TelemetryFrame, corner: number): Insight {
  return { id: rule.id, rule, corner, text: fill(rule.text, t, corner), chip: rule.chip ? fill(rule.chip, t, corner) : '', warn: rule.warn ?? false };
}

/**
 * Insights speak in Auto only (11-02): while the visitor drives (or a run replays) there is no shared line and the coach
 * explains the driven car's moments instead, so the two never talk over each other.
 */
export function onSection(t: TelemetryFrame): boolean {
  return t.drive.mode === 'auto';
}

/** Minimum time between two captions, s. */
export const MIN_GAP_S = 8;
/** Minimum time before the same rule speaks again, s. */
export const RULE_COOLDOWN_S = 40;
/** A level rule re-arms once its signal drops below this fraction of the threshold. */
export const HYSTERESIS = 0.8;

/**
 * Rate-limited, hysteretic rule evaluator. Times are simulation seconds (paused = silent, slow motion = slower).
 * `tick` runs every UI tick without allocating unless a rule fires.
 */
export class InsightEngine {
  private lastShown = Number.NEGATIVE_INFINITY;
  private readonly lastByRule: Float64Array;
  private readonly above: Float64Array;
  private readonly armed: Uint8Array;
  private readonly sign: Int8Array;

  constructor(readonly rules: readonly Rule[] = RULES) {
    this.lastByRule = new Float64Array(rules.length).fill(Number.NEGATIVE_INFINITY);
    this.above = new Float64Array(rules.length).fill(Number.NaN);
    this.armed = new Uint8Array(rules.length).fill(1);
    this.sign = new Int8Array(rules.length);
  }

  /** Another caption (delta chip) used the slot. */
  markShown(now: number): void {
    this.lastShown = now;
  }

  /** Section change or seek: sustain timers and flip memory restart. */
  resetSection(): void {
    this.above.fill(Number.NaN);
    this.sign.fill(0);
  }

  private ready(i: number, now: number): boolean {
    return now - this.lastShown >= MIN_GAP_S && now - this.lastByRule[i]! >= RULE_COOLDOWN_S;
  }

  private fire(i: number, t: TelemetryFrame, corner: number, now: number): Insight {
    this.lastShown = now;
    this.lastByRule[i] = now;
    return compose(this.rules[i]!, t, corner);
  }

  tick(t: TelemetryFrame, phenomenon: Phenomenon | undefined, now: number): Insight | null {
    if (!onSection(t)) {
      // Driving: the coach speaks; sustain timers restart when the lap resumes.
      this.resetSection();
      return null;
    }
    let out: Insight | null = null;
    for (let i = 0; i < this.rules.length; i++) {
      const r = this.rules[i]!;
      if (!r.signal || !r.phenomena || phenomenon === undefined || !r.phenomena.includes(phenomenon)) continue;
      const v = r.signal(t);
      const thr = r.threshold ?? 0;
      if (r.flip) {
        if (Math.abs(v) < thr) continue;
        const s = v > 0 ? 1 : -1;
        const flipped = this.sign[i] !== 0 && this.sign[i] !== s;
        this.sign[i] = s;
        if (flipped && out === null && this.ready(i, now) && (!r.applies || r.applies(t))) out = this.fire(i, t, r.focus?.(t) ?? 0, now);
        continue;
      }
      if (v < thr * HYSTERESIS) {
        this.armed[i] = 1;
        this.above[i] = Number.NaN;
        continue;
      }
      if (v < thr) continue;
      if (this.above[i] !== this.above[i]) this.above[i] = now;
      if (out !== null || !this.armed[i] || now - this.above[i]! < (r.sustain ?? 0)) continue;
      if (!this.ready(i, now) || (r.applies && !r.applies(t))) continue;
      this.armed[i] = 0;
      out = this.fire(i, t, r.focus?.(t) ?? 0, now);
    }
    return out;
  }

  event(e: SimEvent, t: TelemetryFrame, now: number): Insight | null {
    if (!('corner' in e) || !onSection(t)) return null;
    for (let i = 0; i < this.rules.length; i++) {
      const r = this.rules[i]!;
      if (r.event === e.kind && this.ready(i, now)) return this.fire(i, t, e.corner, now);
    }
    return null;
  }
}
