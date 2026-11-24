import { readFileSync } from 'node:fs';
import { Box3, Group, Quaternion, SkinnedMesh, Texture, Vector3, type Bone, type Material, type MeshStandardMaterial, type Object3D, type Skeleton } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import type { MotorcycleSuspensionDefinition } from '../../src/contracts/suspension';
import { simQuatToThree, simToThree } from '../../src/contracts/units';
import { buildCafeRacer } from '../../src/features/motorcycle/visual/cafe-racer';
import { createRiggedRider } from '../../src/features/motorcycle/visual/rigged-rider';
import { cafeRacer } from '../../src/sim-core/content/cafe-racer';
import { motoClassic } from '../../src/sim-core/content/moto-classic';
import { motoModern } from '../../src/sim-core/content/moto-modern';
import { motoTelelever } from '../../src/sim-core/content/moto-telelever';
import { createMotoFrame, poseMotoFrame, STATIC_POSE } from '../fixtures/05-02-moto-frame';

const PRESETS = [motoClassic, motoModern, motoTelelever];
const bytes = readFileSync(new URL('../../assets-src/rider/rocketbox-male.glb', import.meta.url));

/** Keep the real asset's geometry, weights and skeleton; only Node's unavailable image decoding is replaced. */
async function asset(): Promise<Group> {
  const loader = new GLTFLoader().register(() => ({
    name: 'headless-rider-textures',
    loadTexture: async () => new Texture(),
  }));
  const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return (await loader.parseAsync(binary, '')).scene;
}

function named(root: Object3D, name: string): Object3D {
  const part = root.getObjectByName(name);
  if (!part) throw new Error(`Missing ${name}`);
  return part;
}

function under(child: Object3D, parent: Object3D): boolean {
  for (let node: Object3D | null = child; node; node = node.parent) if (node === parent) return true;
  return false;
}

/** Independently calculated physical grip centres from the clip-on geometry in parts/front.ts. */
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

function skinMeshes(root: Object3D): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  root.traverse((part) => { if ((part as SkinnedMesh).isSkinnedMesh) meshes.push(part as SkinnedMesh); });
  return meshes;
}

