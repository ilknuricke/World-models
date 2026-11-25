import type { FeatureContext } from '../../contracts/app';
import { h, mount } from '../../ui/dom';

const LANDSCAPE = '(max-width: 960px) and (max-height: 500px) and (orientation: landscape)';

/** Move the same driving controls and readout into the landscape HUD, preserving their owners. */
export function mountLandscapeControls(
  c: FeatureContext,
  pill: HTMLElement,
  controls: { toggle: HTMLButtonElement; stations: HTMLButtonElement; assists: HTMLButtonElement; readout: HTMLElement },
): { update(mode: 'auto' | 'manual', available: boolean): void } {
  const overlay = c.dom.overlay;
  const strip = h('div', { class: 'sl-landscape-strip', role: 'group', 'aria-label': 'Sürüş kontrolleri', tabindex: 0, hidden: true });
  const host = h('div', { class: 'sl-drive-pill sl-drive-mode-control', 'data-mode': pill.dataset.mode ?? 'auto' });
  const speedHud = h('div', { class: 'sl-drive-speed-hud', 'aria-hidden': 'true', 'data-mode': pill.dataset.mode ?? 'auto', hidden: true });
  strip.append(host);
  const unmount = mount(overlay, strip);
  const origins = new Map<HTMLElement, Comment>();
  const media = typeof matchMedia === 'function' ? matchMedia(LANDSCAPE) : null;
  let active = false;
  let disposed = false;
  let mode: 'auto' | 'manual' = pill.dataset.mode === 'manual' ? 'manual' : 'auto';
  let available = false;

  const syncSpeedVisibility = () => { speedHud.hidden = !active || !available || mode !== 'manual'; };

  const place = (node: HTMLElement, parent: HTMLElement, before: ChildNode | null = null) => {
    if (node === before || (node.parentElement === parent && node.nextSibling === before)) return;
    const focused = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : null;
    parent.insertBefore(node, before);
    focused?.focus({ preventScroll: true });
  };
  const move = (node: HTMLElement, parent: HTMLElement, before: ChildNode | null = null) => {
    if (!origins.has(node)) {
      const marker = document.createComment('landscape control position');
      node.parentNode?.insertBefore(marker, node);
      origins.set(node, marker);
    }
    place(node, parent, before);
  };
  const restore = () => {
    for (const [node, marker] of origins) {
      // A feature can have disposed its own tag/narration while this helper was active.
      if (marker.parentNode && (strip.contains(node) || host.contains(node) || speedHud.contains(node))) {
        const focused = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : null;
        marker.parentNode.insertBefore(node, marker);
        focused?.focus({ preventScroll: true });
      }
      marker.remove();
    }
    origins.clear();
    place(host, strip);
  };
  const sync = () => {
    if (disposed) return;
    const next = media?.matches === true;
    if (!next) {
      if (active) restore();
      active = false;
      strip.hidden = true;
      speedHud.remove();
      syncSpeedVisibility();
      return;
    }
    active = true;
    strip.hidden = false;
    if (speedHud.parentElement !== overlay) overlay.append(speedHud);
    move(controls.readout, speedHud);
    syncSpeedVisibility();
    move(controls.toggle, host, host.firstChild);
    move(controls.stations, host, controls.toggle.nextSibling);
    move(controls.assists, host, controls.stations.nextSibling);
    const narration = overlay.querySelector<HTMLElement>('.sl-narration');
    if (narration) {
      move(narration, strip, strip.firstChild);
      const voice = narration.querySelector<HTMLElement>('.sl-narration-toggle');
      place(host, narration, voice?.nextSibling ?? narration.firstChild);
    } else place(host, strip, strip.firstChild);
    const tag = overlay.querySelector<HTMLElement>('.sl-controls-tag');
    if (tag) move(tag, strip);
  };
  // Arrow keys scroll a focused toolbar instead of becoming steering input on the window.
  strip.addEventListener('keydown', (event) => {
    if (event.target === strip && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.stopPropagation();
  });
  const observer = new MutationObserver(sync);
  observer.observe(overlay, { childList: true });
  media?.addEventListener('change', sync);
  c.watch((state) => {
    const hidden = state.attract || !state.hudVisible;
    strip.classList.toggle('is-hidden', hidden);
    speedHud.classList.toggle('is-hidden', hidden);
  });
  sync();
  c.addDisposer(() => {
    disposed = true;
    observer.disconnect();
    media?.removeEventListener('change', sync);
    restore();
    host.remove();
    speedHud.remove();
    unmount();
  });
  return {
    update(nextMode, nextAvailable) {
      if (disposed) return;
      mode = nextMode;
      available = nextAvailable;
      host.dataset.mode = mode;
      host.hidden = !available;
      speedHud.dataset.mode = mode;
      syncSpeedVisibility();
    },
  };
}
