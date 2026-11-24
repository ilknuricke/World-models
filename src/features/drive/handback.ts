/**
 * Hand-back and recovery decisions (plan 10-04; ARCHITECTURE-M2 §10.2; orchestrator decisions 2 and 5). Pure.
 * On the loop (or beside it) Enter / the pill / the idle timer start Returning: the autopilot drives the same car back
 * onto the driving line and latches without a cut. From the proving-ground annex the car is released at once with a
 * short fade (driving back across the grass would take up to a minute). Out of bounds: fade and reset at the nearest
 * valid point (the loop's driving line or a station's spawn).
 */
import type { StationDefinition } from '../../contracts/world';
import type { RecoveryState } from '../../sim-core/drive/path-driver';

/** Beyond this distance from the loop's driving line the hand-back is a release, m. */
export const LOOP_NEAR = 40;

/** Fade timing, s: `out` before an action we start ourselves, `in` after every cut (0.35 s, research m2/22). */
export const FADE = { out: 0.15, in: 0.35 } as const;

export type HandBack = 'return' | 'release';

/**
 * 'return' when the car is on or beside the loop (a finite line offset within LOOP_NEAR, not on an annex zone),
 * 'release' otherwise. `annex` = the world's zone ids plus its field.
 */
export function handBackKind(zone: string, lineOffset: number, annex: ReadonlySet<string>): HandBack {
  if (annex.has(zone)) return 'release';
  return Math.abs(lineOffset) <= LOOP_NEAR ? 'return' : 'release'; // NaN (off the loop corridor) → release
}

/**
 * Where to put the car after it left the drivable region: the nearest station spawn when it is closer than the loop
 * (distance `loopDistance` m from the loop centreline), else undefined = the nearest driving-line point.
 */
export function nearestSpawn(x: number, y: number, loopDistance: number, stations: readonly StationDefinition[]): string | undefined {
  let best: string | undefined;
  let bestD = loopDistance === loopDistance ? loopDistance : Infinity;
  for (const st of stations) {
    const d = Math.hypot(st.spawn.x - x, st.spawn.y - y);
    if (d < bestD) {
      bestD = d;
      best = st.id;
    }
  }
  return best;
}

/** The Returning chip's words for the autopilot state. */
export function returningLabel(state: RecoveryState | undefined): string {
  return state === 'track' || state === 'resume' ? 'Tura dönülüyor…' : 'Sürüş çizgisi aranıyor…';
}

/** Fade overlay opacity for a fade started `t` s ago; `withOut` = it fades out first (we start the action). */
export function fadeOpacity(t: number, withOut: boolean): number {
  if (t < 0) return 0;
  if (withOut && t < FADE.out) return t / FADE.out;
  const u = (t - (withOut ? FADE.out : 0)) / FADE.in;
  return u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
}
