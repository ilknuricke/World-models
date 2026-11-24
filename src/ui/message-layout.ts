/** Keep explanatory messages below the actual, possibly wrapped top-right controls. */
export function installMessageLayout(overlay: HTMLElement): () => void {
  let frame = 0;
  let disposed = false;
  const observed = new Set<Element>();
  const properties = ['--sl-message-top', '--sl-caption-top', '--sl-message-trace-top'] as const;
  const initial = properties.map((name) => overlay.style.getPropertyValue(name));
  const selectors = '.sl-controls-tr, .sl-controls-br, .sl-narration, .sl-insights, .sl-coach, .sl-engineer-answer';
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
    const captionTop = toolbarTop + (toolbar ? toolbar.height + gap : 0);
    const captionHeight = Math.max(box('.sl-insights')?.height ?? 0, box('.sl-coach')?.height ?? 0, box('.sl-engineer-answer')?.height ?? 0);
    const traceTop = captionTop + (captionHeight > 0 ? captionHeight + gap : 0);
    for (const [index, pixels] of [toolbarTop, captionTop, traceTop].entries()) {
      const name = properties[index]!;
      const value = `${Math.ceil((pixels - area.top) / zoom)}px`;
      if (overlay.style.getPropertyValue(name) !== value) overlay.style.setProperty(name, value);
    }
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(update);
  };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  const observe = () => {
    for (const el of overlay.querySelectorAll(selectors)) {
      if (observed.has(el)) continue;
      observed.add(el);
      resize?.observe(el);
    }
    schedule();
  };
  const children = new MutationObserver(observe);
  children.observe(overlay, { childList: true });
  resize?.observe(overlay);
  window.addEventListener('resize', schedule);
  observe();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    children.disconnect();
    resize?.disconnect();
    observed.clear();
    window.removeEventListener('resize', schedule);
    properties.forEach((name, index) => {
      if (initial[index]) overlay.style.setProperty(name, initial[index]!);
      else overlay.style.removeProperty(name);
    });
  };
}
