/**
 * Pure sound mapping: telemetry -> playback rates and gains (bounded), plus the one ramp helper every
 * parameter change goes through. No WebAudio here, so it is unit-tested (tests/features/audio.test.ts).
 */
import type { VehicleClass } from '../../contracts/suspension';

/** Exponential approach time constant for every parameter change, s (no zipper noise, no clicks). */
export const RAMP_TAU = 0.06;
export const MASTER_GAIN = 0.7;

/** Pseudo gearbox: upper speed of each gear, m/s (the loop is one sample, so "rpm" is its playback rate). */
const GEARS: Readonly<Record<VehicleClass, readonly number[]>> = {
  car: [13, 23, 33, 44, 56, 70, 90],
  motorcycle: [11, 19, 27, 35, 44, 54, 70],
};
const RATE: Readonly<Record<VehicleClass, readonly [idle: number, redline: number]>> = {
  car: [0.52, 1.38],
  motorcycle: [0.8, 2.15],
};
export const RATE_MIN = 0.5;
export const RATE_MAX = 2.2;
export const ENGINE_GAIN_MAX = 0.5;
export const SKID_GAIN_MAX = 0.32;
export const THUMP_GAIN_MAX = 0.6;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Revs after an upshift, as a fraction of the band. */
const SHIFT_DROP = 0.45;

/** 0 (idle) .. 1 (redline): first gear rises from idle, every later gear from SHIFT_DROP. */
export function engineRevs(cls: VehicleClass, speed: number): number {
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  let lo = 0;
  for (const hi of GEARS[cls]) {
    if (v < hi) {
      const base = lo === 0 ? 0 : SHIFT_DROP;
      return base + (1 - base) * ((v - lo) / (hi - lo));
    }
    lo = hi;
  }
  return 1;
}

export interface Tone {
  rate: number;
  gain: number;
}

/**
 * Engine loop: rate from the pseudo revs, gain from throttle (forward acceleration ax, m/s^2) with a quieter
 * overrun under braking. Slow motion lowers the pitch; pause silences it. Writes into `out` (no allocation).
 */
export function engineTone(out: Tone, cls: VehicleClass, speed: number, ax: number, timeScale: number, paused: boolean): Tone {
  const revs = engineRevs(cls, speed);
  const [idle, red] = RATE[cls];
  const slow = 0.5 + 0.5 * clamp(Number.isFinite(timeScale) ? timeScale : 1, 0, 1);
  out.rate = clamp((idle + (red - idle) * revs) * slow, RATE_MIN, RATE_MAX);
  const a = Number.isFinite(ax) ? ax : 0;
  const throttle = clamp(a / 4, 0, 1);
  const overrun = clamp(-a / 6, 0, 1);
  const gain = 0.16 + 0.24 * throttle + 0.1 * revs - 0.06 * overrun;
  out.gain = paused ? 0 : clamp(gain, 0, ENGINE_GAIN_MAX);
  return out;
}

/** Tyre noise from the highest grip use (a model estimate, 0..~1.2): nothing below 0.8, full by 1.05. */
export function skidTone(out: Tone, maxGripUse: number, speed: number, paused: boolean): Tone {
  const g = Number.isFinite(maxGripUse) ? maxGripUse : 0;
  out.rate = clamp(0.9 + 0.3 * clamp((g - 0.8) / 0.4, 0, 1), RATE_MIN, RATE_MAX);
  out.gain = paused ? 0 : SKID_GAIN_MAX * smoothstep(0.8, 1.05, g) * smoothstep(2, 6, Math.abs(speed));
  return out;
}

/** Wheel-travel rate (m/s) above which a corner "thumps" (kerb, bump); also the hysteresis re-arm level is half. */
export const THUMP_RATE = 0.45;

/** One-shot gain for a travel-rate spike (kerbs, bumps) or a bump-stop hit (`stop` = 1). */
export function thumpGain(travelRate: number, stop = 0): number {
  const fromRate = clamp((Math.abs(travelRate) - THUMP_RATE) / 0.9, 0, 1);
  return THUMP_GAIN_MAX * clamp(0.35 + 0.65 * Math.max(fromRate, stop), 0, 1);
}

/** The subset of AudioParam the ramp needs (fakes in tests). */
export interface RampParam {
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
}

/** Moves `param` toward `target` smoothly; skips tiny changes so the automation timeline stays short. */
export function ramp(param: RampParam, last: { v: number }, target: number, now: number, eps = 1e-3): void {
  if (Math.abs(target - last.v) < eps) return;
  last.v = target;
  param.setTargetAtTime(target, now, RAMP_TAU);
}

// ---- Manual Drive (11-02; research m2/18 §2): real engine speed and load, a tyre cue before the limit, road texture

/**
 * Engine loop from the powertrain's real engine speed (rpm, idle..redline of the car's model powertrain) and the
 * applied throttle (load): the pitch follows the revs, so shifts, launch and overrun are heard as they happen.
 */
export function engineToneDrive(out: Tone, cls: VehicleClass, rpm: number, idleRpm: number, redlineRpm: number, throttle: number, timeScale: number, paused: boolean): Tone {
  const span = redlineRpm - idleRpm;
  const revs = Number.isFinite(rpm) && span > 0 ? clamp((rpm - idleRpm) / span, 0, 1) : 0;
  const [idle, red] = RATE[cls];
  const slow = 0.5 + 0.5 * clamp(Number.isFinite(timeScale) ? timeScale : 1, 0, 1);
  out.rate = clamp((idle + (red - idle) * revs) * slow, RATE_MIN, RATE_MAX);
  const load = Number.isFinite(throttle) ? clamp(throttle, 0, 1) : 0;
  out.gain = paused ? 0 : clamp(0.14 + 0.28 * load + 0.08 * revs, 0, ENGINE_GAIN_MAX);
  return out;
}

