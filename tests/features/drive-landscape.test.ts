import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext, ResolvedFlags } from '../../src/contracts/app';
import { mountLandscapeControls } from '../../src/features/drive/landscape';
import { createStore } from '../../src/kernel/store';

let doc: { activeElement: ElementStub | null; createElement: () => ElementStub; createComment: () => NodeStub };
let moves: number;

class NodeStub extends EventTarget {
  parentNode: ElementStub | null = null;
  get nextSibling(): NodeStub | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  remove() {
    if (this instanceof ElementStub && this.contains(doc.activeElement)) doc.activeElement = null;
    if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
}

class ElementStub extends NodeStub {
  childNodes: NodeStub[] = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string | undefined> = {};
  hidden = false;
  private classes = new Set<string>();
  classList = {
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force: boolean) => { if (force) this.classes.add(name); else this.classes.delete(name); return force; },
  };
  constructor(classes = '') { super(); this.classes = new Set(classes.split(/\s+/).filter(Boolean)); }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get children(): ElementStub[] { return this.childNodes.filter((node): node is ElementStub => node instanceof ElementStub); }
  contains(node: NodeStub | null): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  insertBefore<T extends NodeStub>(node: T, before: NodeStub | null): T {
    if (before === node) return node;
    node.remove();
    const index = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    if (index < 0) throw new Error('Reference node is not a child');
    this.childNodes.splice(index, 0, node); node.parentNode = this; moves++;
    return node;
  }
  append(...nodes: NodeStub[]) { for (const node of nodes) this.insertBefore(node, null); }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'class') this.classes = new Set(value.split(/\s+/));
    if (name === 'hidden') this.hidden = true;
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = value;
  }
  querySelector<T = ElementStub>(selector: string): T | null {
    for (const child of this.children) {
      if (child.classList.contains(selector.slice(1))) return child as T;
      const found = child.querySelector<T>(selector);
      if (found) return found;
    }
    return null;
  }
  focus() { doc.activeElement = this; }
}

class MediaStub extends EventTarget {
  constructor(public matches: boolean) { super(); }
  change(matches: boolean) { this.matches = matches; this.dispatchEvent(new Event('change')); }
}

class ObserverStub {
  static instances: ObserverStub[] = [];
  registrations: { target: unknown; options: MutationObserverInit }[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) { ObserverStub.instances.push(this); }
  observe(target: unknown, options: MutationObserverInit) { this.registrations.push({ target, options }); }
  disconnect() { this.disconnected = true; }
  fire() { if (!this.disconnected) this.callback(); }
}

const flags: ResolvedFlags = { features: {}, paused: false, screen: false, debug: false, e2e: true };
const disposers: (() => void)[] = [];

function narration() {
  const root = new ElementStub('sl-narration');
  const voice = new ElementStub('sl-narration-toggle');
  const notes = new ElementStub('sl-narration-notes');
  root.append(voice, notes);
  return { root, voice, notes };
}

function fixture(landscape = true, withNarration = true) {
  const media = new MediaStub(landscape);
  const query = vi.fn(() => media);
  vi.stubGlobal('matchMedia', query);
  const overlay = new ElementStub();
  const tag = new ElementStub('sl-controls-tag');
  const narrator = narration();
  const pill = new ElementStub('sl-drive-pill');
  const toggle = new ElementStub('sl-drive-toggle');
  const readout = new ElementStub('sl-drive-readout');
  const stations = new ElementStub('sl-drive-stations-btn');
  const assists = new ElementStub('sl-drive-aids-btn');
  pill.append(toggle, readout, stations, assists);
  overlay.append(tag);
  if (withNarration) overlay.append(narrator.root);
  overlay.append(pill);
  const store = createStore(flags, false);
  const ctx = {
    dom: { overlay }, store,
    watch: (handler: Parameters<typeof store.subscribe>[0]) => disposers.push(store.subscribe(handler)),
    addDisposer: (dispose: () => void) => disposers.push(dispose),
  } as unknown as FeatureContext;
  const start = () => mountLandscapeControls(ctx, pill as unknown as HTMLElement, {
    toggle: toggle as unknown as HTMLButtonElement, stations: stations as unknown as HTMLButtonElement, assists: assists as unknown as HTMLButtonElement,
    readout: readout as unknown as HTMLElement,
  });
  return { overlay, tag, narrator, pill, toggle, readout, stations, assists, store, media, query, start };
}

