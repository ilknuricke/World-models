/** Exercise feature lifecycle and delayed network replies across real car/motorcycle frame layouts. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext, FeatureModule, FrameInfo, ResolvedFlags } from '../../src/contracts/app';
import type { AppEvents } from '../../src/contracts/events';
import type { EngineerRequest, EngineerResponse } from '../../src/contracts/engineer';
import type { Simulation } from '../../src/contracts/sim';
import type { VehicleClass } from '../../src/contracts/suspension';
import { G } from '../../src/contracts/units';
import engineer from '../../src/features/engineer';
import insights from '../../src/features/insights';
import coach from '../../src/features/coach';
import { createBus } from '../../src/kernel/bus';
import { createStore } from '../../src/kernel/store';
import { cafeRacer } from '../../src/sim-core/content/cafe-racer';
import { motoClassic } from '../../src/sim-core/content/moto-classic';
import { createSimulation } from '../../src/sim-core';
import { deg, fmt } from '../../src/ui/format';
import { engineerRequestSchema } from '../../worker/schemas/engineer';

const narration = vi.hoisted(() => ({ say: vi.fn(), clear: vi.fn(), setFocused: vi.fn(), dispose: vi.fn() }));
vi.mock('../../src/ui/narration', () => ({ acquireNarration: () => narration }));

/** Only the DOM operations used by these features; no layout or browser behaviour is simulated. */
class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  hidden = false;
  value = '';
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
  focus() {}
}

function find(root: ElementStub, className: string): ElementStub {
  if (root.classList.contains(className)) return root;
  for (const child of root.children) {
    try { return find(child, className); } catch { /* keep looking */ }
  }
  throw new Error(`Missing test element ${className}`);
}

const flags: ResolvedFlags = { features: {}, paused: false, screen: false, debug: false, e2e: true };
function simulation(vehicleClass: VehicleClass): Simulation {
  return createSimulation({
    catalog: {
      track: () => undefined,
      vehicle: (id) => id === cafeRacer.id ? cafeRacer : undefined,
      suspension: (id) => id === motoClassic.id ? motoClassic : undefined,
    },
    trackId: 'proving-loop',
    vehicleId: vehicleClass === 'car' ? 'gt-coupe' : cafeRacer.id,
    suspensionId: vehicleClass === 'car' ? 'macpherson' : motoClassic.id,
  });
}

const disposers: (() => void)[] = [];
function harness(feature: FeatureModule, start: VehicleClass = 'car') {
  const overlay = new ElementStub('DIV');
  const bus = createBus();
  const store = createStore(flags, false);
  store.setKey('engineerOpen', true);
  const current = simulation(start);
  const host = { current, frame: structuredClone(current.sample(1)) };
  const c = {
    store, bus, sim: host, dom: { overlay },
    registries: { suspensions: { get: () => undefined } },
    addDisposer: (dispose: () => void) => disposers.push(dispose),
    on: <K extends keyof AppEvents>(type: K, handler: (event: AppEvents[K]) => void) => {
      bus.on(type, handler); disposers.push(() => bus.off(type, handler));
    },
    watch: (handler: Parameters<typeof store.subscribe>[0]) => disposers.push(store.subscribe(handler)),
  } as unknown as FeatureContext;
  feature.init!(c);
  const update = (time: number) => {
    host.frame.simTime = time;
    feature.update!({ dt: 0.1, time, alpha: 1, t: host.frame } satisfies FrameInfo);
  };
  const swap = (vehicleClass: VehicleClass) => {
    host.current = simulation(vehicleClass);
    host.frame = structuredClone(host.current.sample(1));
    store.setKey('driveMode', 'auto');
    bus.emit('sim:vehicle', { vehicleId: host.current.vehicle.id, suspensionId: host.current.suspension.id });
  };
  return { overlay, bus, store, host, update, swap };
}

