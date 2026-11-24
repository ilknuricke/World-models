import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureModule } from '../../src/contracts/app';
import { RENDER, type RenderService } from '../../src/contracts/services';
import type { CarDefinition } from '../../src/contracts/vehicle';
import { EMPTY_MANIFEST } from '../../src/kernel/assets';
import { createApp, type CreateAppOptions } from '../../src/kernel/app';
import { listenerCount } from '../../src/kernel/bus';
import { createSimulation } from '../../src/sim-core/index';
import { fakeDom, fakeSim, type FakeSim } from './helpers';

const boot = (features: FeatureModule[], extra: Partial<CreateAppOptions> = {}) =>
  createApp({ features, search: '?clock=local', dom: fakeDom(), raf: () => 0, loadManifest: async () => EMPTY_MANIFEST, ...extra });

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.__app = undefined;
});

/** Car definition stub for registry tests (only the fields the kernel reads matter). */
const car = (id: string, suspensions: string[]): CarDefinition =>
  ({ ...(createSimulation({ catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined }, trackId: 't', vehicleId: id, suspensionId: suspensions[0]! }).vehicle as CarDefinition), id, suspensions, defaultSuspension: suspensions[0]! });

describe('createApp boot (§6.2)', () => {
  it('contributes, creates the sim, inits in order, runs phases in order, then app:ready once', async () => {
    const log: string[] = [];
    const phases = (id: string, phase: FeatureModule['phase']): FeatureModule => ({
      id,
      ...(phase ? { phase } : {}),
      contribute: () => void log.push(`contribute ${id}`),
      init: (ctx) => {
        log.push(`init ${id}`);
        expect(ctx.sim.current.lapDuration).toBeGreaterThan(0);
      },
      update: () => void log.push(`update ${id}`),
    });
    const app = boot([phases('overlay-ui', 'overlay'), phases('renderer', 'render'), phases('cam', 'camera'), phases('world', undefined)]);
    expect(() => app.ctx).toThrow('App not started');
    const ready = vi.fn();
    await app.start();
    app.ctx.bus.on('app:ready', ready);
    expect(app.ctx.store.get().loading).toBe(0);
    app.tick(2, 1 / 60);
    expect(log).toEqual([
      'contribute cam', 'contribute overlay-ui', 'contribute renderer', 'contribute world',
      'init cam', 'init overlay-ui', 'init renderer', 'init world',
      'update world', 'update cam', 'update renderer', 'update overlay-ui',
      'update world', 'update cam', 'update renderer', 'update overlay-ui',
    ]);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(app.ctx.store.get().loading).toBe(1);
    expect(app.ctx.sim.frame.speed).toBeGreaterThan(0); // the sim drives
    app.stop();
  });

  it('a renderer init failure is fatal with the WebGL message; other failures are isolated', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fatal = boot([{ id: 'renderer', init: () => Promise.reject(new Error('no webgl2')) }]);
    await expect(fatal.start()).rejects.toThrow('Bu uygulama için WebGL 2 gereklidir');
    const ok = boot([{ id: 'insights', init: () => { throw new Error('bug'); } }, { id: 'controls' }]);
    await expect(ok.start()).resolves.toBeUndefined();
    ok.stop();
  });

  it('manifest failure is fatal, except in e2e mode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadManifest = () => Promise.reject(new Error('404'));
    await expect(boot([], { loadManifest }).start()).rejects.toThrow('404');
    const e2e = boot([], { loadManifest, search: '?e2e=1' });
    await e2e.start();
    expect(e2e.ctx.assets.manifest.assets).toEqual({});
    expect(e2e.ctx.store.get().quality).toBe('low');
    e2e.stop();
  });

  it('validates store ids against registries (step 6) and passes ?t to the simulation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let options: Parameters<NonNullable<CreateAppOptions['createSimulation']>>[0] | undefined;
    const content: FeatureModule = { id: 'car', contribute: (r) => void r.vehicles.register(car('coupe', ['wishbone', 'strut'])) };
    const app = boot([content], {
      search: '?vehicle=nope&suspension=strut&t=12',
      createSimulation: (o) => ((options = o), createSimulation(o)),
    });
    await app.start();
    expect(options).toMatchObject({ vehicleId: 'coupe', suspensionId: 'strut', lapTime: 12 });
    expect(options!.catalog.vehicle('coupe')?.id).toBe('coupe');
    expect(app.ctx.store.get().clock).toBe('local');
    app.stop();
    const app2 = boot([content], { search: '?vehicle=coupe&suspension=multilink' });
    await app2.start();
    expect(app2.ctx.store.get().suspensionId).toBe('wishbone');
    app2.stop();
  });
});

