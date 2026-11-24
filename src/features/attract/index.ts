import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { CAMERA } from '../../contracts/services';
import type { AppState } from '../../contracts/store';
import { h, mount } from '../../ui/dom';
import { attractMayRun, CLOCK_KEYS } from './gate';
import { createTimeline, fadeAt, STORYBOARD, type Beat } from './storyboard';
import './attract.css';

/** Seconds without input before attract mode starts (§9.2). */
export const IDLE_S = 30;
/** Fade back to the visitor's view on exit, s. */
const EXIT_FADE_S = 0.45;
/** Store keys attract mode writes; snapshotted on entry and restored on exit. */
const KEYS = ['view', 'focusCorner', 'xray', 'overlay', 'amplification', 'timeScale', 'paused', 'clock', 'vehicleId', 'suspensionId'] as const satisfies readonly (keyof AppState)[];
type Snapshot = Pick<AppState, (typeof KEYS)[number]>;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

let frameHandler: ((frame: FrameInfo) => void) | undefined;

/**
 * Attract mode: after IDLE_S without input (or `store.attract` set by ?attract=1 / the presenter) a 60 s
 * storyboard drives the store, camera shots and captions; any input exits with a fade and restores the visitor's state.
 * Only in Auto (M2): never starts while someone drives, and a takeover ends it.
 * Also the app's source of `user:activity` (DOM input, at most 4 per second).
 */
