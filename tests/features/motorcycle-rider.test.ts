import { Box3, Group, Quaternion, Vector3, type Material, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { MotorcycleSuspensionDefinition } from '../../src/contracts/suspension';
import { simQuatToThree, simToThree } from '../../src/contracts/units';
import { buildCafeRacer } from '../../src/features/motorcycle/visual/cafe-racer';
import { createRider } from '../../src/features/motorcycle/visual/rider';
import { cafeRacer } from '../../src/sim-core/content/cafe-racer';
import { motoClassic } from '../../src/sim-core/content/moto-classic';
import { motoModern } from '../../src/sim-core/content/moto-modern';
import { motoTelelever } from '../../src/sim-core/content/moto-telelever';
import { createMotoFrame, poseMotoFrame, STATIC_POSE } from '../fixtures/05-02-moto-frame';

const PRESETS = [motoClassic, motoModern, motoTelelever];

/** Centre of the physical grip authored by parts/front.ts, including steering about the raked head. */
function grip(front: MotorcycleSuspensionDefinition['front'], side: -1 | 1, steer: number): Vector3 {
  const head = new Vector3(front.steeringHead[0], front.steeringHead[2], -front.steeringHead[1]);
  const up = new Vector3(-Math.sin(front.rake), Math.cos(front.rake), 0);
  const forward = new Vector3(Math.cos(front.rake), Math.sin(front.rake), 0);
  const half = Math.max(0.1, cafeRacer.front.tyre.width / 2 + 0.045);
  const bar = new Vector3(-0.13, -0.035, side * 0.22);
  return head.clone().addScaledVector(up, -0.03).addScaledVector(forward, front.offset)
    .add(new Vector3(0, 0, side * (half + 0.03))).add(bar)
    .addScaledVector(bar.clone().normalize(), -0.0625)
    .sub(head).applyAxisAngle(up, steer).add(head);
}

function named(root: Object3D, name: string): Object3D {
  const part = root.getObjectByName(name);
  if (!part) throw new Error(`Missing ${name}`);
  return part;
}

describe('motorcycle rider', () => {
  it.each(PRESETS)('keeps both hands on the $id grips through steering, lean and pitch', (preset) => {
    // Default construction exercises the live suspension-id lookup when the visitor changes presets.
    const bike = buildCafeRacer(cafeRacer);
    const frame = createMotoFrame();
    try {
      for (const steer of [-0.35, 0, 0.3]) {
        for (const [roll, pitch] of [[0, 0], [-0.65, 0.08], [0.5, -0.06]] as const) {
          poseMotoFrame(frame, cafeRacer, preset, { ...STATIC_POSE, steer, roll, pitch, heading: 0.7, x: 12, y: -4, heave: 0.02 });
          bike.update(frame);
          bike.root.updateMatrixWorld(true);
          const orientation = simQuatToThree(frame.bodyRotation, new Quaternion()) as Quaternion;
          const origin = simToThree(frame.bodyPosition.x, frame.bodyPosition.y, frame.bodyPosition.z, new Vector3()) as Vector3;
          for (const [side, hand] of [[-1, 'rider:left-hand'], [1, 'rider:right-hand']] as const) {
            const expected = grip(preset.front, side, steer).applyQuaternion(orientation).add(origin);
            const actual = named(bike.root, hand).getWorldPosition(new Vector3());
            expect(actual.distanceTo(expected), `${preset.id} ${hand}, steer ${steer}, lean ${roll}`).toBeLessThan(0.001);
          }
        }
      }
    } finally {
      bike.dispose();
    }
  });

  it('has seated human proportions and keeps the boots above the road', () => {
    const rider = createRider();
    try {
      rider.update(0);
      const box = new Box3().setFromObject(rider.root);
      expect(box.max.y).toBeGreaterThan(1.35);
      expect(box.max.y).toBeLessThan(1.8);
      expect(box.min.y).toBeGreaterThan(0.25);
      expect(box.getSize(new Vector3()).z).toBeLessThan(1);
    } finally {
      rider.dispose();
    }
  });

  it('releases each shared geometry and material once when removed', () => {
    const rider = createRider();
    const scene = new Group();
    scene.add(rider.root);
    const geometries = new Set(rider.meshes.map((mesh) => mesh.geometry));
    const materials = new Set<Material>(rider.meshes.flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
    const textures = new Set<Texture>();
    for (const material of materials) {
      const surface = material as MeshStandardMaterial;
      if (surface.normalMap) textures.add(surface.normalMap);
      if (surface.roughnessMap) textures.add(surface.roughnessMap);
    }
    expect(textures.size).toBeGreaterThan(0);
    const disposals = [...geometries, ...materials, ...textures].map((resource) => vi.spyOn(resource, 'dispose'));
    rider.dispose();
    expect(rider.root.parent).toBeNull();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('has finite texture coordinates on every fabric surface', () => {
    const rider = createRider();
    try {
      for (const mesh of rider.meshes) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!materials.some((material) => (material as MeshStandardMaterial).normalMap)) continue;
        const uv = mesh.geometry.getAttribute('uv');
        expect(uv, mesh.name).toBeDefined();
        expect(uv.count, mesh.name).toBe(mesh.geometry.getAttribute('position').count);
        for (let i = 0; i < uv.count; i++) {
          expect(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)), mesh.name).toBe(true);
        }
      }
    } finally {
      rider.dispose();
    }
  });
});
