import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMessageLayout } from '../../src/ui/message-layout';

class StyleStub {
  values = new Map<string, string>();
  getPropertyValue(name: string) { return this.values.get(name) ?? ''; }
  setProperty(name: string, value: string) { this.values.set(name, value); }
  removeProperty(name: string) { const old = this.getPropertyValue(name); this.values.delete(name); return old; }
}

class ElementStub {
  style = new StyleStub();
  hidden = false;
  mounted = true;
  classes = new Set<string>();
  visibility = 'visible';
  parent: ElementStub | null = null;
  children: ElementStub[] = [];
  rect = rectangle(0, 0, 0, 0);
  constructor(classes = '') { this.classes = new Set(classes.split(/\s+/).filter(Boolean)); }
  getBoundingClientRect() { return this.rect; }
  matches(selector: string): boolean {
    for (const match of selector.matchAll(/:not\(\.([\w-]+)\)/g)) if (this.classes.has(match[1]!)) return false;
    const required = [...selector.replace(/:not\([^)]*\)/g, '').matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
    return this.mounted && required.every((name) => this.classes.has(name));
  }
  querySelectorAll(selectors: string): ElementStub[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll(selectors)])
      .filter((child) => selectors.split(',').some((selector) => child.matches(selector.trim())));
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  append(child: ElementStub) { child.parent = this; this.children.push(child); return child; }
}

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) };
}

class ResizeStub {
  static instances: ResizeStub[] = [];
  targets = new Set<ElementStub>();
  disconnect = vi.fn(() => this.targets.clear());
  constructor(readonly callback: () => void) { ResizeStub.instances.push(this); }
  observe(element: ElementStub) { this.targets.add(element); }
}

class MutationStub {
  static instances: MutationStub[] = [];
  registrations: { target: ElementStub; options: MutationObserverInit }[] = [];
  disconnect = vi.fn(() => { this.registrations = []; });
  constructor(readonly callback: () => void) { MutationStub.instances.push(this); }
  observe(target: ElementStub, options: MutationObserverInit) { this.registrations.push({ target, options }); }
}

function mutate(target: ElementStub, attribute: string) {
  for (const observer of MutationStub.instances) {
    if (observer.registrations.some(({ target: watched, options }) => options.attributes
      && (watched === target || (options.subtree && isWithin(target, watched)))
      && (!options.attributeFilter || options.attributeFilter.includes(attribute)))) observer.callback();
  }
}
function isWithin(target: ElementStub, root: ElementStub): boolean {
  return target.parent === root || (target.parent !== null && isWithin(target.parent, root));
}

let viewport: { width: number; height: number };
let win: EventTarget & { visualViewport: EventTarget; matchMedia: (query: string) => { matches: boolean } };
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let dispose: (() => void) | undefined;
const flush = () => {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
};

function fixture(width = 844, height = 390) {
  viewport = { width, height };
  const overlay = new ElementStub();
  overlay.rect = rectangle(0, 0, width, height);
  overlay.style.setProperty('--margin', '10px');
  overlay.style.setProperty('--sl-hud-gap', '8px');
  overlay.style.setProperty('--sl-hud-zoom', '1');
  const stage = new ElementStub();
  const controls = overlay.append(new ElementStub('sl-controls-tr'));
  controls.rect = rectangle(width - 340, 10, 330, 44);
  const drive = overlay.append(new ElementStub('sl-drive is-driving'));
  drive.rect = rectangle(width / 2 - 150, height - 150, 300, 140);
  const hint = drive.append(new ElementStub('sl-drive-hint is-shown'));
  hint.rect = rectangle(width / 2 - 140, height - 80, 280, 70);
  const start = () => {
    dispose = installMessageLayout(overlay as unknown as HTMLElement, stage as unknown as HTMLElement);
    flush();
  };
  const rotate = (nextWidth: number, nextHeight: number) => {
    viewport = { width: nextWidth, height: nextHeight };
    overlay.rect = rectangle(0, 0, nextWidth, nextHeight);
    win.dispatchEvent(new Event('resize'));
    flush();
  };
  return { overlay, stage, drive, hint, start, rotate };
}

