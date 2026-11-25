import { Group, Vector2 } from 'three';
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { RENDER } from '../../contracts/services';
import { mount } from '../../ui/dom';
import { createConstruction } from './construction';
import { createLineBatch } from './lines';
import { createTracePanel, type AxlePlot, type TraceMetric, type TravelLimits } from './trace';
import './teaching-overlays.css';

const PANEL_DT = 1 / 30;

let tick: ((frame: FrameInfo) => void) | undefined;

/**
 * Engineer layer (store.overlay === 'engineer'; entering close-up switches it on): live front-view construction,
 * ghost rest pose, load arrows and the camber trace. Geometry follows the (possibly amplified) POSE fields; every
 * number shown is a TRUE value from the frame.
 */
export default {
  id: 'teaching-overlays',
  requires: ['renderer'],
  phase: 'scene',
  init(ctx) {
    const render = ctx.services.get(RENDER);
    // A strong dark casing keeps the strokes legible over the bright x-ray shell and the sky alike.
    const main = createLineBatch({ capacity: 1000, width: 2.5, casing: 6, casingStrength: 0.85, renderOrder: 40, name: 'teaching-overlays:construction' });
    const ghost = createLineBatch({ capacity: 1400, width: 1.5, casing: 0, renderOrder: 38, name: 'teaching-overlays:ghost' });
    const group = new Group();
    group.name = 'teaching-overlays';
    group.visible = false;
    group.add(...ghost.objects, ...main.objects);
    ctx.addDisposer(render.add(group));
    ctx.addDisposer(() => {
      main.dispose();
      ghost.dispose();
    });
    const construction = createConstruction(main, ghost);
    const panel = createTracePanel();
    ctx.addDisposer(mount(ctx.dom.overlay, panel.root));

    const metric = (): TraceMetric => (ctx.sim.current.vehicle.class === 'car' ? 'camber' : 'motionRatio');
    const limits = (): TravelLimits => {
      const s = ctx.sim.current.suspension;
      if (s.vehicleClass !== 'car') return [];
      return [s.axles.front, s.axles.rear].map((a) => [a.travel.droop, a.travel.bump] as const);
    };
    const curves = (previous: readonly (AxlePlot | null)[] | null, label: string) =>
      panel.setCurves(ctx.sim.current.kinematics(), metric(), limits(), previous, label);
    curves(null, '');
    ctx.on('sim:suspension', ({ previous }) => {
      curves(panel.plots, ctx.registries.suspensions.get(previous)?.copy.label ?? '');
      construction.reset();
    });
    ctx.on('sim:vehicle', () => {
      curves(null, '');
      construction.reset();
    });
    ctx.on('sim:seek', () => construction.reset());

    let active = false;
    let view: string | undefined;
    let farFloor = 0.22;
    let focus: string | null = null;
    ctx.watch((s) => {
      // Close-up defaults the engineer layer on (on entering it); the user can switch it off again there.
      if (s.view === 'closeup' && view !== 'closeup' && s.overlay !== 'engineer') {
        view = s.view;
        ctx.store.setKey('overlay', 'engineer');
        return;
      }
      view = s.view;
      // Close-up: only the focused axle's construction; the far one would cross the linkage through the body.
      farFloor = s.view === 'closeup' ? 0 : 0.22;
      // ...and only the focused corner (a bike: the focused end): the other wheels' lines would cross the frame.
      focus = s.view === 'closeup' ? (s.focusCorner ?? '') : null;
      const on = s.overlay === 'engineer';
      if (on && !active) construction.reset();
      active = on;
      group.visible = on;
      // The measurement card belongs to close-up, independently of the selected 3D construction layer.
      panel.setVisible(on && s.view === 'closeup' && s.hudVisible && !s.attract);
    });

    const size = new Vector2();
    const eye = { x: 0, y: 0, z: 0 };
    let panelClock = PANEL_DT;
    tick = (frame) => {
      if (!active) return;
      render.renderer.getSize(size);
      main.setResolution(size.x, size.y);
      ghost.setResolution(size.x, size.y);
      // last frame's camera (the camera phase runs after this one): three (x, y, z) -> sim (x, -z, y)
      const c = render.camera.position;
      eye.x = c.x;
      eye.y = -c.z;
      eye.z = c.y;
      construction.draw(frame.t, ctx.sim.current, frame.dt, eye, farFloor, focus);
      panelClock += frame.dt;
      if (panelClock >= PANEL_DT) {
        panelClock = 0;
        panel.draw(frame.t);
      }
    };
    ctx.addDisposer(() => {
      tick = undefined;
    });
  },
  update(frame: FrameInfo) {
    tick?.(frame);
  },
} satisfies FeatureModule;
