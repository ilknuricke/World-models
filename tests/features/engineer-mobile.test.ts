/** Responsive ownership of the real answer node, voice, and input; geometry is checked in the browser. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext, FrameInfo, ResolvedFlags } from '../../src/contracts/app';
import type { AppEvents } from '../../src/contracts/events';
import engineer from '../../src/features/engineer';
import { createBus } from '../../src/kernel/bus';
import { createStore } from '../../src/kernel/store';
import { createSimulation } from '../../src/sim-core';

const speech = vi.hoisted(() => ({ say: vi.fn(), clear: vi.fn(), setFocused: vi.fn(), dispose: vi.fn() }));
vi.mock('../../src/ui/narration', () => ({ acquireNarration: () => speech }));

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  hidden = false;
  value = '';
  focus = vi.fn();
  blur = vi.fn();
  private styles = new Map<string, string>();
  style = {
    setProperty: (name: string, value: string) => this.styles.set(name, value),
    removeProperty: (name: string) => { const value = this.styles.get(name) ?? ''; this.styles.delete(name); return value; },
    getPropertyValue: (name: string) => this.styles.get(name) ?? '',
  };
  private text = '';
  private attributes = new Map<string, string>();
  private classes = new Set<string>();
  classList = {
    contains: (name: string) => this.classes.has(name),
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name); else this.classes.delete(name);
      return on;
    },
  };
  constructor(readonly tagName: string) { super(); }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'class') this.classes = new Set(value.split(/\s+/));
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  append(...children: (ElementStub | string)[]) {
    for (const child of children) {
      if (typeof child === 'string') { this.text += child; continue; }
      child.remove(); child.parent = this; this.children.push(child);
    }
  }
  replaceChildren(...children: (ElementStub | string)[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = '';
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

class CompactMedia extends EventTarget {
  matches = true;
  resize(matches: boolean) { this.matches = matches; this.dispatchEvent(new Event('change')); }
}

function find(root: ElementStub, className: string): ElementStub {
  if (root.classList.contains(className)) return root;
  for (const child of root.children) {
    try { return find(child, className); } catch { /* next child */ }
  }
  throw new Error(`Missing test element ${className}`);
}

const disposers: (() => void)[] = [];
let media: CompactMedia;
const flags: ResolvedFlags = { features: {}, paused: false, screen: false, debug: false, e2e: true };
function mount() {
  const overlay = new ElementStub('DIV');
  const bus = createBus();
  const store = createStore(flags, false);
  const current = createSimulation({
    catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined },
    trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: 'macpherson',
  });
  const frame = current.sample(1);
  const ctx = {
    store, bus, sim: { current, frame }, dom: { overlay },
    addDisposer: (dispose: () => void) => disposers.push(dispose),
    on: <K extends keyof AppEvents>(type: K, handler: (event: AppEvents[K]) => void) => {
      bus.on(type, handler); disposers.push(() => bus.off(type, handler));
    },
    watch: (handler: Parameters<typeof store.subscribe>[0]) => disposers.push(store.subscribe(handler)),
  } as unknown as FeatureContext;
  engineer.init!(ctx);
  engineer.update!({ dt: 0.1, time: 1, alpha: 1, t: frame } satisfies FrameInfo);
  return { overlay, store };
}
function dispose() { for (const item of disposers.splice(0).reverse()) item(); }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