async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const reply = (text: string): EngineerResponse => ({ text, actions: [], source: 'model' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, createElement: (tag: string) => new ElementStub(tag.toUpperCase()) }));
  vi.stubGlobal('localStorage', { getItem: () => 'synthetic-client-id', setItem: () => {} });
});
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('vehicle-specific engineer conversation', () => {
  it.each(['car', 'motorcycle'] as const)('discards a delayed %s answer and sends a fresh target-vehicle history and frame', async (from) => {
    const h = harness(engineer, from);
    const target = from === 'car' ? 'motorcycle' : 'car';
    const delayed = deferred<EngineerResponse>();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(reply('Önceki aracın yanıtı.')))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => delayed.promise } as Response)
      .mockResolvedValueOnce(Response.json(reply('Seçili aracın yanıtı.')));
    vi.stubGlobal('fetch', fetcher);
    const ask = async (question: string) => {
      find(h.overlay, 'sl-engineer-input').value = question;
      find(h.overlay, 'sl-engineer-form').dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
    };
    h.update(1);
    await ask('Kamber nedir?');
    await ask('Bu araç neden yatıyor?');
    const previousRequest = JSON.parse(String(fetcher.mock.calls[1]![1]!.body)) as EngineerRequest;
    expect(previousRequest.history).toHaveLength(2);
    const oldSignal = fetcher.mock.calls[1]![1]!.signal!;
    h.swap(target);
    expect(oldSignal.aborted).toBe(true);
    const spokenAtSwap = narration.say.mock.calls.length;
    delayed.resolve({ text: 'Gecikmiş eski araç yanıtı.', source: 'model', actions: [
      { tool: 'set_slow_motion', args: { scale: 0.25 } },
      { tool: 'set_view', args: { view: 'closeup' } },
    ] });
    await settle();
    expect(find(h.overlay, 'sl-engineer-answer').hidden).toBe(true);
    expect(narration.say).toHaveBeenCalledTimes(spokenAtSwap);
    expect(h.store.get()).toMatchObject({ timeScale: 1, view: 'follow' });
    h.update(2);
    await ask('Şu anki süspansiyon ne yapıyor?');
    const request = JSON.parse(String(fetcher.mock.calls[2]![1]!.body)) as EngineerRequest;
    expect(request.history).toEqual([]);
    expect(request.telemetry).toMatchObject({ vehicle_class: target, vehicle: h.host.current.vehicle.id, suspension: h.host.current.suspension.id });
    expect(Object.keys(request.telemetry.corners)).toEqual(target === 'car' ? ['fl', 'fr', 'rl', 'rr'] : ['f', 'r']);
    expect(request.telemetry.drive).toBeUndefined();
    if (target === 'motorcycle') {
      expect(request.telemetry.derived).not.toHaveProperty('roll_centre_front_mm');
      expect(request.telemetry.derived).not.toHaveProperty('roll_centre_rear_mm');
      expect(find(h.overlay, 'sl-engineer-chips').textContent).toMatch(/motosiklet/i);
    } else expect(find(h.overlay, 'sl-engineer-chips').textContent).not.toMatch(/motosiklet/i);
    expect(engineerRequestSchema.safeParse(request).success).toBe(true);
    expect(find(h.overlay, 'sl-engineer-text').textContent).toBe('Seçili aracın yanıtı.');
    expect(narration.say).toHaveBeenLastCalledWith('Seçili aracın yanıtı.');
  });
});

describe('vehicle-specific automatic corner notes', () => {
  it.each(['car', 'motorcycle'] as const)('clears a visible %s note immediately when the frame layout changes', (from) => {
    const h = harness(insights, from);
    h.bus.emit('sim:event', { kind: 'liftoff', corner: from === 'car' ? 3 : 1 });
    const caption = find(h.overlay, 'sl-insights-caption');
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toContain(from === 'car' ? 'sağ arka' : 'arka');
    narration.clear.mockClear();
    h.swap(from === 'car' ? 'motorcycle' : 'car');
    expect(caption.hidden).toBe(true);
    expect(narration.clear).toHaveBeenCalled();
    expect(() => h.update(1)).not.toThrow();
  });

  it.each(['car', 'motorcycle'] as const)('starts fresh target-vehicle corner notes after a paused %s swap and clock reset', (from) => {
    const h = harness(insights, from);
    const target = from === 'car' ? 'motorcycle' : 'car';
    const cornering = () => {
      h.host.frame.sectionIndex = h.host.current.track.sections.find((section) => section.def.phenomenon === 'steady-state-roll')!.index;
      h.host.frame.ay = -0.8 * G;
      h.host.frame.roll = h.host.current.vehicle.class === 'car' ? 0.035 : -0.6;
    };
    cornering();
    h.update(20);
    h.update(20.7);
    const caption = find(h.overlay, 'sl-insights-caption');
    expect(caption.hidden).toBe(false);
    h.store.setKey('paused', true);
    h.swap(target);
    expect(caption.hidden).toBe(true);
    expect(h.store.get().paused).toBe(true);
    cornering();
    h.store.setKey('paused', false);
    h.update(0.1);
    h.update(0.8);
    expect(caption.hidden).toBe(false);
    expect(find(h.overlay, 'sl-insights-text').textContent).toMatch(target === 'motorcycle' ? /Motosiklet.*virajın içine/ : /Gövde virajın dışına/);
    expect(find(h.overlay, 'sl-insights-chip').textContent).toContain(`Yatma ${fmt(Math.abs(deg(h.host.frame.roll)), 1)}°`);
    expect(narration.say).toHaveBeenLastCalledWith(find(h.overlay, 'sl-insights-text').textContent);
  });
});

it('clears the manual car coach note before the motorcycle is shown', () => {
  const h = harness(coach);
  h.store.setKey('driveMode', 'manual');
  h.host.frame.drive.mode = 'manual';
  h.bus.emit('drive:event', { kind: 'lockup', corner: 3, simTime: 0 });
  h.update(1);
  const caption = find(h.overlay, 'sl-coach-caption');
  expect(caption.hidden).toBe(false);
  h.swap('motorcycle');
  expect(caption.hidden).toBe(true);
  expect(narration.clear).toHaveBeenCalled();
});
