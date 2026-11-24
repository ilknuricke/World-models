/**
 * 05-02: procedural cafe racer (VehicleVisual) + `moto-planar` suspension visual, posed from the contract-built
 * fixture frame (tests/fixtures/05-02-moto-frame.ts): every preset builds; a sweep over travel, lean, steer and
 * pitch produces no NaN; the wheels sit on the ground (lean about the contact line); the fork lowers, swingarm and
 * rocker carry their rest points onto the posed ones (so links keep their lengths); highlight is emissive-only per
 * corner; update allocates nothing.
 */
import { Box3, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { MotorcycleSuspensionDefinition } from '../../src/contracts/suspension';
import { simToThree } from '../../src/contracts/units';
import { buildCafeRacer, type CafeRacerVisual } from '../../src/features/motorcycle/visual/cafe-racer';
import { buildMotoPlanar, type MotoPlanarVisual } from '../../src/features/motorcycle/parts/moto-planar';
import { restFrontAxle } from '../../src/features/motorcycle/parts/front';
import { toThree } from '../../src/features/motorcycle/parts/common';
import type { SimCatalog } from '../../src/contracts/sim';
import { cafeRacer } from '../../src/sim-core/content/cafe-racer';
import { motoClassic } from '../../src/sim-core/content/moto-classic';
import { motoModern } from '../../src/sim-core/content/moto-modern';
import { motoTelelever } from '../../src/sim-core/content/moto-telelever';
import { createSimulation } from '../../src/sim-core/index';
import { CAFE_RACER, MOTO_SUSPENSIONS, STATIC_POSE, createMotoFrame, poseMotoFrame, type MotoPose } from '../fixtures/05-02-moto-frame';

const DEG = Math.PI / 180;

function build(susp: MotorcycleSuspensionDefinition): { bike: CafeRacerVisual; parts: MotoPlanarVisual } {
  const bike = buildCafeRacer(CAFE_RACER, { steeringHead: susp.front.steeringHead, rake: susp.front.rake, forkOffset: susp.front.offset, swingarmPivot: susp.rear.pivot });
  const parts = buildMotoPlanar(susp, CAFE_RACER);
  return { bike, parts };
}

function sweep(): MotoPose[] {
  const out: MotoPose[] = [];
  for (const travel of [-0.12, -0.06, 0, 0.06, 0.12]) {
    for (const roll of [-45 * DEG, 0, 30 * DEG]) {
      for (const steer of [-0.35, 0, 0.2]) {
        out.push({ ...STATIC_POSE, travelF: travel, travelR: -travel * 0.8, roll, steer, pitch: travel * 0.3, heading: 0.7, x: 12, y: -4, heave: 0.01, spin: 1 + travel * 10 });
      }
    }
  }
  return out;
}

function finite(root: Object3D): boolean {
  root.updateMatrixWorld(true);
  let ok = true;
  root.traverse((o) => {
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) ok = false;
  });
  return ok;
}

/** Lowest world y over a mesh's vertices. */
function lowest(mesh: Mesh): number {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute('position');
  const v = new Vector3();
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) min = Math.min(min, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).y);
  return min;
}

const named = (root: Object3D, name: string) => {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  return o;
};