beforeEach(() => {
  media = new CompactMedia();
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, createElement: (tag: string) => new ElementStub(tag.toUpperCase()) }));
  vi.stubGlobal('localStorage', { getItem: () => 'synthetic-client-id', setItem: () => {} });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ text: 'Yük dış tekerleklere aktarılıyor.', actions: [], source: 'model' })));
});
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('mobile engineer sheet', () => {
  it('closes on a compact automatic-drive takeover, while allowing later manual questions and desktop use', () => {
    const { overlay, store } = mount();
    const toggle = find(overlay, 'sl-engineer-toggle');
    const panel = find(overlay, 'sl-engineer-panel');
    const root = find(overlay, 'sl-engineer');
    toggle.dispatchEvent(new Event('click'));
    expect(store.get().engineerOpen).toBe(true);
    store.setKey('driveMode', 'manual');
    expect(store.get().engineerOpen).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(root.classList.contains('is-open')).toBe(false);
    toggle.dispatchEvent(new Event('click'));
    store.setKey('timeScale', 0.25);
    expect(store.get().engineerOpen).toBe(true);
    expect(panel.hidden).toBe(false);
    store.setKey('driveMode', 'auto');
    store.setKey('driveMode', 'manual');
    expect(store.get().engineerOpen).toBe(false);
    media.resize(false);
    toggle.dispatchEvent(new Event('click'));
    store.setKey('driveMode', 'auto');
    store.setKey('driveMode', 'manual');
    expect(store.get().engineerOpen).toBe(true);
    expect(panel.hidden).toBe(false);
  });

  it('tracks the visible viewport above a software keyboard and removes its listeners on disposal', () => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    vi.stubGlobal('window', { matchMedia: () => media, innerHeight: 844, visualViewport: viewport });
    const { overlay } = mount();
    const root = find(overlay, 'sl-engineer');
    expect(root.style.getPropertyValue('--sl-engineer-keyboard-inset')).toBe('0px');
    expect(root.style.getPropertyValue('--sl-engineer-viewport-height')).toBe('844px');
    viewport.height = 420;
    viewport.offsetTop = 12;
    viewport.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--sl-engineer-keyboard-inset')).toBe('412px');
    expect(root.style.getPropertyValue('--sl-engineer-viewport-height')).toBe('420px');
    expect(root.classList.contains('is-keyboard-open')).toBe(true);
    viewport.offsetTop = 32;
    viewport.dispatchEvent(new Event('scroll'));
    expect(root.style.getPropertyValue('--sl-engineer-keyboard-inset')).toBe('392px');
    viewport.height = 844;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--sl-engineer-keyboard-inset')).toBe('0px');
    expect(root.classList.contains('is-keyboard-open')).toBe(false);
    media.resize(false);
    expect(root.style.getPropertyValue('--sl-engineer-keyboard-inset')).toBe('');
    expect(root.style.getPropertyValue('--sl-engineer-viewport-height')).toBe('');
    media.resize(true);
    dispose();
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(root.style.getPropertyValue('--sl-engineer-keyboard-inset')).toBe('0px');
    expect(root.style.getPropertyValue('--sl-engineer-viewport-height')).toBe('844px');
  });

  it('starts closed and keeps one status node through phone and desktop transitions', () => {
    const { overlay } = mount();
    const answer = find(overlay, 'sl-engineer-answer');
    const panel = find(overlay, 'sl-engineer-panel');
    const toggle = find(overlay, 'sl-engineer-toggle');
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(answer.parent).toBe(panel);
    media.resize(false);
    expect(answer.parent).toBe(overlay);
    media.resize(true);
    expect(answer.parent).toBe(panel);
    expect(find(overlay, 'sl-engineer-answer')).toBe(answer);
    dispose();
    media.resize(false);
    expect(answer.parent).toBeNull();
    expect(overlay.children).toEqual([]);
  });

  it('reads an answer inside the sheet, dismisses the keyboard, and lets the visitor close or reopen it', async () => {
    const { overlay, store } = mount();
    const panel = find(overlay, 'sl-engineer-panel');
    const answer = find(overlay, 'sl-engineer-answer');
    const input = find(overlay, 'sl-engineer-input');
    const toggle = find(overlay, 'sl-engineer-toggle');
    toggle.dispatchEvent(new Event('click'));
    expect(store.get().engineerOpen).toBe(true);
    input.value = 'Bu virajda ne oluyor?';
    find(overlay, 'sl-engineer-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(input.blur).toHaveBeenCalledOnce();
    expect(answer.hidden).toBe(false);
    expect(answer.parent).toBe(panel);
    expect(answer.textContent).toContain('Yük dış tekerleklere aktarılıyor.');
    expect(speech.say).toHaveBeenLastCalledWith('Yük dış tekerleklere aktarılıyor.');
    const spoken = speech.say.mock.calls.length;
    media.resize(false);
    media.resize(true);
    expect(speech.say).toHaveBeenCalledTimes(spoken);
    find(overlay, 'sl-engineer-close').dispatchEvent(new Event('click'));
    expect(store.get().engineerOpen).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(answer.hidden).toBe(true);
    expect(toggle.focus).toHaveBeenCalledOnce();
    expect(speech.setFocused).toHaveBeenLastCalledWith(false);
    toggle.dispatchEvent(new Event('click'));
    expect(answer.hidden).toBe(false);
    expect(answer.textContent).toContain('Yük dış tekerleklere aktarılıyor.');
    find(overlay, 'sl-engineer').dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(store.get().engineerOpen).toBe(false);
  });

  it('leaves the desktop answer in its original overlay slot', async () => {
    media.matches = false;
    const { overlay } = mount();
    find(overlay, 'sl-engineer-toggle').dispatchEvent(new Event('click'));
    const input = find(overlay, 'sl-engineer-input');
    input.value = 'Kamber nedir?';
    find(overlay, 'sl-engineer-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(find(overlay, 'sl-engineer-answer').parent).toBe(overlay);
    expect(input.blur).not.toHaveBeenCalled();
  });
});
