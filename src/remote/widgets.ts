/** Small DOM controls for the phone remote (built once, updated in place). */
import { h } from '../ui/dom';
import type { Choice } from './catalogue';

export interface Control<T> {
  readonly el: HTMLElement;
  set(value: T | undefined): void;
}

/** Radio group of large segments. */
export function segmented<T extends string | number>(name: string, choices: readonly Choice<T>[], onPick: (id: T) => void): Control<T> {
  const hint = h('p', { class: 'rm-hint' });
  const buttons = choices.map((c) => {
    const b = h('button', { type: 'button', role: 'radio', class: 'rm-seg', 'aria-checked': 'false', 'data-id': String(c.id) }, c.label);
    b.addEventListener('click', () => onPick(c.id));
    return b;
  });
  const group = h('div', { class: 'rm-segmented', role: 'radiogroup', 'aria-label': name }, ...buttons);
  group.style.setProperty('--n', String(choices.length));
  const el = h('div', { class: 'rm-field' }, group, hint);
  return {
    el,
    set(value) {
      const i = choices.findIndex((c) => c.id === value);
      buttons.forEach((b, j) => b.setAttribute('aria-checked', String(i === j)));
      group.style.setProperty('--i', String(i));
      group.toggleAttribute('data-none', i < 0);
      hint.textContent = choices[i]?.hint ?? '';
      hint.hidden = !hint.textContent;
    },
  };
}

/** On/off tile with a label and a sub-line. */
export function toggle(label: string, sub: string, onFlip: (next: boolean) => void): Control<boolean> {
  let on = false;
  const b = h(
    'button',
    { type: 'button', class: 'rm-toggle', 'aria-pressed': 'false' },
    h('span', { class: 'rm-toggle-label' }, label),
    h('span', { class: 'rm-toggle-sub' }, sub),
    h('span', { class: 'rm-switch', 'aria-hidden': 'true' }),
  );
  b.addEventListener('click', () => onFlip(!on));
  return {
    el: b,
    set(value) {
      on = value === true;
      b.setAttribute('aria-pressed', String(on));
    },
  };
}

export function card(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'rm-card' }, h('h2', { class: 'rm-card-title' }, title), ...children.filter((c): c is Node => c !== null));
}

/** Whole percentages adding to 100 (largest remainder) and the single leader (null on a tie or no votes). */
export function shares(counts: readonly number[]): { total: number; percent: number[]; leader: number | null } {
  const total = counts.reduce((a, b) => a + Math.max(0, b), 0);
  if (!total) return { total, percent: counts.map(() => 0), leader: null };
  const exact = counts.map((c) => (Math.max(0, c) / total) * 100);
  const percent = exact.map(Math.floor);
  let rest = 100 - percent.reduce((a, b) => a + b, 0);
  for (const [, i] of exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])) {
    if (rest-- <= 0) break;
    percent[i]!++;
  }
  const max = Math.max(...counts);
  const leaders = counts.flatMap((c, i) => (c === max ? [i] : []));
  return { total, percent, leader: leaders.length === 1 ? leaders[0]! : null };
}

export const votesText = (n: number): string => (n === 1 ? '1 oy' : `${n} oy`);

/** Poll option rows: label, percentage, bar. `onVote` makes them buttons. */
export function pollRows(options: readonly string[], counts: readonly number[], mine: number | null, onVote: ((i: number) => void) | null): HTMLElement {
  const s = shares(counts);
  return h(
    'ol',
    { class: 'rm-poll' },
    ...options.map((label, i) => {
      const fill = h('span', { class: 'rm-poll-fill' });
      fill.style.transform = `scaleX(${s.percent[i]! / 100})`;
      const inner = [
        fill,
        h('span', { class: 'rm-poll-label' }, label, mine === i ? h('span', { class: 'rm-poll-mine' }, 'Oyunuz') : null),
        h('span', { class: 'rm-poll-pct' }, `${s.percent[i]}%`),
      ];
      const attrs = { class: 'rm-poll-row', 'data-lead': s.leader === i, 'data-mine': mine === i };
      if (!onVote) return h('li', attrs, h('div', { class: 'rm-poll-item' }, ...inner));
      const b = h('button', { type: 'button', class: 'rm-poll-item', 'aria-pressed': String(mine === i) }, ...inner);
      b.addEventListener('click', () => onVote(i));
      return h('li', attrs, b);
    }),
  );
}