export default {
  id: 'attract',
  requires: ['camera'],
  phase: 'overlay',
  init(ctx) {
    const camera = ctx.services.get(CAMERA);
    const { store, bus } = ctx;

    let lastEmit = -Infinity;
    const onInput = () => {
      const now = performance.now();
      if (now - lastEmit < 250) return;
      lastEmit = now;
      bus.emit('user:activity');
    };
    for (const type of INPUT_EVENTS) {
      globalThis.addEventListener(type, onInput, { passive: true });
      ctx.addDisposer(() => globalThis.removeEventListener(type, onInput));
    }

    const title = h('div', { class: 'sl-attract-title' }, 'Süspansiyon Laboratuvarı');
    const caption = h('div', { class: 'sl-attract-caption' });
    const note = h('div', { class: 'sl-attract-note' });
    const panel = h('div', { class: 'sl-attract', role: 'status', 'aria-live': 'polite', hidden: true }, title, caption, note);
    const fade = h('div', { class: 'sl-attract-fade', 'aria-hidden': 'true' });
    ctx.addDisposer(mount(ctx.dom.overlay, fade));
    ctx.addDisposer(mount(ctx.dom.overlay, panel));

    let active = false;
    let idle = 0;
    let snapshot: Snapshot | null = null;
    let timeline = createTimeline(STORYBOARD);
    let exitFade = 0;
    let shownFade = -1;

    const set = <K extends keyof AppState>(key: K, value: AppState[K]) => {
      if (store.get()[key] !== value) (store.setKey as (k: K, v: AppState[K]) => void)(key, value);
    };

    // The bike beat swaps the vehicle; a vehicle swap resets the suspension, so the visitor's is re-applied a frame
    // after the vehicle comes back (a write made while the store is notifying would be overtaken by the kernel's).
    let restoreSuspension: string | null = null;
    /** Lap time seen last frame (NaN = re-anchor: a seek or a vehicle swap happened). */
    let lastLap = Number.NaN;
    const startBeat = (beat: Beat) => {
      const ownVehicle = snapshot?.vehicleId ?? store.get().vehicleId;
      const bike = beat.bike ? ctx.registries.vehicles.list().find((v) => v.class === 'motorcycle')?.id : undefined;
      if (store.get().vehicleId !== (bike ?? ownVehicle)) {
        set('vehicleId', bike ?? ownVehicle);
        if (!bike) restoreSuspension = snapshot?.suspensionId ?? null;
      }
      const sim = ctx.sim.current;
      if (beat.at) {
        const section = sim.track.sections.find((s) => s.def.phenomenon === beat.at);
        const d = sim.lapDuration;
        if (section) bus.emit('sim:seek-to', { lapTime: (((sim.lapTimeAt(section.s0) - (beat.lead ?? 0)) % d) + d) % d });
      }
      for (const [key, value] of Object.entries(beat.patch) as [keyof Beat['patch'], never][]) set(key, value);
      lastLap = Number.NaN;
      const own = snapshot?.suspensionId ?? store.get().suspensionId;
      const list = sim.vehicle.suspensions;
      const i = list.indexOf(own);
      if (i >= 0 && list.length > 0) set('suspensionId', list[(i + beat.swap) % list.length]!);
      // Longer than the beat: the next beat replaces the shot, so the camera never drifts back in between.
      camera.playShot({ ...beat.shot, durationS: beat.duration + 1 });
      title.hidden = !beat.title;
      caption.textContent = beat.caption;
      // Restart the caption entrance.
      panel.classList.remove('sl-attract-in');
      void panel.offsetWidth;
      panel.classList.add('sl-attract-in');
    };

    const enter = () => {
      const s = store.get();
      snapshot = Object.fromEntries(KEYS.map((k) => [k, s[k]])) as Snapshot;
      active = true;
      timeline = createTimeline(STORYBOARD);
      set('view', 'follow');
      set('paused', false);
      panel.hidden = false;
      startBeat(STORYBOARD[timeline.step(0)]!);
    };

    const exit = () => {
      active = false;
      idle = 0;
      panel.hidden = true;
      camera.clearShot();
      const prior = snapshot;
      snapshot = null;
      if (!prior) return;
      // A takeover ended it: the kernel owns the clock now (driving runs on the local clock).
      const driving = !attractMayRun(store.get());
      // Rate and pause first: the kernel forces clock 'local' on those, then 'live' resyncs to the shared lap.
      if (!driving) {
        set('timeScale', prior.timeScale);
        set('paused', prior.paused);
      }
      const swapped = store.get().vehicleId !== prior.vehicleId;
      for (const key of KEYS) if (!driving || !CLOCK_KEYS.has(key)) set(key, prior[key]);
      if (swapped) restoreSuspension = prior.suspensionId;
      exitFade = 1;
    };

    ctx.watch((s) => {
      // Refused (and ended) while the visitor drives: a takeover always wins over the storyboard.
      if (s.attract && !attractMayRun(s)) store.setKey('attract', false);
      else if (s.attract && !active) enter();
      else if (!s.attract && active) exit();
    });
    ctx.on('user:activity', () => {
      idle = 0;
      if (active) store.setKey('attract', false);
    });
    ctx.addDisposer(() => {
      if (active) exit();
    });

    // Idle start: never in e2e, never when ?attract=0, and under reduced motion only when ?attract=1 asks for it
    // (its storyboard is camera fly-throughs); the presenter can still start it.
    const idleStarts = !ctx.flags.e2e && ctx.flags.attract !== false && (!store.get().reducedMotion || ctx.flags.attract === true);

    frameHandler = ({ dt, t }) => {
      let opacity = 0;
      if (restoreSuspension !== null) {
        set('suspensionId', restoreSuspension);
        restoreSuspension = null;
      }
      if (active) {
        // Director time = the sim's own progress (dropped backlogs, live corrections and slow frames included) at
        // normal speed, so every seek lands on its bump exactly `lead` seconds into the beat on any machine.
        const d = ctx.sim.current.lapDuration;
        const scale = store.get().timeScale;
        const moved = Number.isNaN(lastLap) ? 0 : ((((t.lapTime - lastLap) % d) + d) % d) / (scale > 0 ? scale : 1);
        lastLap = t.lapTime;
        // a wrap-around jump larger than a frame could ever step is a seek from elsewhere: re-anchor
        const index = timeline.step(moved < 1 ? moved : 0);
        if (index >= 0) startBeat(STORYBOARD[index]!);
        opacity = fadeAt(STORYBOARD, timeline.time);
        const amp = store.get().amplification;
        const text = amp === 1 ? '' : `Hareket ×${amp} · değerler gerçek ölçekte`;
        if (note.textContent !== text) note.textContent = text;
      } else {
        idle = attractMayRun(store.get()) ? idle + dt : 0;
        if (idleStarts && idle >= IDLE_S) store.setKey('attract', true);
        if (exitFade > 0) {
          exitFade = Math.max(0, exitFade - dt / EXIT_FADE_S);
          opacity = exitFade;
        }
      }
      if (opacity !== shownFade) {
        shownFade = opacity;
        fade.style.opacity = String(opacity);
      }
    };
    ctx.addDisposer(() => (frameHandler = undefined));
  },
  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
