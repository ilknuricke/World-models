/** Keep messages below controls and reserve a clear landscape scene between the visible HUD bands. */
export function installMessageLayout(overlay: HTMLElement, stage?: HTMLElement): () => void {
  let frame = 0;
  let disposed = false;
  const observed = new Set<Element>();
  const properties = ['--sl-message-top', '--sl-caption-top', '--sl-message-trace-top', '--sl-landscape-strip-right', '--sl-mobile-scene-top', '--sl-mobile-speed-visibility'] as const;
  const initial = properties.map((name) => overlay.style.getPropertyValue(name));
  const sceneProperties = ['--sl-mobile-scene-top', '--sl-mobile-scene-bottom'] as const;
  const initialScene = sceneProperties.map((name) => stage?.style.getPropertyValue(name) ?? '');
  const topMenus = ['.sl-controls-tag', '.sl-controls-tr', '.sl-controls-br', '.sl-narration', '.sl-landscape-strip', '.sl-controls-amp', '.sl-controls-restore'];
  const bottomMenus = ['.sl-engineer-toggle', '.sl-engineer-panel', '.sl-telemetry-toggle', '.sl-telemetry-panel', '.sl-drive-steer', '.sl-drive-pedals', '.sl-drive-panel', '.sl-insights', '.sl-coach', '.sl-teaching-overlays-trace', '.sl-controls-help', '.sl-ghost-lab', '.sl-ghost-lab-note', '.sl-replay-share', '.sl-replay-note'];
  const movingMenus = ['.sl-controls-bc', '.sl-drive:not(.is-hidden):not(.is-attract)', '.sl-drive-actions'];
  const selectors = [...topMenus, ...bottomMenus, ...movingMenus, '.sl-drive', '.sl-drive-hint', '.sl-engineer-answer'].join(', ');
  const box = (selector: string): DOMRect | null => {
    const el = overlay.querySelector<HTMLElement>(selector);
    if (!el || el.hidden || getComputedStyle(el).visibility === 'hidden') return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const update = () => {
    frame = 0;
    if (disposed) return;
    const style = getComputedStyle(overlay);
    const zoom = Number.parseFloat(style.getPropertyValue('--sl-hud-zoom')) || 1;
    const gap = (Number.parseFloat(style.getPropertyValue('--sl-hud-gap')) || 8) * zoom;
    const margin = (Number.parseFloat(style.getPropertyValue('--margin')) || 24) * zoom;
    const area = overlay.getBoundingClientRect();
    let controlsBottom = area.top + margin;
    const controls = box('.sl-controls-tr');
    if (controls) controlsBottom = Math.max(controlsBottom, controls.bottom);
    // The camera controls move to the top-right on narrower screens.
    const view = box('.sl-controls-br');
    if (view && view.top < area.top + area.height / 2) controlsBottom = Math.max(controlsBottom, view.bottom);
    const toolbarTop = controlsBottom + gap;
    const toolbar = box('.sl-narration');
    const compact = typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 720px), (max-width: 960px) and (max-height: 500px)').matches;
    const captionTop = compact
      ? Math.max(controlsBottom, toolbar?.bottom ?? controlsBottom) + gap
      : toolbarTop + (toolbar ? toolbar.height + gap : 0);
    const captionHeight = Math.max(box('.sl-insights')?.height ?? 0, box('.sl-coach')?.height ?? 0, compact ? 0 : box('.sl-engineer-answer')?.height ?? 0);
    if (stage) {
      const sheet = compact ? box('.sl-engineer-panel') ?? box('.sl-telemetry-panel') : null;
      const landscape = compact && window.matchMedia('(max-width: 960px) and (max-height: 500px) and (orientation: landscape)').matches;
      let top = 0;
      let bottom = sheet ? Math.max(0, area.bottom - sheet.top + gap) : 0;
      if (landscape) {
        let topEdge = area.top;
        let bottomEdge = area.bottom;
        for (const selector of topMenus) {
          const menu = box(selector);
          if (menu) topEdge = Math.max(topEdge, menu.bottom + gap);
        }
        // Popovers are separate from their parent's box; measure every matching panel.
        for (const selector of bottomMenus) {
          for (const el of overlay.querySelectorAll<HTMLElement>(selector)) {
            if (el.hidden || getComputedStyle(el).visibility === 'hidden') continue;
            const menu = el.getBoundingClientRect();
            if (menu.width > 0 && menu.height > 0) bottomEdge = Math.min(bottomEdge, menu.top - gap);
          }
        }
        for (const selector of movingMenus) {
          const menu = box(selector);
          if (!menu) continue;
          if (menu.top + menu.height / 2 < area.top + area.height / 2) topEdge = Math.max(topEdge, menu.bottom + gap);
          else bottomEdge = Math.min(bottomEdge, menu.top - gap);
        }
        top = Math.max(0, topEdge - area.top);
        bottom = Math.max(0, area.bottom - bottomEdge);
      }
      for (const [index, pixels] of [top, bottom].entries()) {
        const name = sceneProperties[index]!;
        const value = `${Math.ceil(pixels)}px`;
        if (stage.style.getPropertyValue(name) !== value) stage.style.setProperty(name, value);
      }
      // The read-only speed badge lives on the sibling overlay and follows this inset without reserving space.
      const sceneTop = `${Math.ceil(top)}px`;
      if (overlay.style.getPropertyValue('--sl-mobile-scene-top') !== sceneTop) overlay.style.setProperty('--sl-mobile-scene-top', sceneTop);
      // A 36px badge plus its 8px top inset must fit inside the remaining scene.
      const speedVisibility = area.height - Math.ceil(top) - Math.ceil(bottom) >= 44 ? 'visible' : 'hidden';
      if (overlay.style.getPropertyValue('--sl-mobile-speed-visibility') !== speedVisibility) overlay.style.setProperty('--sl-mobile-speed-visibility', speedVisibility);
    }
    const traceTop = captionTop + (captionHeight > 0 ? captionHeight + gap : 0);
    for (const [index, pixels] of [toolbarTop, captionTop, traceTop].entries()) {
      const name = properties[index]!;
      const value = `${Math.ceil((pixels - area.top) / zoom)}px`;
      if (overlay.style.getPropertyValue(name) !== value) overlay.style.setProperty(name, value);
    }
    const stripRight = `${Math.ceil((controls ? area.right - controls.left + gap : margin) / zoom)}px`;
    if (overlay.style.getPropertyValue('--sl-landscape-strip-right') !== stripRight) overlay.style.setProperty('--sl-landscape-strip-right', stripRight);
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(update);
  };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  // A dock can change position or visibility without changing size. Ignore our own CSS variable writes.
  const visibility = new MutationObserver(schedule);
  const observe = () => {
    for (const el of overlay.querySelectorAll(selectors)) {
      if (observed.has(el)) continue;
      observed.add(el);
      resize?.observe(el);
      visibility.observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'data-kind'] });
    }
    schedule();
  };
  const children = new MutationObserver(observe);
  children.observe(overlay, { childList: true });
  resize?.observe(overlay);
  window.addEventListener('resize', schedule);
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  observe();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    children.disconnect();
    resize?.disconnect();
    visibility.disconnect();
    observed.clear();
    window.removeEventListener('resize', schedule);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    if (stage) {
      sceneProperties.forEach((name, index) => {
        if (initialScene[index]) stage.style.setProperty(name, initialScene[index]!);
        else stage.style.removeProperty(name);
      });
    }
    properties.forEach((name, index) => {
      if (initial[index]) overlay.style.setProperty(name, initial[index]!);
      else overlay.style.removeProperty(name);
    });
  };
}
