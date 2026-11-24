/**
 * Poll (ARCHITECTURE §9.2): live bars for the audience poll the presenter opens from the phone remote.
 * Big screen: read-only bars on the right edge. A viewer in a private room: the same card with tappable options.
 * A poll that closes while shown stays as "Final" for a short while, then the card goes away.
 */
import type { FeatureContext, FeatureModule } from '../../contracts/app';
import type { PollState } from '../../contracts/net';
import { ROOM } from '../../contracts/services';
import { h, mount } from '../../ui/dom';
import { pollBars, votesText } from './bars';
import './poll.css';

const FINAL_MS = 20_000;

function init(ctx: FeatureContext): void {
  if (ctx.flags.e2e) return; // no network room in e2e mode (§6.6)
  const room = ctx.services.get(ROOM);
  const screen = ctx.flags.screen;

  const state = h('span', { class: 'sl-poll-state sl-label' });
  const question = h('p', { class: 'sl-poll-question' });
  const list = h('ol', { class: 'sl-poll-options' });
  const total = h('span', { class: 'sl-poll-total' });
  const root = h(
    'section',
    { class: 'sl-poll', 'aria-label': 'İzleyici anketi', hidden: true, 'data-screen': screen },
    h('header', { class: 'sl-poll-head' }, h('span', { class: 'sl-poll-dot', 'aria-hidden': 'true' }), state, total),
    question,
    list,
  );
  ctx.addDisposer(mount(ctx.dom.overlay, root));

  let current: PollState | null = null;
  let finalTimer: ReturnType<typeof setTimeout> | null = null;
  const mine = new Map<string, number>();
  const clearFinal = () => {
    if (finalTimer) clearTimeout(finalTimer);
    finalTimer = null;
  };
  ctx.addDisposer(clearFinal);

  const visible = () => ctx.store.get().hudVisible && current !== null;

  function render(poll: PollState): void {
    const bars = pollBars(poll.counts);
    const chosen = mine.get(poll.id);
    root.dataset['open'] = String(poll.open);
    state.textContent = poll.open ? 'Canlı anket' : 'Sonuç';
    question.textContent = poll.question;
    total.textContent = votesText(bars.total);
    list.replaceChildren(
      ...poll.options.map((label, i) => {
        const fill = h('span', { class: 'sl-poll-fill' });
        fill.style.transform = `scaleX(${bars.percent[i]! / 100})`;
        const body = [h('span', { class: 'sl-poll-label' }, label), h('span', { class: 'sl-poll-pct' }, `${bars.percent[i]}%`), h('span', { class: 'sl-poll-track' }, fill)];
        const attrs = { class: 'sl-poll-option', 'data-lead': bars.leader === i, 'data-mine': chosen === i };
        if (screen || !poll.open) return h('li', attrs, ...body);
        const button = h('button', { type: 'button', class: 'sl-poll-vote', 'aria-pressed': String(chosen === i) }, ...body);
        button.addEventListener('click', () => {
          mine.set(poll.id, i);
          room.send({ t: 'vote', pollId: poll.id, choice: i });
          render(poll);
        });
        return h('li', attrs, button);
      }),
    );
  }

  function update(poll: PollState | null): void {
    clearFinal();
    // A closed poll is shown only if we were showing it (not after a reload).
    if (!poll || (!poll.open && current?.id !== poll.id)) current = null;
    else {
      current = poll;
      render(poll);
      if (!poll.open)
        finalTimer = setTimeout(() => {
          current = null;
          root.hidden = true;
        }, FINAL_MS);
    }
    root.hidden = !visible();
  }

  ctx.addDisposer(room.on('welcome', (m) => update(m.poll)));
  ctx.addDisposer(room.on('poll', (m) => update(m.poll)));
  ctx.watch(() => {
    root.hidden = !visible();
  });
}

export default { id: 'poll', requires: ['live-lab'], phase: 'overlay', init } satisfies FeatureModule;
