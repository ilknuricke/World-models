import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import type { FeatureContext, ResolvedFlags } from '../../src/contracts/app';
import type { VehicleClass } from '../../src/contracts/suspension';
import teachingOverlays from '../../src/features/teaching-overlays';
import { createStore } from '../../src/kernel/store';

const panel = vi.hoisted(() => ({
  root: { hidden: true, remove: vi.fn() },
  plots: [], setCurves: vi.fn(), setVisible: vi.fn(), draw: vi.fn(),
}));
const construction = vi.hoisted(() => ({ reset: vi.fn(), draw: vi.fn() }));
vi.mock('../../src/features/teaching-overlays/trace', () => ({ createTracePanel: () => panel }));
vi.mock('../../src/features/teaching-overlays/construction', () => ({ createConstruction: () => construction }));
vi.mock('../../src/features/teaching-overlays/lines', () => ({
  createLineBatch: () => ({ objects: [new Group()], setResolution: vi.fn(), dispose: vi.fn() }),
}));

const flags: ResolvedFlags = { features: {}, paused: true, screen: false, debug: false, e2e: true };
const disposers: (() => void)[] = [];

function harness(vehicleClass: VehicleClass) {
  const store = createStore(flags, false);
  let group!: Group;
  const travel = { droop: 0.08, bump: 0.08 };
  const context = {
    store,
    dom: { overlay: { append: vi.fn() } },
    sim: { current: {
      vehicle: { class: vehicleClass },
      suspension: { vehicleClass, axles: { front: { travel }, rear: { travel } } },
      kinematics: () => ({}),
    } },
    services: { get: () => ({ add: (value: Group) => { group = value; return vi.fn(); } }) },
    registries: { suspensions: { get: () => undefined } },
    on: vi.fn(),
    addDisposer: (dispose: () => void) => disposers.push(dispose),
    watch: (handler: Parameters<typeof store.subscribe>[0]) => disposers.push(store.subscribe(handler)),
  } as unknown as FeatureContext;
  teachingOverlays.init!(context);
  return { store, group };
}

beforeEach(() => {
  panel.root.hidden = true;
  panel.setVisible.mockImplementation((on: boolean) => { panel.root.hidden = !on; });
});
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  vi.clearAllMocks();
});

describe('close-up measurement panel lifecycle', () => {
  it.each(['car', 'motorcycle'] as const)('hides the %s panel immediately in follow and explore, even while paused', (vehicleClass) => {
    const { store, group } = harness(vehicleClass);
    expect(store.get().paused).toBe(true);
    expect(panel.root.hidden).toBe(true);
    expect(panel.setCurves.mock.calls[0]![1]).toBe(vehicleClass === 'car' ? 'camber' : 'motionRatio');

    store.setKey('overlay', 'engineer');
    for (const next of ['follow', 'explore'] as const) {
      store.setKey('view', 'closeup');
      expect(panel.root.hidden).toBe(false);
      store.setKey('view', next);
      expect(panel.root.hidden).toBe(true);
      expect(store.get().overlay).toBe('engineer');
      expect(group.visible).toBe(true); // Camera changes do not erase the chosen 3D construction layer.
    }
    store.setKey('view', 'closeup');
    expect(panel.root.hidden).toBe(false);
    expect(panel.draw).not.toHaveBeenCalled(); // Visibility does not wait for a simulation/render tick.
  });

  it.each(['car', 'motorcycle'] as const)('keeps HUD, attract and explicit overlay choices working for %s', (vehicleClass) => {
    const { store, group } = harness(vehicleClass);
    store.setKey('overlay', 'engineer');
    store.setKey('view', 'closeup');
    for (const [key, hidden] of [['hudVisible', false], ['attract', true]] as const) {
      store.setKey(key, hidden);
      expect(panel.root.hidden).toBe(true);
      store.setKey(key, !hidden);
      expect(panel.root.hidden).toBe(false);
    }
    store.setKey('overlay', 'clean');
    expect(panel.root.hidden).toBe(true);
    expect(group.visible).toBe(false);
    store.setKey('amplification', 2.5);
    expect(store.get().overlay).toBe('clean');
    expect(panel.root.hidden).toBe(true);
    store.setKey('view', 'explore');
    store.setKey('view', 'closeup');
    expect(store.get().overlay).toBe('clean');
    expect(panel.root.hidden).toBe(true);
    expect(group.visible).toBe(false);
  });

  it('does not show a close-up graph when the 3D engineer layer is explicitly enabled in another view', () => {
    const { store, group } = harness('motorcycle');
    store.setKey('overlay', 'engineer');
    expect(group.visible).toBe(true);
    expect(panel.root.hidden).toBe(true);
    store.setKey('view', 'explore');
    expect(panel.root.hidden).toBe(true);
  });

  it.each(['car', 'motorcycle'] as const)('keeps the %s overlay choice independent of every camera and vehicle change', (vehicleClass) => {
    const { store, group } = harness(vehicleClass);
    for (const overlay of ['clean', 'engineer', 'clean'] as const) {
      store.setKey('overlay', overlay);
      for (const view of ['closeup', 'follow', 'explore', 'closeup'] as const) {
        store.setKey('view', view);
        expect(store.get().overlay).toBe(overlay);
        expect(group.visible).toBe(overlay === 'engineer');
        expect(panel.root.hidden).toBe(overlay !== 'engineer' || view !== 'closeup');
      }
      store.setKey('vehicleId', 'another-test-vehicle');
      expect(store.get().overlay).toBe(overlay);
      expect(group.visible).toBe(overlay === 'engineer');
    }
  });
});
