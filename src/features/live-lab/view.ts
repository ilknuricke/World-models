/** Presence readout: "N in the lab" + live suspension distribution. Updated only on presence messages (<= 1 Hz). */
import { h } from '../../ui/dom';
import { watchingText, type Segment } from './presence';

export interface PresenceView {
  readonly root: HTMLElement;
  render(viewers: number, segs: readonly Segment[]): void;
  hide(): void;
}

export function createPresenceView(): PresenceView {
  const count = h('span', { class: 'sl-live-lab-count' });
  const bar = h('div', { class: 'sl-live-lab-bar', 'aria-hidden': 'true' });
  const legend = h('div', { class: 'sl-live-lab-legend' });
  const root = h(
    'section',
    { class: 'sl-live-lab', 'aria-label': 'Canlı Laboratuvar', hidden: true },
    h('div', { class: 'sl-live-lab-head' }, h('span', { class: 'sl-live-lab-dot', 'aria-hidden': 'true' }), count),
    bar,
    legend,
  );
  return {
    root,
    render(viewers, segs) {
      count.textContent = watchingText(viewers);
      bar.replaceChildren(
        ...segs.map((s) => {
          const seg = h('span', { class: 'sl-live-lab-seg', 'data-mine': s.mine, title: `${s.label}: ${s.count}` });
          seg.style.flexGrow = String(s.count);
          return seg;
        }),
      );
      legend.replaceChildren(
        ...segs.map((s) => h('span', { class: 'sl-live-lab-item', 'data-mine': s.mine }, `${s.label} `, h('b', {}, s.count))),
      );
      bar.hidden = legend.hidden = segs.length === 0;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}