describe('05-02 cafe racer + moto-planar visuals', () => {
  it('builds every preset within the draw-call budget', () => {
    for (const susp of MOTO_SUSPENSIONS) {
      const { bike, parts } = build(susp);
      const frame = poseMotoFrame(createMotoFrame(), CAFE_RACER, susp, STATIC_POSE);
      bike.update(frame);
      parts.update(frame);
      const vis = (ms: readonly Mesh[]) => ms.filter((m) => {
        let o: Object3D | null = m;
        while (o) {
          if (!o.visible) return false;
          o = o.parent;
        }
        return true;
      });
      const bikeMeshes = vis(bike.inspect().meshes);
      const partMeshes = vis(parts.inspect().meshes);
      const tris = (ms: readonly Mesh[]) => ms.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);
      console.log(`${susp.id}: bike ${bikeMeshes.length} draws / ${Math.round(tris(bikeMeshes))} tris, suspension ${partMeshes.length} draws / ${Math.round(tris(partMeshes))} tris`);
      const riderMeshes = bikeMeshes.filter((mesh) => mesh.name.startsWith('rider:'));
      expect(riderMeshes.length).toBeGreaterThan(0);
      expect(riderMeshes.length).toBeLessThanOrEqual(8);
      expect(bikeMeshes.length - riderMeshes.length).toBeLessThanOrEqual(7);
      expect(partMeshes.length).toBeLessThanOrEqual(26);
      expect(tris(bikeMeshes) + tris(partMeshes)).toBeLessThan(150000);
      bike.dispose();
      parts.dispose();
    }
  });

  it('poses without NaN over travel, lean, steer and pitch; wheels sit on the ground', () => {
    for (const susp of MOTO_SUSPENSIONS) {
      const { bike, parts } = build(susp);
      const frame = createMotoFrame();
      let worst = 0;
      for (const pose of sweep()) {
        poseMotoFrame(frame, CAFE_RACER, susp, pose);
        bike.update(frame);
        parts.update(frame);
        expect(finite(bike.root)).toBe(true);
        expect(finite(parts.root)).toBe(true);
        expect(parts.inspect().front.visible && parts.inspect().rear.visible).toBe(true);
        // Steering tilts the front wheel plane (rake), which the fixture's patch ignores: check unsteered poses.
        if (pose.steer !== 0) continue;
        // Tyres touch their contact patch (lean about the contact line: the crown sinks at most rc(1 - cos lean)).
        for (const [k, id] of [[0, 'f'], [1, 'r']] as const) {
          const wheel = bike.inspect().hubs[id].children[0]!.children[0] as Mesh;
          const low = lowest(wheel) - frame.corners[k]!.contactPatch.z;
          const rc = (id === 'f' ? CAFE_RACER.front : CAFE_RACER.rear).tyre.crownRadius!;
          const sink = rc * (1 - Math.cos(pose.roll));
          worst = Math.max(worst, Math.abs(low + sink / 2) - sink / 2);
          expect(low).toBeLessThan(0.004);
          expect(low).toBeGreaterThan(-sink - 0.004);
        }
      }
      console.log(`${susp.id}: tyre-to-ground residual ${(worst * 1000).toFixed(1)} mm`);
      bike.dispose();
      parts.dispose();
    }
  });

  it('fork lowers, swingarm, rocker and dog-bone carry their rest points onto the posed points', () => {
    for (const susp of MOTO_SUSPENSIONS) {
      const { parts } = build(susp);
      const frame = createMotoFrame();
      const body = named(parts.root, 'body');
      const restAxleF = restFrontAxle(toThree(susp.front.steeringHead), susp.front.rake, susp.front.offset, CAFE_RACER.front.tyre.radius);
      const restAxleR = toThree(susp.rear.axle);
      let err = 0;
      const dogLengths: number[] = [];
      for (const pose of sweep()) {
        poseMotoFrame(frame, CAFE_RACER, susp, pose);
        parts.update(frame);
        parts.root.updateMatrixWorld(true);
        const world = (name: string, corner: 0 | 1) => {
          const c = frame.corners[corner]!;
          const k = c.pointOrder.indexOf(name);
          return simToThree(c.points[3 * k]!, c.points[3 * k + 1]!, c.points[3 * k + 2]!, new Vector3()) as Vector3;
        };
        const lower = named(parts.root, 'front-unsprung');
        const arm = named(parts.root, 'swingarm');
        err = Math.max(err, lowerCarry(lower, body, restAxleF).distanceTo(world('axle', 0)));
        err = Math.max(err, partCarry(arm, body, restAxleR, toThree(susp.rear.pivot)).distanceTo(world('axle', 1)));
        if (susp.rear.kind === 'swingarm-linkage') {
          const rocker = named(parts.root, 'rocker');
          const B = toThree(susp.rear.rockerPivot);
          err = Math.max(err, partCarry(rocker, body, toThree(susp.rear.rockerShock), B).distanceTo(world('rockerShock', 1)));
          err = Math.max(err, partCarry(rocker, body, toThree(susp.rear.rockerLink), B).distanceTo(world('rockerLink', 1)));
          const [a, b] = parts.inspect().rear.dogBone!;
          dogLengths.push(a.distanceTo(b));
        } else {
          err = Math.max(err, partCarry(arm, body, toThree(susp.rear.shockLower), toThree(susp.rear.pivot)).distanceTo(world('shockLower', 1)));
        }
        if (susp.front.kind === 'telelever') {
          const armF = named(parts.root, 'telelever-arm');
          err = Math.max(err, partCarry(armF, body, toThree(susp.front.shockArm), toThree(susp.front.armPivot)).distanceTo(world('shockArm', 0)));
        }
      }
      console.log(`${susp.id}: worst carried-point error ${(err * 1000).toFixed(2)} mm`);
      expect(err).toBeLessThan(0.0015);
      if (dogLengths.length) expect(Math.max(...dogLengths) - Math.min(...dogLengths)).toBeLessThan(1e-4);
      parts.dispose();
    }
  });

  it('highlight is emissive-only and per corner', () => {
    const susp = MOTO_SUSPENSIONS[1];
    const { parts } = build(susp);
    const frame = poseMotoFrame(createMotoFrame(), CAFE_RACER, susp, STATIC_POSE);
    parts.update(frame);
    const mesh = (name: string) => parts.inspect().meshes.find((m) => m.name === name)!;
    const fork = mesh('fork-upper');
    const arm = mesh('swingarm');
    const fm = fork.material as MeshStandardMaterial;
    const am = arm.material as MeshStandardMaterial;
    const color = fm.color.getHex();
    parts.setHighlight('fork', 'r', true);
    expect(fm.emissiveIntensity).toBe(0);
    parts.setHighlight('fork', 'f', true);
    expect(fm.emissiveIntensity).toBeGreaterThan(0);
    expect(fm.color.getHex()).toBe(color);
    parts.setHighlight('swingarm', 'all', true);
    expect(am.emissiveIntensity).toBeGreaterThan(0);
    parts.setHighlight('spring', 'r', true);
    const springs: MeshStandardMaterial[] = [];
    parts.root.traverse((o) => {
      if ((o as Mesh).isMesh && ((o as Mesh).material as MeshStandardMaterial).name === 'part:spring') springs.push((o as Mesh).material as MeshStandardMaterial);
    });
    expect(springs.length).toBeGreaterThan(0);
    for (const m of springs) expect(m.emissiveIntensity).toBeGreaterThan(0);
    parts.setHighlight('fork', 'all', false);
    expect(fm.emissiveIntensity).toBe(0);
    parts.dispose();
  });

  it('hides the suspension until the frame carries its points; x-ray toggles the ghost and dither uniform', () => {
    const susp = MOTO_SUSPENSIONS[0];
    const { bike, parts } = build(susp);
    const frame = createMotoFrame();
    parts.update(frame);
    expect(parts.inspect().front.visible).toBe(false);
    expect(parts.inspect().rear.visible).toBe(false);
    bike.setXray(1);
    const ghost = named(bike.root, 'xray-ghost');
    expect(ghost.visible).toBe(true);
    // 07-01: x-ray ghosts the bodywork only; the frame, engine and exhausts stay solid (no dither on their material).
    const machine = named(bike.root, 'body:palette') as Mesh;
    const bodywork = named(bike.root, 'body:bodywork') as Mesh;
    expect((machine.material as Material).customProgramCacheKey()).not.toBe((bodywork.material as Material).customProgramCacheKey());
    expect(machine.castShadow).toBe(true);
    expect(bodywork.castShadow).toBe(false);
    bike.setXray(0);
    expect(ghost.visible).toBe(false);
    const box = new Box3().setFromObject(bike.root);
    expect(box.max.y).toBeGreaterThan(1.35);
    expect(box.max.y).toBeLessThan(1.8);
    bike.dispose();
    parts.dispose();
  });

  // Warm-up and allocation sweeps cover all three presets, including the rider's articulated sleeves.
  it('update allocates nothing', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) return;
    for (const susp of MOTO_SUSPENSIONS) {
      const { bike, parts } = build(susp);
      const poses = sweep().map((p) => poseMotoFrame(createMotoFrame(), CAFE_RACER, susp, p));
      // Warm up past JIT tiering so compiled code does not count as allocation.
      for (let i = 0; i < 20000; i++) {
        const f = poses[i % poses.length]!;
        bike.update(f);
        parts.update(f);
      }
      gc();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 20000; i++) {
        const f = poses[i % poses.length]!;
        bike.update(f);
        parts.update(f);
      }
      gc();
      const delta = process.memoryUsage().heapUsed - before;
      console.log(`${susp.id}: heap delta after 20000 updates ${delta} B`);
      expect(delta).toBeLessThan(64 * 1024);
      bike.dispose();
      parts.dispose();
    }
  }, 60_000);
  it('follows the real 05-01 simulation for all three presets (amplification 1 and 3)', () => {
    const presets = [motoClassic, motoModern, motoTelelever];
    const catalog: SimCatalog = {
      track: () => undefined,
      vehicle: (id) => (id === cafeRacer.id ? cafeRacer : undefined),
      suspension: (id) => presets.find((p) => p.id === id),
    };
    for (const susp of presets) {
      if (susp.vehicleClass !== 'motorcycle') continue;
      const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: cafeRacer.id, suspensionId: susp.id });
      const bike = buildCafeRacer(cafeRacer);
      const parts = buildMotoPlanar(susp, cafeRacer);
      const body = named(parts.root, 'body');
      const restAxleF = restFrontAxle(toThree(susp.front.steeringHead), susp.front.rake, susp.front.offset, cafeRacer.front.tyre.radius);
      let carryErr = 0;
      let tyreLo = Infinity;
      let tyreHi = -Infinity;
      let maxRoll = 0;
      for (let k = 0; k < 40; k++) {
        sim.seek((k / 40) * sim.lapDuration);
        for (const amp of [1, 3]) {
          const f = sim.sample(1, amp);
          maxRoll = Math.max(maxRoll, Math.abs(f.roll));
          bike.update(f);
          parts.update(f);
          expect(finite(bike.root) && finite(parts.root)).toBe(true);
          expect(parts.inspect().front.visible && parts.inspect().rear.visible).toBe(true);
          parts.root.updateMatrixWorld(true);
          const pt = (ci: 0 | 1, name: string) => {
            const c = f.corners[ci]!;
            const j = c.pointOrder.indexOf(name);
            return simToThree(c.points[3 * j]!, c.points[3 * j + 1]!, c.points[3 * j + 2]!, new Vector3()) as Vector3;
          };
          if (susp.front.kind === 'telelever') {
            carryErr = Math.max(carryErr, partCarry(named(parts.root, 'telelever-arm'), body, toThree(susp.front.shockArm), toThree(susp.front.armPivot)).distanceTo(pt(0, 'shockArm')));
          }
          if (susp.rear.kind === 'swingarm-linkage') {
            const B = toThree(susp.rear.rockerPivot);
            carryErr = Math.max(carryErr, partCarry(named(parts.root, 'rocker'), body, toThree(susp.rear.rockerShock), B).distanceTo(pt(1, 'rockerShock')));
          } else {
            carryErr = Math.max(carryErr, partCarry(named(parts.root, 'swingarm'), body, toThree(susp.rear.shockLower), toThree(susp.rear.pivot)).distanceTo(pt(1, 'shockLower')));
          }
          for (const [ci, name] of [[0, 'axle'], [1, 'axle']] as const) {
            const c = f.corners[ci]!;
            const j = c.pointOrder.indexOf(name);
            const w = simToThree(c.points[3 * j]!, c.points[3 * j + 1]!, c.points[3 * j + 2]!, new Vector3()) as Vector3;
            const got = ci === 0 ? lowerCarry(named(parts.root, 'front-unsprung'), body, restAxleF) : partCarry(named(parts.root, 'swingarm'), body, toThree(susp.rear.axle), toThree(susp.rear.pivot));
            carryErr = Math.max(carryErr, got.distanceTo(w));
            // The wheel mesh hub sits on the posed axle too.
            const hub = bike.inspect().hubs[ci === 0 ? 'f' : 'r'];
            hub.updateMatrixWorld(true);
            expect(new Vector3().setFromMatrixPosition(hub.matrixWorld).distanceTo(w)).toBeLessThan(0.002);
            if (amp === 1) {
              const wheel = hub.children[0]!.children[0] as Mesh;
              const d = lowest(wheel) - c.contactPatch.z;
              tyreLo = Math.min(tyreLo, d);
              tyreHi = Math.max(tyreHi, d);
            }
          }
        }
      }
      console.log(`${susp.id} (live sim): carried point error ${(carryErr * 1000).toFixed(2)} mm, lowest tyre point minus contact patch ${(tyreLo * 1000).toFixed(1)}..${(tyreHi * 1000).toFixed(1)} mm, max lean ${((maxRoll * 180) / Math.PI).toFixed(1)} deg`);
      expect(carryErr).toBeLessThan(0.002);
      expect(tyreHi).toBeLessThan(0.006);
      expect(tyreLo).toBeGreaterThan(-0.03);
      bike.dispose();
      parts.dispose();
    }
  });
});

/**
 * Where a rigid part puts a body-space rest point now: the part's transform relative to the body, applied to the
 * rest point expressed in the part's rest frame. Parts here are authored so that their rest local frame is the
 * body frame translated to `origin` (swingarm, rocker, A-arm: the group sits at its pivot at rest).
 */
function partCarry(o: Object3D, body: Object3D, rest: Vector3, origin: Vector3): Vector3 {
  const rel = new Matrix4().copy(body.matrixWorld).invert().multiply(o.matrixWorld);
  return rest.clone().sub(origin).applyMatrix4(rel).applyMatrix4(body.matrixWorld);
}

/** Fork lowers: authored in body rest coordinates directly (group origin = body origin at rest). */
function lowerCarry(o: Object3D, body: Object3D, rest: Vector3): Vector3 {
  const rel = new Matrix4().copy(body.matrixWorld).invert().multiply(o.matrixWorld);
  return rest.clone().applyMatrix4(rel).applyMatrix4(body.matrixWorld);
}