beforeEach(() => {
  moves = 0;
  doc = { activeElement: null, createElement: () => new ElementStub(), createComment: () => new NodeStub() };
  ObserverStub.instances = [];
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('MutationObserver', ObserverStub);
});
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); vi.unstubAllGlobals(); });

describe('landscape driving controls', () => {
  it('moves the same buttons after narration and the same readout into a direct overlay HUD', () => {
    const h = fixture();
    const handlers = [vi.fn(), vi.fn(), vi.fn()];
    [h.toggle, h.stations, h.assists].forEach((button, index) => button.addEventListener('click', handlers[index]!));
    h.start();
    const strip = h.overlay.querySelector<ElementStub>('.sl-landscape-strip')!;
    const host = h.overlay.querySelector<ElementStub>('.sl-drive-mode-control')!;
    const speedHud = h.overlay.querySelector<ElementStub>('.sl-drive-speed-hud')!;
    expect(strip.children).toEqual([h.narrator.root, h.tag]);
    expect(h.narrator.root.children).toEqual([h.narrator.voice, host, h.narrator.notes]);
    expect(host.children).toEqual([h.toggle, h.stations, h.assists]);
    expect(h.pill.children).toEqual([]);
    expect(speedHud.parentNode).toBe(h.overlay);
    expect(speedHud.children).toEqual([h.readout]);
    expect(speedHud.attributes.get('aria-hidden')).toBe('true');
    expect(speedHud.hidden).toBe(true);
    for (const button of host.children) button.dispatchEvent(new Event('click'));
    for (const handler of handlers) expect(handler).toHaveBeenCalledOnce();
    const stable = moves;
    ObserverStub.instances[0]!.fire();
    expect(moves).toBe(stable); // Its own overlay mutations settle without reordering the controls again.
    expect(h.query).toHaveBeenCalledWith('(max-width: 960px) and (max-height: 500px) and (orientation: landscape)');
  });

  it('lets a focused strip scroll with arrow keys without forwarding them as steering input', () => {
    const h = fixture(); h.start();
    const strip = h.overlay.querySelector<ElementStub>('.sl-landscape-strip')!;
    expect(strip.attributes.get('tabindex')).toBe('0');
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowRight' });
    const stop = vi.spyOn(event, 'stopPropagation');
    strip.dispatchEvent(event);
    expect(stop).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false); // Browser scrolling remains available.
  });

  it('restores original ordering on portrait and preserves focus on both rotations', () => {
    const h = fixture(false); h.start();
    expect(h.overlay.querySelector<ElementStub>('.sl-drive-speed-hud')).toBe(null);
    h.toggle.focus();
    h.media.change(true);
    const speedHud = h.overlay.querySelector<ElementStub>('.sl-drive-speed-hud')!;
    expect(speedHud.children).toEqual([h.readout]);
    expect(doc.activeElement).toBe(h.toggle);
    h.media.change(false);
    expect(speedHud.parentNode).toBe(null);
    expect(speedHud.children).toEqual([]);
    expect(doc.activeElement).toBe(h.toggle);
    expect(h.pill.children).toEqual([h.toggle, h.readout, h.stations, h.assists]);
    expect(h.narrator.root.children).toEqual([h.narrator.voice, h.narrator.notes]);
    expect(h.overlay.children.slice(0, 3)).toEqual([h.tag, h.narrator.root, h.pill]);
    h.media.change(true);
    expect(h.overlay.querySelector<ElementStub>('.sl-drive-mode-control')!.children[0]).toBe(h.toggle);
    expect(h.overlay.querySelector<ElementStub>('.sl-drive-speed-hud')).toBe(speedHud);
    expect(speedHud.children).toEqual([h.readout]);
  });

  it('adopts narration mounted later without duplicating buttons or observing its own subtree', () => {
    const h = fixture(true, false); h.start();
    const host = h.overlay.querySelector<ElementStub>('.sl-drive-mode-control')!;
    const strip = h.overlay.querySelector<ElementStub>('.sl-landscape-strip')!;
    expect(host.parentNode).toBe(strip);
    expect(strip.children).toEqual([host, h.tag]);
    h.overlay.append(h.narrator.root);
    ObserverStub.instances[0]!.fire();
    expect(h.narrator.root.children).toEqual([h.narrator.voice, host, h.narrator.notes]);
    expect(strip.children).toEqual([h.narrator.root, h.tag]);
    expect(ObserverStub.instances[0]!.registrations).toEqual([{ target: h.overlay, options: { childList: true } }]);
    h.media.change(false);
    expect(h.narrator.root.parentNode).toBe(h.overlay);
    expect(h.narrator.root.children).toEqual([h.narrator.voice, h.narrator.notes]);
  });

  it('shows speed only during available manual landscape driving and follows HUD or attract hiding', () => {
    const h = fixture(); const controls = h.start();
    const host = h.overlay.querySelector<ElementStub>('.sl-drive-mode-control')!;
    const strip = h.overlay.querySelector<ElementStub>('.sl-landscape-strip')!;
    const speedHud = h.overlay.querySelector<ElementStub>('.sl-drive-speed-hud')!;
    expect(speedHud.hidden).toBe(true);
    controls.update('manual', true);
    expect(host.dataset.mode).toBe('manual');
    expect(host.hidden).toBe(false);
    expect(speedHud.dataset.mode).toBe('manual');
    expect(speedHud.hidden).toBe(false);
    controls.update('auto', false);
    expect(host.dataset.mode).toBe('auto');
    expect(host.hidden).toBe(true);
    expect(speedHud.dataset.mode).toBe('auto');
    expect(speedHud.hidden).toBe(true);
    controls.update('auto', true);
    expect(host.hidden).toBe(false);
    expect(speedHud.hidden).toBe(true);
    controls.update('manual', false);
    expect(speedHud.hidden).toBe(true);
    controls.update('manual', true);
    expect(speedHud.hidden).toBe(false);
    h.store.setKey('hudVisible', false);
    expect(strip.classList.contains('is-hidden')).toBe(true);
    expect(speedHud.classList.contains('is-hidden')).toBe(true);
    h.store.setKey('hudVisible', true);
    expect(strip.classList.contains('is-hidden')).toBe(false);
    expect(speedHud.classList.contains('is-hidden')).toBe(false);
    h.store.setKey('attract', true);
    expect(strip.classList.contains('is-hidden')).toBe(true);
    expect(speedHud.classList.contains('is-hidden')).toBe(true);
    h.store.setKey('attract', false);
    expect(speedHud.classList.contains('is-hidden')).toBe(false);
    h.media.change(false);
    expect(speedHud.hidden).toBe(true);
    expect(h.readout.parentNode).toBe(h.pill);
    controls.update('manual', true);
    expect(speedHud.hidden).toBe(true);
    h.media.change(true);
    expect(speedHud.hidden).toBe(false);
  });

  it('restores controls on cleanup and stops responding to later media, observer and mode updates', () => {
    const h = fixture(); const controls = h.start();
    const host = h.overlay.querySelector<ElementStub>('.sl-drive-mode-control')!;
    const speedHud = h.overlay.querySelector<ElementStub>('.sl-drive-speed-hud')!;
    h.assists.focus();
    for (const dispose of disposers.splice(0).reverse()) dispose();
    expect(h.pill.children).toEqual([h.toggle, h.readout, h.stations, h.assists]);
    expect(doc.activeElement).toBe(h.assists);
    expect(h.overlay.children).toEqual([h.tag, h.narrator.root, h.pill]);
    expect(ObserverStub.instances[0]!.disconnected).toBe(true);
    expect(speedHud.parentNode).toBe(null);
    expect(speedHud.children).toEqual([]);
    h.media.change(false); h.media.change(true); ObserverStub.instances[0]!.fire(); controls.update('manual', false);
    expect(host.hidden).toBe(false);
    expect(speedHud.dataset.mode).toBe('auto');
    expect(speedHud.hidden).toBe(true);
    expect(h.overlay.children).toEqual([h.tag, h.narrator.root, h.pill]);
  });

  it('does not resurrect narration removed by its owning feature while restoring the driving buttons', () => {
    const h = fixture(); h.start();
    h.narrator.root.remove();
    h.media.change(false);
    expect(h.narrator.root.parentNode).toBe(null);
    expect(h.pill.children).toEqual([h.toggle, h.readout, h.stations, h.assists]);
  });

  it('leaves the original layout in place when media queries are unavailable', () => {
    const h = fixture(); vi.stubGlobal('matchMedia', undefined); h.start();
    expect(h.pill.children).toEqual([h.toggle, h.readout, h.stations, h.assists]);
    expect(h.overlay.querySelector<ElementStub>('.sl-landscape-strip')!.hidden).toBe(true);
    expect(h.overlay.querySelector<ElementStub>('.sl-drive-speed-hud')).toBe(null);
  });
});
