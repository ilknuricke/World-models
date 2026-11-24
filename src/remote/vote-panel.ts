/** Audience phone panel: waits for the presenter's poll, then one big tap per option (re-vote replaces). */
import type { ClientMessage, PollState } from '../contracts/net';
import { h } from '../ui/dom';
import { pollRows, shares, votesText } from './widgets';

export interface VotePanel {
  readonly el: HTMLElement;
  poll(poll: PollState | null): void;
  viewers(n: number): void;
}

const MINE_KEY = 'sl-remote-vote:';

function readMine(pollId: string): number | null {
  try {
    const v = sessionStorage.getItem(MINE_KEY + pollId);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function writeMine(pollId: string, choice: number): void {
  try {
    sessionStorage.setItem(MINE_KEY + pollId, String(choice));
  } catch {
    /* in-memory only */
  }
}

export function createVotePanel(send: (message: ClientMessage) => void): VotePanel {
  let poll: PollState | null = null;
  let mine: number | null = null;
  let count = 0;
  const el = h('div', { class: 'rm-panel rm-vote' });

  function render(): void {
    if (!poll) {
      el.replaceChildren(
        h(
          'section',
          { class: 'rm-card rm-wait' },
          h('span', { class: 'rm-pulse', 'aria-hidden': 'true' }),
          h('h2', { class: 'rm-wait-title' }, 'Laboratuvara katıldınız'),
          h('p', { class: 'rm-note' }, 'Büyük ekranı izleyin. Sunucu bir soru sorduğunda buradan oy verebilirsiniz.'),
          count > 0 ? h('p', { class: 'rm-wait-count' }, `Laboratuvarda ${count} kişi`) : null,
        ),
      );
      return;
    }
    const p = poll;
    const s = shares(p.counts);
    const vote = (i: number) => {
      mine = i;
      writeMine(p.id, i);
      send({ t: 'vote', pollId: p.id, choice: i });
      render();
    };
    el.replaceChildren(
      h(
        'section',
        { class: 'rm-card rm-ballot', 'data-open': String(p.open) },
        h('p', { class: 'rm-card-title' }, p.open ? 'Canlı anket' : 'Anket kapandı'),
        h('h2', { class: 'rm-ballot-q' }, p.question),
        pollRows(p.options, p.counts, mine, p.open ? vote : null),
        h(
          'p',
          { class: 'rm-note' },
          p.open ? (mine === null ? 'Bir yanıta dokunun. Anket kapanana kadar oyunuzu değiştirebilirsiniz.' : 'Oyunuz sayıldı. Değiştirmek için başka bir yanıta dokunun.') : `Sonuç · ${votesText(s.total)}`,
        ),
      ),
    );
  }

  render();
  return {
    el,
    poll(next) {
      if (next?.id !== poll?.id) mine = next ? readMine(next.id) : null;
      poll = next;
      render();
    },
    viewers(n) {
      count = n;
      if (!poll) render();
    },
  };
}
