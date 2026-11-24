import type { AppContext, AssetManifest, FeatureModule } from '../contracts/app';
import { RENDER } from '../contracts/services';
import type { CreateSimulation, SimCatalog } from '../contracts/sim';
import type { AppStore } from '../contracts/store';
import { createSimulation as defaultCreateSimulation, runDriveScript } from '../sim-core/index';
import { createAssets, EMPTY_MANIFEST, fetchManifest } from './assets';
import { createBus, listenerCount } from './bus';
import { createClock } from './clock';
import { createFeatureManager } from './features';
import { parseFlags } from './flags';
import { createLoop, type Loop } from './loop';
import { createRegistries } from './registry';
import { createServices } from './services';
import { createSimHost, type KernelSimHost } from './sim-host';
import { createStore } from './store';
import { installTestHooks } from './test-hooks';

export interface CreateAppOptions {
  readonly features: readonly FeatureModule[];
  /** Default location.search. */
  readonly search?: string;
  /** Default #stage / #overlay from index.html. */
  readonly dom?: AppContext['dom'];
  /** Default: sim-core createSimulation (tests inject fakes). */
  readonly createSimulation?: CreateSimulation;
  /** Default: fetch('/asset-manifest.json'). */
  readonly loadManifest?: () => Promise<AssetManifest>;
  /** Tests drive frames manually. */
  readonly raf?: (cb: (nowMs: number) => void) => number;
}

export interface App {
  /** Available once start() has created the simulation (throws before). */
  readonly ctx: AppContext;
  /** Boot sequence §6.2, then the loop. Rejects with a user-facing message on a fatal failure. */
  start(): Promise<void>;
  /** Disposes all features in reverse order and stops the loop. */
  stop(): void;
  /** Test-only: run n render frames of dt seconds synchronously. */
  tick(n: number, dt: number): void;
}

/** Features whose init failure ends the app, with the message shown to the user. */
const FATAL: Readonly<Record<string, string>> = { renderer: 'Bu uygulama için WebGL 2 gereklidir' };

