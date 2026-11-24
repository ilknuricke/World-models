/** Keyboard map (UI-01) as a pure function: key + current state -> store patch or a UI command. */
import { AMPLIFICATION_ON, type AppState, type ViewMode } from '../../contracts/store';

export const SLOW_MO = 0.25;

/** Letters the drive feature owns outside Auto. */
const DRIVE_LETTERS: ReadonlySet<string> = new Set(['w', 'a', 's', 'd']);

export const VIEW_KEYS: Readonly<Record<string, ViewMode>> = { f: 'follow', e: 'explore', c: 'closeup' };

export interface KeyContext {
  /** Suspension ids of the current vehicle, in UI order (keys 1..n). */
  readonly suspensions: readonly string[];
  /** First vehicle of another class, or null when only one class is registered. */
  readonly otherVehicleId: string | null;
}

export type KeyResult = Partial<AppState> | 'help' | 'escape' | null;

/** `key` is KeyboardEvent.key. Returns null for keys the HUD does not handle. */
export function keyAction(key: string, s: Readonly<AppState>, k: KeyContext): KeyResult {
  if (key === '?') return 'help';
  if (key === 'Escape') return 'escape';
  if (key === ' ') return { paused: !s.paused };
  const digit = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
  if (digit >= 0) {
    const id = k.suspensions[digit];
    return id === undefined ? null : { suspensionId: id };
  }
  const lower = key.toLowerCase();
  // While the visitor drives (or the car returns / replays), W A S D belong to the drive feature (ARCH-M2 §10.1).
  if (s.driveMode !== 'auto' && DRIVE_LETTERS.has(lower)) return null;
  const view = VIEW_KEYS[lower];
  if (view) return { view };
  switch (lower) {
    case 'x':
      // Close-up looks through the body at the linkage: x-ray stays on there (the help card says so).
      return s.view === 'closeup' ? null : { xray: !s.xray };
    case 'v':
      return k.otherVehicleId === null ? null : { vehicleId: k.otherVehicleId };
    case 's':
      return { timeScale: s.timeScale === 1 ? SLOW_MO : 1 };
    case 'a':
      return { amplification: s.amplification === 1 ? AMPLIFICATION_ON : 1 };
    case 'h':
      return { hudVisible: !s.hudVisible };
    default:
      return null;
  }
}

/** "Rejoin live": run at real time again and let the kernel seek to the shared lap. */
export const LIVE_PATCH: Partial<AppState> = { paused: false, timeScale: 1, clock: 'live' };

/** Amplification text (HON-02 / ARCHITECTURE §14.2); the factor comes from the store. */
export function amplificationText(amplification: number): string {
  return `Hareket ×${amplification} · değerler gerçek ölçekte`;
}
