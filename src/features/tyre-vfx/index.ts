import { Group } from 'three';
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { RENDER } from '../../contracts/services';
import { h, mount } from '../../ui/dom';
import { createMarks } from './marks';
import { createRings, RING_CORNERS } from './rings';
import { createVfx } from './vfx';
import './tyre-vfx.css';

declare global {
  /** e2e only (?e2e=1): what the tyre VFX drew on the last frame. */
  var __tyreVfx:
    | (() => {
        rings: boolean;
        chip: { shown: boolean; pressed: boolean; text: string };
        corners: { id: string; radius: number; dotX: number; dotY: number; past: boolean; warn: number }[];
        marks: { visible: boolean; written: number };
      })
    | undefined;
}

let tick: ((frame: FrameInfo) => void) | undefined;

const token = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/**
 * Friction rings and skid marks (ARCHITECTURE-M2 §10.5). Rings: on by default outside Auto (the "Grip rings" chip in the
 * drive action row toggles them); in Auto only with the engineer overlay, showing the demand estimate. Hidden in
 * close-up. Skid marks: only past the limit, only from the Manual Drive plant; cleared on reset, a cut, a vehicle swap
 * and a seek. A motorcycle (two corners) draws nothing.
 */
export default {
  id: 'tyre-vfx',
  requires: ['renderer'],
  phase: 'scene',
  init(ctx) {
    const render = ctx.services.get(RENDER);
    const ink = token('--text-1', '#edeef0');
    const warnColour = token('--warn', '#ffb454');
    const rings = createRings(ink, warnColour);
    const marks = createMarks('#030304', warnColour);
    const group = new Group();
    group.name = 'tyre-vfx';
    group.add(marks.mesh, rings.mesh, rings.xray);
    ctx.addDisposer(render.add(group));
    ctx.addDisposer(() => {
      rings.dispose();
      marks.dispose();
    });

    const chip = h(
      'button',
      {
        class: 'sl-drive-action sl-tyre-vfx',
        type: 'button',
        'aria-pressed': 'true',
        hidden: true,
        title: 'Her lastiğin altındaki tutunma halkaları: halka = mevcut tutunma, nokta = kullanılan tutunma. Basitleştirilmiş lastik modeli.',
      },
      h('span', { class: 'sl-tyre-vfx-glyph', 'aria-hidden': 'true' }),
      h('span', { class: 'sl-drive-action-label' }, 'Tutunma halkaları ', h('span', { class: 'sl-tyre-vfx-tag' }, 'model')),
    );
    ctx.addDisposer(mount(ctx.dom.overlay, chip));

    const vfx = createVfx(rings, marks);
    const setVehicle = () => vfx.setVehicle(ctx.sim.current.vehicle);

    let wanted = true;
    let ringsOn = false;
    let chipShown = false;
    let reduced = false;
    const isCar = () => vfx.hasRings && ctx.sim.frame.corners.length === RING_CORNERS;
    const apply = () => {
      const s = ctx.store.get();
      reduced = s.reducedMotion;
      const offered = isCar() && (s.driveMode !== 'auto' || s.overlay === 'engineer');
      chipShown = offered && s.hudVisible && !s.attract;
      chip.hidden = !chipShown;
      chip.setAttribute('aria-pressed', String(wanted));
      ringsOn = offered && wanted && s.view !== 'closeup';
      if (!ringsOn) rings.setCount(0);
    };
    chip.addEventListener('click', () => {
      wanted = !wanted;
      apply();
    });
    setVehicle();
    ctx.watch(() => apply());
    ctx.on('sim:vehicle', () => {
      setVehicle();
      apply();
    });
    ctx.on('sim:seek', () => marks.clear());
    ctx.on('drive:mode', ({ cut }) => (cut ? marks.clear() : marks.breakAll()));
    ctx.on('drive:event', (e) => {
      if (e.kind === 'reset') marks.clear();
    });

    tick = (frame) => vfx.update(frame.t, ringsOn, reduced);

    if (ctx.flags.e2e) {
      globalThis.__tyreVfx = () => ({
        rings: rings.mesh.visible && rings.mesh.geometry.instanceCount > 0,
        chip: { shown: !chip.hidden, pressed: chip.getAttribute('aria-pressed') === 'true', text: chip.textContent ?? '' },
        corners: ctx.sim.frame.corners.map((c, i) => {
          const s = vfx.states[i];
          return { id: c.id, radius: s?.radius ?? 0, dotX: s?.dotX ?? 0, dotY: s?.dotY ?? 0, past: s?.past ?? false, warn: vfx.warn[i] ?? 0 };
        }),
        marks: { visible: marks.mesh.visible, written: marks.written },
      });
      ctx.addDisposer(() => {
        globalThis.__tyreVfx = undefined;
      });
    }
    ctx.addDisposer(() => {
      tick = undefined;
    });
  },
  update(frame: FrameInfo) {
    tick?.(frame);
  },
} satisfies FeatureModule;
