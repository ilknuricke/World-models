import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext, ResolvedFlags } from '../../src/contracts/app';
import { createStore } from '../../src/kernel/store';
import { mountTelemetryDisclosure } from '../../src/features/telemetry-panel/index';

class ElementStub extends EventTarget {
  hidden = false;
  title = '';
  focused = false;
  textContent = '';
  readonly attributes = new Map<string, string>();
  readonly children: ElementStub[] = [];
  private readonly classes = new Set<string>();
  parent: ElementStub | null = null;
  readonly classList = {
    toggle: (name: string, force: boolean) => {
      if (force) this.classes.add(name); else this.classes.delete(name);
      return force;
    },
    contains: (name: string) => this.classes.has(name),
  };
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'hidden') this.hidden = true;
  }
  append(...children: (ElementStub | string)[]) {
    for (const child of children) {
      if (typeof child === 'string') { this.textContent += child; continue; }
      child.parent = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  focus() { this.focused = true; }
}

class MediaStub extends EventTarget {
  constructor(public matches: boolean) { super(); }
  change(matches: boolean) {
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }
}

const flags: ResolvedFlags = { features: {}, paused: false, screen: false, debug: false, e2e: true };
const disposers: (() => void)[] = [];
let doc: EventTarget;

function harness(mobile: boolean | null = true) {
  const media = new MediaStub(mobile ?? false);
  vi.stubGlobal('matchMedia', mobile === null ? undefined : vi.fn(() => media));
  const overlay = new ElementStub();
  const root = new ElementStub();
  const header = new ElementStub();
  const store = createStore(flags, false);
  const c = {
    dom: { overlay }, store,
    addDisposer: (dispose: () => void) => disposers.push(dispose),
    watch: (handler: Parameters<typeof store.subscribe>[0]) => disposers.push(store.subscribe(handler)),
  } as unknown as FeatureContext;
  const refresh = vi.fn();
  mountTelemetryDisclosure(c, root as unknown as HTMLElement, header as unknown as HTMLElement, refresh);
  const toggle = overlay.children[0]!;
  const close = header.children[0]!;
  const click = (element: ElementStub) => element.dispatchEvent(new Event('click'));
  return { root, media, store, toggle, close, click, refresh };
}

beforeEach(() => {
  doc = Object.assign(new EventTarget(), { createElement: () => new ElementStub() });
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  vi.unstubAllGlobals();
});

describe('mobile telemetry disclosure', () => {
  it('starts collapsed and lets the visitor open and close the sheet', () => {
    const h = harness();
    expect(h.root.hidden).toBe(true);
    expect(h.toggle.hidden).toBe(false);
    expect(h.toggle.attributes.get('aria-controls')).toBe('sl-telemetry-panel');
    expect(h.toggle.attributes.get('aria-expanded')).toBe('false');
    h.click(h.toggle);
    expect(h.root.hidden).toBe(false);
    expect(h.root.classList.contains('is-mobile-expanded')).toBe(true);
    expect(h.toggle.attributes.get('aria-expanded')).toBe('true');
    expect(h.refresh).toHaveBeenCalledOnce(); // No simulation tick is needed to populate a paused sheet.
    h.click(h.close);
    expect(h.root.hidden).toBe(true);
    expect(h.toggle.attributes.get('aria-expanded')).toBe('false');
    expect(h.toggle.focused).toBe(true);
  });

  it('shows one phone panel at a time through the existing engineer state', () => {
    const h = harness();
    h.click(h.toggle);
    h.store.setKey('engineerOpen', true);
    expect(h.root.hidden).toBe(true);
    expect(h.toggle.attributes.get('aria-expanded')).toBe('false');
    h.click(h.toggle);
    expect(h.store.get().engineerOpen).toBe(false);
    expect(h.root.hidden).toBe(false);
  });

  it('closes with Escape and does not reopen after hiding the HUD or entering attract mode', () => {
    const h = harness();
    h.click(h.toggle);
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    doc.dispatchEvent(escape);
    expect(h.root.hidden).toBe(true);
    expect(escape.defaultPrevented).toBe(true);
    h.click(h.toggle);
    h.store.setKey('hudVisible', false);
    expect(h.toggle.hidden).toBe(true);
    h.store.setKey('hudVisible', true);
    expect(h.toggle.hidden).toBe(false);
    expect(h.root.hidden).toBe(true);
    h.click(h.toggle);
    h.store.setKey('attract', true);
    h.store.setKey('attract', false);
    expect(h.root.hidden).toBe(true);
  });

  it('preserves the desktop card and enters a phone layout collapsed', () => {
    const h = harness(false);
    expect(h.root.hidden).toBe(false);
    expect(h.toggle.hidden).toBe(true);
    h.store.setKey('engineerOpen', true);
    expect(h.root.hidden).toBe(true);
    h.store.setKey('engineerOpen', false);
    expect(h.root.hidden).toBe(false);
    h.media.change(true);
    expect(h.root.hidden).toBe(true);
    expect(h.toggle.hidden).toBe(false);
    h.click(h.toggle);
    h.media.change(false);
    expect(h.root.hidden).toBe(false);
    expect(h.toggle.hidden).toBe(true);
    h.media.change(true);
    expect(h.root.hidden).toBe(true);
  });

  it('releases an expanded phone sheet on manual takeover without hiding desktop telemetry', () => {
    const phone = harness();
    phone.click(phone.toggle);
    expect(phone.root.classList.contains('is-mobile-expanded')).toBe(true);
    phone.store.setKey('driveMode', 'manual');
    expect(phone.root.hidden).toBe(true);
    expect(phone.root.classList.contains('is-mobile-expanded')).toBe(false);
    expect(phone.toggle.attributes.get('aria-expanded')).toBe('false');
    phone.store.setKey('driveMode', 'auto');
    expect(phone.root.hidden).toBe(true); // Returning to Auto must not pop the old sheet back up.

    const desktop = harness(false);
    desktop.store.setKey('driveMode', 'manual');
    expect(desktop.root.hidden).toBe(false);
  });

  it('works without matchMedia and removes responsive listeners when disposed', () => {
    const absent = harness(null);
    expect(absent.root.hidden).toBe(false);
    const h = harness();
    for (const dispose of disposers.splice(0).reverse()) dispose();
    h.media.change(false);
    expect(h.toggle.hidden).toBe(false); // The disposed disclosure no longer reacts.
  });
});
