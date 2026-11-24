/**
 * Touch intent source (ARCHITECTURE-M2 §10.4; research m2/07 §4): coarse pointers, Manual only. Left: a horizontal
 * steering slider (relative drag from the touch-down point, springs back on release). Right: GAS above BRAKE pads.
 * Pointer Events with capture and `touch-action: none` on the controls only, so a drag anywhere else still orbits the
 * camera. The pads are on/off; this source ramps them itself and reports an analog intent (the slider is analog).
 */
import type { DriveIntent } from '../../contracts/drive';
import type { DriveIntentSource } from '../../contracts/services';
import { h } from '../../ui/dom';

export const TOUCH = {
  /** Slider travel from the centre to full lock, as a share of the track's half width. */
  fullLock: 0.85,
  /** Dead band around the touch-down point, px. */
  deadPx: 4,
  /** Pedal ramps, 1/s (press, release). */
  pedalRise: 5,
  pedalFall: 10,
} as const;

/** Steer demand from a drag of `dx` px on a track `halfWidth` px wide: + = left (drag right = steer right). */
export function sliderSteer(dx: number, halfWidth: number): number {
  const a = Math.abs(dx) - TOUCH.deadPx;
  if (!(a > 0) || !(halfWidth > 0)) return 0;
  return -Math.sign(dx) * Math.min(1, a / (halfWidth * TOUCH.fullLock - TOUCH.deadPx));
}

/** Moves `x` toward `target` at `rise` (up) / `fall` (down) per second. */
export function approach(x: number, target: number, rise: number, fall: number, dt: number): number {
  return target > x ? Math.min(target, x + rise * dt) : Math.max(target, x - fall * dt);
}

export interface TouchSource extends DriveIntentSource {
  readonly el: HTMLElement;
  /** Releases every pointer (hand-back, hidden). */
  release(): void;
  dispose(): void;
}

export function createTouchSource(onInput: () => void): TouchSource {
  const knob = h('span', { class: 'sl-drive-steer-knob', 'aria-hidden': 'true' });
  const steerEl = h(
    'div',
    { class: 'sl-drive-steer', role: 'slider', 'aria-label': 'Direksiyon', 'aria-valuemin': '-1', 'aria-valuemax': '1', 'aria-valuenow': '0' },
    h('span', { class: 'sl-drive-steer-track', 'aria-hidden': 'true' }, h('span', { class: 'sl-drive-steer-mark' })),
    knob,
  );
  const gas = h('div', { class: 'sl-drive-pad', 'data-pad': 'gas', role: 'button', 'aria-label': 'Gaz ver' }, 'Gaz');
  const brake = h('div', { class: 'sl-drive-pad', 'data-pad': 'brake', role: 'button', 'aria-label': 'Fren; geri gitmek için durduktan sonra basılı tut' }, 'Fren');
  const el = h('div', { class: 'sl-drive-touch', hidden: true }, steerEl, h('div', { class: 'sl-drive-pedals' }, gas, brake));

  let steerId = -1;
  let x0 = 0;
  let steer = 0;
  const held = { gas: -1, brake: -1 };
  const level = { gas: 0, brake: 0 };
  let lastT = NaN;
  const offs: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
    window.addEventListener(type, fn);
    offs.push(() => window.removeEventListener(type, fn));
  };

  const capture = (target: HTMLElement, id: number) => {
    try {
      target.setPointerCapture(id);
    } catch {
      // synthetic or already-ended pointer: the window listeners still see it
    }
  };
  const setKnob = () => {
    knob.style.transform = `translateX(${(-steer * TOUCH.fullLock * 50).toFixed(1)}%)`;
    steerEl.setAttribute('aria-valuenow', (-steer).toFixed(2));
  };
  steerEl.addEventListener('pointerdown', (e) => {
    if (steerId !== -1) return;
    e.preventDefault();
    steerId = e.pointerId;
    x0 = e.clientX;
    capture(steerEl, e.pointerId);
    steerEl.classList.add('is-held');
    onInput();
  });
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== steerId) return;
    steer = sliderSteer(e.clientX - x0, steerEl.getBoundingClientRect().width / 2);
    setKnob();
  };
  const endSteer = (e: PointerEvent) => {
    if (e.pointerId !== steerId) return;
    steerId = -1;
    steer = 0;
    setKnob();
    steerEl.classList.remove('is-held');
  };
  steerEl.addEventListener('pointermove', onMove);
  on('pointermove', onMove);
  for (const type of ['pointerup', 'pointercancel'] as const) on(type, endSteer);
  steerEl.addEventListener('lostpointercapture', endSteer);

  const pad = (node: HTMLElement, key: 'gas' | 'brake') => {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      held[key] = e.pointerId;
      capture(node, e.pointerId);
      node.classList.add('is-held');
      onInput();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== held[key]) return;
      held[key] = -1;
      node.classList.remove('is-held');
    };
    for (const type of ['pointerup', 'pointercancel'] as const) on(type, end);
    node.addEventListener('lostpointercapture', end);
  };
  pad(gas, 'gas');
  pad(brake, 'brake');
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  const release = () => {
    steerId = held.gas = held.brake = -1;
    steer = level.gas = level.brake = 0;
    setKnob();
    for (const n of [steerEl, gas, brake]) n.classList.remove('is-held');
  };

  return {
    id: 'touch',
    el,
    read(out: DriveIntent) {
      const now = performance.now() / 1000;
      const dt = lastT === lastT ? Math.min(0.1, Math.max(0, now - lastT)) : 0;
      lastT = now;
      level.gas = approach(level.gas, held.gas !== -1 ? 1 : 0, TOUCH.pedalRise, TOUCH.pedalFall, dt);
      level.brake = approach(level.brake, held.brake !== -1 ? 1 : 0, TOUCH.pedalRise, TOUCH.pedalFall, dt);
      out.steer = steer;
      out.throttle = level.gas;
      out.brake = level.brake;
      out.handbrake = 0;
      out.digital = false;
      out.source = 'touch';
      return steerId !== -1 || held.gas !== -1 || held.brake !== -1;
    },
    release,
    dispose() {
      for (const off of offs) off();
      release();
      el.remove();
    },
  };
}
