/**
 * Attract-mode storyboard (research 21 §3), adapted to what the app has: a 60 s loop of beats, each with one shot,
 * one caption (≤ 8 words, no digits: numbers only ever come from the sim) and the store keys it sets.
 * Beats that need a particular stretch of road name its phenomenon; the director seeks there behind a fade.
 */
import type { DirectorShot } from '../../contracts/services';
import type { AppState } from '../../contracts/store';
import type { Phenomenon } from '../../contracts/track';

export type AttractPatch = Partial<Pick<AppState, 'xray' | 'overlay' | 'timeScale' | 'amplification'>>;

export interface Beat {
  /** Seconds of sim time at normal speed: the director advances by the sim's own progress divided by the time
   * scale, so a seek with `lead` lands on its section on any machine, however slow the frames. */
  readonly duration: number;
  readonly caption: string;
  /** Show the product title above the caption. */
  readonly title?: boolean;
  readonly shot: Omit<DirectorShot, 'durationS'>;
  /** Seek to the start of the first section showing this phenomenon, `lead` seconds early. */
  readonly at?: Phenomenon;
  readonly lead?: number;
  readonly patch: AttractPatch;
  /** Suspension to show: index offset from the one the visitor had (0 = theirs). */
  readonly swap: number;
  /** Show the motorcycle for this beat (when one is registered); other beats show the visitor's vehicle. */
  readonly bike?: boolean;
}

const CLEAN: AttractPatch = { xray: false, overlay: 'clean', timeScale: 1, amplification: 1 };

export const STORYBOARD: readonly Beat[] = [
  { duration: 8, title: true, caption: 'Her tümsek bir geometri problemidir.', shot: { kind: 'orbit' }, patch: CLEAN, swap: 0 },
  {
    duration: 8,
    caption: 'Tümsekte bağlantıların nasıl çalıştığını izleyin.',
    shot: { kind: 'closeup', corner: 'fl' },
    at: 'single-wheel-bump',
    lead: 3,
    patch: { ...CLEAN, xray: true },
    swap: 0,
  },
  {
    duration: 8,
    caption: 'Gövde yatması görünür hâlde.',
    shot: { kind: 'front-view' },
    at: 'roll-reversal',
    lead: 0.6,
    patch: { xray: false, overlay: 'engineer', timeScale: 0.25, amplification: 2.5 },
    swap: 0,
  },
  {
    duration: 8,
    caption: 'Yol tutuşunu geometri belirler.',
    shot: { kind: 'trackside' },
    at: 'steady-state-roll',
    lead: 1,
    patch: { ...CLEAN, overlay: 'engineer' },
    swap: 0,
  },
  {
    duration: 6,
    caption: 'Aynı tümsek. Farklı tepki.',
    shot: { kind: 'closeup', corner: 'fl' },
    at: 'single-wheel-bump',
    lead: 1.5,
    patch: { ...CLEAN, xray: true },
    swap: 1,
  },
  {
    duration: 5,
    caption: 'Aynı tümsek. Farklı tepki.',
    shot: { kind: 'closeup', corner: 'fl' },
    at: 'single-wheel-bump',
    lead: 1.5,
    patch: { ...CLEAN, xray: true },
    swap: 2,
  },
  { duration: 5, caption: 'Fren yapılır. Burun öne dalar.', shot: { kind: 'trackside' }, at: 'brake-dive', lead: 0.4, patch: CLEAN, swap: 0 },
  {
    duration: 8,
    caption: 'İki tekerlekte yükü çatal karşılar.',
    shot: { kind: 'closeup', corner: 'f' },
    at: 'brake-dive',
    lead: 1.5,
    // A naked bike shows its fork solid: x-ray would ghost the engine and frame away.
    patch: CLEAN,
    swap: 0,
    bike: true,
  },
  { duration: 4, title: true, caption: 'Keşfetmek için dokunun.', shot: { kind: 'chase' }, patch: CLEAN, swap: 0 },
];

export const loopDuration = (board: readonly Beat[]): number => board.reduce((sum, b) => sum + b.duration, 0);

/** Beat index and its start time at loop time t (wrapped). */
export function beatAt(board: readonly Beat[], t: number): { index: number; start: number } {
  const total = loopDuration(board);
  const x = ((t % total) + total) % total;
  let start = 0;
  for (let i = 0; i < board.length; i++) {
    const end = start + board[i]!.duration;
    if (x < end) return { index: i, start };
    start = end;
  }
  return { index: board.length - 1, start: total - board[board.length - 1]!.duration };
}

/** Fade (black) around seeks: out over FADE_OUT before a beat that seeks, back in over FADE_IN after it starts. */
export const FADE_OUT = 0.35;
export const FADE_IN = 0.5;

export function fadeAt(board: readonly Beat[], t: number): number {
  const { index, start } = beatAt(board, t);
  const total = loopDuration(board);
  const local = (((t % total) + total) % total) - start;
  const beat = board[index]!;
  const next = board[(index + 1) % board.length]!;
  const toEnd = beat.duration - local;
  let out = 0;
  if (next.at && toEnd < FADE_OUT) out = 1 - toEnd / FADE_OUT;
  if (beat.at && local < FADE_IN) out = Math.max(out, 1 - local / FADE_IN);
  return out;
}

/** Steps a wall clock through the board; returns the beat index that starts during this step, else -1. */
export function createTimeline(board: readonly Beat[]) {
  let t = 0;
  let current = -1;
  return {
    get time() {
      return t;
    },
    /** Call once with dt = 0 to start the first beat. */
    step(dt: number): number {
      t += dt;
      const { index } = beatAt(board, t);
      if (index === current) return -1;
      current = index;
      return index;
    },
  };
}