export function createApp(options: CreateAppOptions): App {
  const warn = (msg: string) => console.warn(`[kernel] ${msg}`);
  const flags = parseFlags(options.search ?? location.search, warn);
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = createStore(flags, reducedMotion);
  const bus = createBus();
  const registries = createRegistries();
  const services = createServices();
  const clock = createClock();
  const features = createFeatureManager(options.features, flags.features, flags.debug, warn, (msg) => console.error(`[kernel] ${msg}`));

  let ctx: AppContext | undefined;
  let host: KernelSimHost | undefined;
  let loop: Loop | undefined;
  let uninstallHooks: (() => void) | undefined;
  let busBaseline = 0;
  let sceneBaseline: number | undefined;
  const getCtx = () => {
    if (!ctx) throw new Error('App not started');
    return ctx;
  };

  function stop(): void {
    loop?.stop();
    features.disposeAll((rec) => {
      const scene = rec.provides.includes(RENDER.id) ? services.tryGet(RENDER)?.scene : undefined;
      if (scene && sceneBaseline !== undefined && scene.children.length !== sceneBaseline)
        console.error(`[kernel] Disposal leak: scene has ${scene.children.length} children, expected ${sceneBaseline}`);
    });
    if (host && listenerCount(bus) !== busBaseline) console.error(`[kernel] Disposal leak: ${listenerCount(bus) - busBaseline} bus listener(s) left`);
    host?.dispose();
    uninstallHooks?.();
  }

  async function start(): Promise<void> {
    const dom = options.dom ?? domFromDocument();
    let manifest: AssetManifest;
    try {
      manifest = await (options.loadManifest ?? fetchManifest)();
    } catch (e) {
      if (!flags.e2e) throw e;
      warn(`Asset manifest unavailable (${e instanceof Error ? e.message : String(e)}); continuing with none`);
      manifest = EMPTY_MANIFEST;
    }

    features.contribute(registries);
    validateIds(store, registries, flags.suspension !== undefined, warn);
    const st = store.get();
    const createSim = options.createSimulation ?? defaultCreateSimulation;
    const catalog: SimCatalog = {
      track: (id) => registries.tracks.get(id),
      vehicle: (id) => registries.vehicles.get(id),
      suspension: (id) => registries.suspensions.get(id),
      world: (trackId) => registries.worlds.list().find((w) => w.trackId === trackId),
    };
    const sim = createSim({
      catalog,
      trackId: st.trackId,
      vehicleId: st.vehicleId,
      suspensionId: st.suspensionId,
      ...(flags.lapTime === undefined ? {} : { lapTime: flags.lapTime }),
    });
    sim.drive?.setAids(store.get().driveAids);
    host = createSimHost({ sim, store, bus, clock, registries, warn });
    const kernelHost = host;
    const app: AppContext = { store, bus, registries, services, flags, clock, assets: createAssets(manifest), sim: host, dom };
    ctx = app;
    const raf = options.raf ?? ((cb: (nowMs: number) => void) => requestAnimationFrame(cb));
    loop = createLoop({
      store,
      bus,
      host,
      features,
      raf,
      onFirstFrame() {
        store.setKey('loading', 1);
        bus.emit('app:ready');
        if (globalThis.__app) globalThis.__app.ready = true;
        if (flags.drive === 'manual') {
          bus.emit('drive:request', { mode: 'manual' });
          if (flags.spawn) bus.emit('drive:reset', { spawn: flags.spawn });
        }
      },
    });
    const kernelLoop = loop;
    const driveHash = (seed: number, seconds: number) => {
      const fresh = createSim({ catalog, trackId: sim.track.def.id, vehicleId: sim.vehicle.id, suspensionId: sim.suspension.id });
      return runDriveScript(fresh, seed, seconds);
    };
    if (flags.e2e || flags.debug)
      uninstallHooks = installTestHooks(getCtx, features, { host: () => kernelHost, advance: (s) => kernelLoop.advance(s), driveHash });
    busBaseline = listenerCount(bus);

    await features.init(app, (rec) => {
      if (sceneBaseline === undefined && rec.provides.includes(RENDER.id)) sceneBaseline = services.get(RENDER).scene.children.length;
    });
    const fatal = features.records.find((r) => r.error !== undefined && FATAL[r.id] !== undefined);
    if (fatal) {
      stop();
      throw new Error(FATAL[fatal.id]);
    }
    loop.start();
  }

  return {
    get ctx() {
      return getCtx();
    },
    start,
    stop,
    tick(n, dt) {
      if (!loop) throw new Error('App not started');
      loop.tick(n, dt);
    },
  };
}

function domFromDocument(): AppContext['dom'] {
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  if (!stage || !overlay) throw new Error('index.html must contain #stage and #overlay');
  return { stage, overlay };
}

/** Boot step 6: unknown ids fall back to the first registered item; empty registries pass ids through. */
function validateIds(store: AppStore, registries: AppContext['registries'], explicitSuspension: boolean, warn: (msg: string) => void): void {
  const st = store.get();
  const firstTrack = registries.tracks.list()[0];
  if (firstTrack && !registries.tracks.get(st.trackId)) {
    warn(`Unknown track "${st.trackId}", using "${firstTrack.id}"`);
    store.setKey('trackId', firstTrack.id);
  }
  const firstVehicle = registries.vehicles.list()[0];
  if (firstVehicle && !registries.vehicles.get(st.vehicleId)) {
    warn(`Unknown vehicle "${st.vehicleId}", using "${firstVehicle.id}"`);
    store.setKey('vehicleId', firstVehicle.id);
  }
  const vehicle = registries.vehicles.get(store.get().vehicleId);
  if (vehicle && !vehicle.suspensions.includes(st.suspensionId)) {
    if (explicitSuspension) warn(`Suspension "${st.suspensionId}" not offered for "${vehicle.id}", using "${vehicle.defaultSuspension}"`);
    store.setKey('suspensionId', vehicle.defaultSuspension);
  }
}