describe('imported human motorcycle rider', () => {
  it('uses the downloaded textured human skin and weighted skeleton', async () => {
    const rider = createRiggedRider(await asset());
    try {
      const meshes = skinMeshes(rider.root);
      expect(meshes).toHaveLength(3);
      expect(rider.meshes).toEqual(expect.arrayContaining(meshes));
      const bones = new Set<Bone>();
      let triangles = 0;
      for (const mesh of meshes) {
        mesh.skeleton.bones.forEach((bone) => bones.add(bone));
        const index = mesh.geometry.getAttribute('skinIndex');
        const weight = mesh.geometry.getAttribute('skinWeight');
        expect(index.count).toBe(mesh.geometry.getAttribute('position').count);
        expect(weight.count).toBe(index.count);
        for (let i = 0; i < weight.count; i++) {
          const sum = weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i);
          expect(sum).toBeCloseTo(1, 3);
        }
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        expect(materials.some((material) => (material as Material & { map?: Texture }).map?.isTexture)).toBe(true);
        expect(mesh.frustumCulled).toBe(false); // standing bind-pose bounds cannot clip the seated character
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
      }
      expect(bones.size).toBeGreaterThan(50);
      expect(triangles).toBeGreaterThan(5000);
      expect(triangles).toBeLessThan(15000);
    } finally {
      rider.dispose();
    }
  });

  it.each(PRESETS)('keeps the actual $id palms on the grips through steering, lean and pitch', async (preset) => {
    const rider = createRiggedRider(await asset());
    const bike = buildCafeRacer(cafeRacer, { rider });
    const frame = createMotoFrame();
    const palmOffsets = new Map<string, Vector3>();
    let maximumError = 0;
    try {
      for (const [anchorName, boneName] of [['rider:left-hand', 'LeftHand'], ['rider:right-hand', 'RightHand']] as const) {
        const bone = named(rider.root, boneName);
        expect((bone as Bone).isBone).toBe(true);
        const anchor = named(rider.root, anchorName);
        expect(under(anchor, bone), `${anchorName} must be on the real hand hierarchy`).toBe(true);
        palmOffsets.set(anchorName, anchor.position.clone());
      }
      for (const steer of [-0.35, 0, 0.3]) {
        for (const [roll, pitch] of [[0, 0], [-0.65, 0.08], [0.5, -0.06]] as const) {
          poseMotoFrame(frame, cafeRacer, preset, { ...STATIC_POSE, steer, roll, pitch, heading: 0.7, x: 12, y: -4, heave: 0.02 });
          bike.update(frame);
          bike.root.updateMatrixWorld(true);
          const orientation = simQuatToThree(frame.bodyRotation, new Quaternion()) as Quaternion;
          const origin = simToThree(frame.bodyPosition.x, frame.bodyPosition.y, frame.bodyPosition.z, new Vector3()) as Vector3;
          for (const [side, hand] of [[-1, 'rider:left-hand'], [1, 'rider:right-hand']] as const) {
            const expected = grip(preset.front, side, steer).applyQuaternion(orientation).add(origin);
            const anchor = named(rider.root, hand);
            expect(anchor.position.distanceTo(palmOffsets.get(hand)!)).toBeLessThan(1e-8); // the bone moves, not a dummy marker
            const actual = anchor.getWorldPosition(new Vector3());
            const error = actual.distanceTo(expected);
            maximumError = Math.max(maximumError, error);
            expect(error, `${preset.id} ${hand}, steer ${steer}, lean ${roll}`).toBeLessThan(0.003);
          }
          rider.root.traverse((part) => {
            expect(part.matrixWorld.elements.every(Number.isFinite), part.name).toBe(true);
          });
        }
      }
      console.log(`${preset.id}: maximum imported-palm contact error ${(maximumError * 1000).toFixed(3)} mm`);
    } finally {
      bike.dispose();
    }
  });

  it('has a seated human silhouette with both feet near the pegs', async () => {
    const rider = createRiggedRider(await asset());
    try {
      rider.update(0, motoClassic.front);
      rider.root.updateMatrixWorld(true);
      for (const mesh of skinMeshes(rider.root)) mesh.skeleton.update();
      const bounds = new Box3().setFromObject(rider.root, true);
      expect(bounds.max.y).toBeGreaterThan(1.3);
      expect(bounds.max.y).toBeLessThan(1.85);
      expect(bounds.min.y).toBeGreaterThan(0.15);
      expect(bounds.getSize(new Vector3()).z).toBeLessThan(1);
      for (const [side, name, boneName] of [[-1, 'rider:left-foot', 'LeftFoot'], [1, 'rider:right-foot', 'RightFoot']] as const) {
        const anchor = named(rider.root, name);
        expect(under(anchor, named(rider.root, boneName))).toBe(true);
        const actual = anchor.getWorldPosition(new Vector3());
        const peg = new Vector3(-0.28, 0.36, side * 0.2);
        expect(actual.distanceTo(peg), name).toBeLessThan(0.08);
      }
    } finally {
      rider.dispose();
    }
  });

  it('disposes shared skin resources, bitmap images and bone textures once', async () => {
    const rider = createRiggedRider(await asset());
    class HeadlessImageBitmap {
      readonly width = 4;
      readonly height = 4;
      close = vi.fn();
    }
    vi.stubGlobal('ImageBitmap', HeadlessImageBitmap);
    try {
      new Group().add(rider.root);
      const meshes = skinMeshes(rider.root);
      const geometries = new Set(meshes.map((mesh) => mesh.geometry));
      const materials = new Set(meshes.flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
      const sharedBitmap = new HeadlessImageBitmap();
      const separateBitmap = new HeadlessImageBitmap();
      // Separate texture sources can share one decoded image, just as glTF texture variants do.
      const material = [...materials][0]! as MeshStandardMaterial;
      material.lightMap = new Texture();
      material.envMap = new Texture();
      const textures = new Set<Texture>();
      for (const entry of materials) {
        for (const value of Object.values(entry)) if (value instanceof Texture) textures.add(value);
      }
      for (const texture of textures) texture.image = sharedBitmap;
      material.envMap.image = separateBitmap;
      const skeletons = new Set<Skeleton>(meshes.map((mesh) => mesh.skeleton));
      for (const skeleton of skeletons) {
        skeleton.computeBoneTexture();
        if (skeleton.boneTexture) textures.add(skeleton.boneTexture);
      }
      const disposals = [...geometries, ...materials, ...textures, ...skeletons].map((resource) => vi.spyOn(resource, 'dispose'));
      rider.dispose();
      rider.dispose();
      expect(rider.root.parent).toBeNull();
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
      expect(sharedBitmap.close).toHaveBeenCalledTimes(1);
      expect(separateBitmap.close).toHaveBeenCalledTimes(1);
    } finally {
      rider.dispose();
      vi.unstubAllGlobals();
    }
  });
});