beforeEach(() => {
  viewport = { width: 844, height: 390 };
  frames = new Map(); nextFrame = 0;
  ResizeStub.instances = []; MutationStub.instances = [];
  win = Object.assign(new EventTarget(), {
    visualViewport: new EventTarget(),
    matchMedia: (query: string) => ({ matches: query.includes('orientation: landscape')
      ? viewport.width <= 960 && viewport.height <= 500 && viewport.width > viewport.height
      : viewport.width <= 720 || (viewport.width <= 960 && viewport.height <= 500) }),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', ResizeStub);
  vi.stubGlobal('MutationObserver', MutationStub);
  vi.stubGlobal('getComputedStyle', (element: ElementStub) => ({
    visibility: element.visibility,
    getPropertyValue: (name: string) => element.style.getPropertyValue(name),
  }));
});

afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); });

describe('landscape driving scene clearance', () => {
  it('reserves the scene above the complete driving bar only in a short landscape viewport', () => {
    const h = fixture(390, 844);
    h.start();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('0px');
    h.drive.rect = rectangle(260, 240, 300, 140);
    h.rotate(844, 390);
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('158px');
    h.rotate(390, 844);
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('0px');
    h.rotate(1280, 800);
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('0px');
  });

  it('releases the scene on Auto, hidden HUD or attract mode without requiring a resize', () => {
    const h = fixture(); h.start();
    const reserved = h.stage.style.getPropertyValue('--sl-mobile-scene-bottom');
    expect(reserved).toBe('158px');
    for (const flag of ['is-hidden', 'is-attract']) {
      h.drive.classes.add(flag); mutate(h.drive, 'class'); flush();
      expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('0px');
      h.drive.classes.delete(flag); mutate(h.drive, 'class'); flush();
      expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe(reserved);
    }
    h.drive.classes.delete('is-driving'); mutate(h.drive, 'class'); flush();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('0px');
  });

  it('tracks a hint appearing or disappearing even if the outer bar keeps the same size', () => {
    const h = fixture(); h.start();
    h.drive.rect = rectangle(270, 310, 300, 140);
    h.hint.classes.delete('is-shown'); mutate(h.hint, 'class'); flush();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('88px');
    h.drive.rect = rectangle(270, 240, 300, 140);
    h.hint.classes.add('is-shown'); mutate(h.hint, 'class'); flush();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('158px');
  });

  it('keeps a taller open sheet clear and restores driving clearance when that sheet closes', () => {
    const h = fixture();
    const sheet = h.overlay.append(new ElementStub('sl-engineer-panel'));
    sheet.rect = rectangle(10, 190, 824, 138);
    h.start();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('208px');
    sheet.hidden = true;
    for (const observer of ResizeStub.instances) if (observer.targets.has(sheet)) observer.callback();
    flush();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('158px');
  });

  it('does not reserve space for a drive bar hidden by its layout', () => {
    const h = fixture(); h.drive.visibility = 'hidden'; h.start();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('0px');
    h.drive.visibility = 'visible'; h.drive.rect = rectangle(0, 0, 0, 0);
    win.dispatchEvent(new Event('resize')); flush();
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('0px');
  });

  it('restores existing inline values and stops all scheduled work when disposed', () => {
    const h = fixture();
    h.stage.style.setProperty('--sl-mobile-scene-bottom', '12px');
    h.overlay.style.setProperty('--sl-caption-top', '99px');
    h.start();
    mutate(h.hint, 'data-kind');
    expect(frames.size).toBe(1);
    dispose!(); dispose = undefined;
    expect(frames.size).toBe(0);
    expect(h.stage.style.getPropertyValue('--sl-mobile-scene-bottom')).toBe('12px');
    expect(h.overlay.style.getPropertyValue('--sl-caption-top')).toBe('99px');
    expect(MutationStub.instances.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
    expect(ResizeStub.instances.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
    win.dispatchEvent(new Event('resize')); mutate(h.drive, 'class');
    expect(frames.size).toBe(0);
  });
});
