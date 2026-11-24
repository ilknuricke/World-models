/** Pure poll maths shared by the screen bars and the in-app vote chip. */

export interface PollBars {
  readonly total: number;
  /** Whole percentages that add up to 100 (largest remainder), all 0 when nobody voted. */
  readonly percent: readonly number[];
  /** Index of the single leading option, or null (no votes or a tie). */
  readonly leader: number | null;
}

export function pollBars(counts: readonly number[]): PollBars {
  const total = counts.reduce((a, b) => a + Math.max(0, b), 0);
  if (total === 0) return { total, percent: counts.map(() => 0), leader: null };
  const exact = counts.map((c) => (Math.max(0, c) / total) * 100);
  const percent = exact.map(Math.floor);
  let rest = 100 - percent.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    percent[i]!++;
    rest--;
  }
  const max = Math.max(...counts);
  const leaders = counts.flatMap((c, i) => (c === max ? [i] : []));
  return { total, percent, leader: leaders.length === 1 ? leaders[0]! : null };
}

export const votesText = (n: number): string => (n === 1 ? '1 oy' : `${n} oy`);