describe('sim host (§6.4)', () => {
  async function hostRig() {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let sim!: FakeSim;
    const content: FeatureModule = {
      id: 'car',
      contribute(r) {
        r.vehicles.register(car('coupe', ['wishbone', 'strut']));
        r.vehicles.register(car('roadster', ['multilink']));
      },
    };
    const app = boot([content], { search: '?vehicle=coupe&suspension=wishbone&clock=local', createSimulation: (o) => (sim = fakeSim(o)) });
    await app.start();
    const events: string[] = [];
    app.ctx.bus.on('sim:vehicle', (e) => events.push(`vehicle ${e.vehicleId}/${e.suspensionId}`));
    app.ctx.bus.on('sim:suspension', (e) => events.push(`suspension ${e.previous}->${e.suspensionId}`));
    app.ctx.bus.on('sim:seek', (e) => events.push(`seek ${e.lapTime}`));
    return { app, sim, events, store: app.ctx.store };
  }

  it('applies suspension changes and rejects ones the vehicle does not offer', async () => {
    const { app, sim, events, store } = await hostRig();
    store.setKey('suspensionId', 'strut');
    store.setKey('suspensionId', 'multilink');
    expect(sim.calls).toEqual(['setSuspension:strut']);
    expect(store.get().suspensionId).toBe('strut');
    expect(events).toEqual(['suspension wishbone->strut']);
    app.stop();
  });

  it('vehicle change rebuilds, writes back the actual suspension and emits sim:vehicle', async () => {
    const { app, sim, events, store } = await hostRig();
    store.setKey('vehicleId', 'roadster');
    expect(sim.calls).toEqual(['setVehicle:roadster:-']);
    expect(store.get().suspensionId).toBe('default-of-roadster');
    expect(events).toEqual(['vehicle roadster/default-of-roadster']);
    app.stop();
  });

  it('pause and slow motion leave the live clock; sim:seek-to seeks, resets acc and goes local', async () => {
    const { app, sim, events, store } = await hostRig();
    store.setKey('clock', 'live');
    expect(sim.seeks).toHaveLength(1); // switching to live seeks to the shared target
    store.setKey('paused', true);
    expect(store.get().clock).toBe('local');
    store.setKey('clock', 'live');
    store.setKey('paused', false);
    store.setKey('timeScale', 0.5);
    expect(store.get().clock).toBe('local');
    app.tick(1, 0.01);
    app.ctx.bus.emit('sim:seek-to', { lapTime: 33 });
    expect(sim.seeks.at(-1)).toBe(33);
    expect(events.at(-1)).toBe('seek 33');
    expect(store.get().clock).toBe('local');
    app.stop();
  });
});

describe('disposal (§6.7) and test hooks (§6.6)', () => {
  it('stop() returns bus listeners and scene children to baseline; leaks are reported', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const children: object[] = [];
    const renderer: FeatureModule = {
      id: 'renderer',
      init(ctx) {
        children.push({ light: true });
        const render = { scene: { children }, add: (o: object) => (children.push(o), () => void children.splice(children.indexOf(o), 1)) };
        ctx.services.provide(RENDER, render as unknown as RenderService);
        ctx.addDisposer(() => void children.splice(0));
      },
    };
    const tidy: FeatureModule = {
      id: 'tidy',
      requires: ['renderer'],
      init(ctx) {
        ctx.on('user:activity', () => {});
        ctx.watch(() => {});
        ctx.addDisposer(ctx.services.get(RENDER).add({} as never));
      },
    };
    const app = boot([renderer, tidy]);
    await app.start();
    expect(children).toHaveLength(2);
    app.stop();
    expect(listenerCount(app.ctx.bus)).toBe(0);
    expect(errors).not.toHaveBeenCalled();

    const leaky: FeatureModule = {
      id: 'leaky',
      requires: ['renderer'],
      init(ctx) {
        ctx.bus.on('user:activity', () => {});
        ctx.services.get(RENDER).add({} as never);
      },
    };
    const app2 = boot([renderer, leaky]);
    await app2.start();
    app2.stop();
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([
      '[kernel] Disposal leak: scene has 2 children, expected 1',
      '[kernel] Disposal leak: 1 bus listener(s) left',
    ]);
  });

  it('?e2e=1 installs window.__app with ready, errors, state, frame, seek and advance', async () => {
    const app = boot([{ id: 'bad', init: () => { throw new Error('nope'); } }], { search: '?e2e=1&paused=1&t=5' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realError = console.error;
    console.error = () => {}; // keep test output clean; hooks wrap whatever console.error is
    try {
      await app.start();
      const hooks = globalThis.__app!;
      expect(hooks.ready).toBe(false);
      app.tick(1, 1 / 60);
      expect(hooks.ready).toBe(true);
      expect(hooks.errors).toEqual(['[kernel] Feature "bad" init failed: nope']);
      expect(hooks.features()).toEqual([{ id: 'bad', enabled: false, error: 'Feature "bad" init failed: nope' }]);
      expect(hooks.state()).toMatchObject({ paused: true, clock: 'local', quality: 'low' });
      expect(hooks.frame().lapTime).toBeCloseTo(5, 9);
      hooks.advance(1);
      // paused: acc = 0 so alpha = 0, i.e. the render shows the previous fixed step (standard interpolation lag)
      expect(hooks.frame().lapTime).toBeCloseTo(6 - 1 / 240, 9);
      expect(hooks.frame().corners.map((c) => c.id)).toEqual(['fl', 'fr', 'rl', 'rr']);
      hooks.seek(20);
      expect(hooks.frame().lapTime).toBeCloseTo(6 - 1 / 240, 9); // frame is re-sampled on the next render
      app.tick(1, 1 / 60);
      expect(hooks.frame().lapTime).toBeCloseTo(20, 9);
      hooks.set('xray', true);
      expect(app.ctx.store.get().xray).toBe(true);
      expect(hooks.kinematics().front.motionRatio).toBeGreaterThan(0);
      expect(hooks.stats()).toBeNull();
      app.stop();
      expect(globalThis.__app).toBeUndefined();
    } finally {
      console.error = realError;
    }
  });
});