export interface EngineColour {
  pulseRate: number;
  cutoff: number;
  intake: number;
  intakeFrequency: number;
}

/** Independent engine colour: intake opens under load, overrun closes the exhaust's high-frequency band. */
export function engineColour(out: EngineColour, cls: VehicleClass, revs: number, load: number, rpm: number, timeScale: number): EngineColour {
  const r = clamp(Number.isFinite(revs) ? revs : 0, 0, 1);
  const l = clamp(Number.isFinite(load) ? load : 0, 0, 1);
  const slow = 0.5 + 0.5 * clamp(Number.isFinite(timeScale) ? timeScale : 1, 0, 1);
  const idle = cls === 'car' ? 900 : 1100;
  const speed = Number.isFinite(rpm) && rpm > 0 ? clamp(rpm, idle, cls === 'car' ? 8000 : 10000) : idle + r * (cls === 'car' ? 5800 : 6900);
  out.pulseRate = speed / 3000 * slow;
  out.cutoff = cls === 'car' ? 650 + 1100 * r + 1800 * l : 1200 + 2100 * r + 3200 * l;
  out.intake = l * (cls === 'car' ? 0.06 + 0.10 * r : 0.10 + 0.20 * r);
  out.intakeFrequency = cls === 'car' ? 550 + 1200 * r : 1100 + 2200 * r;
  return out;
}

/** Slip ratio and tan(slip angle) clearly past the tyre curve's peak (model estimates for the GT coupe: about 1.25x). */
const PAST_PEAK_KAPPA = 0.2;
const PAST_PEAK_ALPHA = 0.15;

/**
 * How close one tyre is to (or past) its limit, 0..~1.2, from the model's grip use. Past the peak the model's force
 * falls a little while the tyre slides, so a slip clearly past the peak counts as over the limit.
 */
export function tyreUse(gripUse: number, slipAngle: number, slipRatio: number): number {
  const g = Number.isFinite(gripUse) ? clamp(gripUse, 0, 1.2) : 0;
  return Math.abs(slipRatio) > PAST_PEAK_KAPPA || Math.abs(slipAngle) > PAST_PEAK_ALPHA ? Math.max(g, 1.1) : g;
}

/** Squeal begins at this tyre use (a warning before the limit, research m2/18) and is full at the limit. */
export const SQUEAL_ONSET = 0.75;

/** Tyre cue while driving: silent below SQUEAL_ONSET, full at 1, pitch rising into the slide; gated by speed. */
export function squealTone(out: Tone, use: number, speed: number, paused: boolean): Tone {
  const u = Number.isFinite(use) ? use : 0;
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  out.rate = clamp(0.85 + 0.35 * smoothstep(SQUEAL_ONSET, 1.15, u), RATE_MIN, RATE_MAX);
  out.gain = paused ? 0 : SKID_GAIN_MAX * smoothstep(SQUEAL_ONSET, 1, u) * smoothstep(2, 6, v);
  return out;
}

export interface SurfaceTone {
  /** Gain of the filtered noise bed. */
  gain: number;
  /** Band-pass centre, Hz. */
  freq: number;
  /** Texture (amplitude modulation) rate, Hz, and depth 0..1. */
  mod: number;
  depth: number;
}

export const SURFACE_GAIN_MAX = 0.22;
/** Stone and kerb-stripe spacing the texture rate follows (m; the proving ground's cobbles are 0.12-0.15 m). */
export const PAVE_STONE = 0.15;
export const KERB_STRIPE = 0.5;
const SURFACE_FREQ: Readonly<Record<string, number>> = { asphalt: 110, 'asphalt-wet': 900, kerb: 260, pave: 190, grass: 80, 'ceramic-wet': 1200 };
/** Texture heard even on a smooth stretch of that surface (cobbles and kerbs always buzz). */
const SURFACE_FLOOR: Readonly<Record<string, number>> = { kerb: 0.6, pave: 0.45, 'asphalt-wet': 0.25, 'ceramic-wet': 0.25 };

/**
 * Road noise: a band-passed noise bed whose level follows how hard the wheels work (mean |travel rate|, m/s — rough
 * road, washboard and kerbs move them fast, and the frame-to-frame level carries the washboard's beat), coloured per
 * surface; cobbles and kerbs add a texture at the rate the stones or stripes pass under the tyre.
 */
export function surfaceTone(out: SurfaceTone, surface: string, roughness: number, speed: number, paused: boolean): SurfaceTone {
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  const r = Number.isFinite(roughness) ? Math.abs(roughness) : 0;
  const level = Math.max(clamp(r / 0.4, 0, 1), SURFACE_FLOOR[surface] ?? 0);
  out.freq = SURFACE_FREQ[surface] ?? SURFACE_FREQ.asphalt!;
  out.gain = paused ? 0 : SURFACE_GAIN_MAX * level * smoothstep(1, 5, v);
  out.mod = surface === 'pave' ? clamp(v / PAVE_STONE, 0, 80) : surface === 'kerb' ? clamp(v / KERB_STRIPE, 0, 60) : 0;
  out.depth = surface === 'pave' ? 0.6 : surface === 'kerb' ? 0.8 : 0;
  return out;
}
