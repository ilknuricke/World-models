/** The Rocketbox human asset, seated and posed through its original skin and skeleton. */
import { Bone, Box3, DoubleSide, Group, Matrix4, Mesh, Quaternion, SkinnedMesh, Texture, Vector3, type Material, type Object3D, type Skeleton } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FORK_OFFSET, FORK_RAKE, HEAD_ABOVE_AXLE, steeringPoints, SWINGARM_PIVOT } from '../../../sim-core/content/cafe-racer';
import type { RiderFrontGeometry, RiderOptions, RiderVisual } from './rider';
import { createRiderHelmet } from './rider-helmet';

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const Z = V(0, 0, 1);

/** Decode the actual self-contained textured GLB only when the motorcycle is selected. */
export async function loadRiggedRider(url: string, options: RiderOptions = {}): Promise<RiderVisual> {
  const asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  return createRiggedRider(asset.scene, options);
}

export function createRiggedRider(scene: Object3D, options: RiderOptions = {}): RiderVisual {
  const root = new Group();
  root.name = 'rider';
  const model = new Group();
  model.name = 'rider:rocketbox-model';
  root.add(model);
  scene.updateMatrixWorld(true);
  const standing = new Box3().setFromObject(scene);
  const height = standing.max.y - standing.min.y;
  if (!Number.isFinite(height) || height < 0.1) throw new Error('rider: human asset has no usable standing bounds');
  // The GLB is already in metres and faces +Z. Motorcycle body space faces +X.
  model.scale.setScalar(1.78 / height);
  model.rotation.y = Math.PI / 2;
  model.add(scene);
  root.updateMatrixWorld(true);

  const bone = (name: string): Bone => {
    const found = scene.getObjectByName(name);
    if (!found || !(found as Bone).isBone) throw new Error(`rider: missing human joint ${name}`);
    return found as Bone;
  };
  const meshes: Mesh[] = [];
  const skeletons = new Set<Skeleton>();
  const materials = new Set<Material>();
  scene.traverse((object) => {
    if (!(object as Mesh).isMesh) return;
    const mesh = object as Mesh;
    mesh.name = `rider:asset:${mesh.name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    // T-pose bounds do not describe the seated skin or its moving arms.
    mesh.frustumCulled = false;
    meshes.push(mesh);
    if ((mesh as SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as SkinnedMesh).skeleton);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      if (material.transparent || /opacity|hair|lash/i.test(material.name)) {
        material.transparent = false;
        material.alphaTest = 0.35;
        material.depthWrite = true;
        material.side = DoubleSide;
      }
    }
  });
  if (!meshes.length || !skeletons.size) throw new Error('rider: the human asset must contain a skinned mesh');

  const hips = bone('Hips');
  const head = bone('Head');
  const headLevel = head.getWorldQuaternion(new Quaternion());
  const footLevel = [bone('LeftFoot'), bone('RightFoot')].map((foot) => foot.getWorldQuaternion(new Quaternion()));
  // Artist-authored bind rotations contain the joints' twist. World-space deltas preserve that twist.
  const a = V();
  const b = V();
  const c = V();
  const direction = V();
  const desired = V();
  const bend = V();
  const middle = V();
  const q = new Quaternion();
  const world = new Quaternion();
  const parent = new Quaternion();
  const delta = new Quaternion();
  const rootOrientation = new Quaternion();
  const rootScale = V();
  const basis = new Matrix4();

  const setWorldRotation = (joint: Bone, rotation: Quaternion) => {
    if (joint.parent) joint.parent.getWorldQuaternion(parent).invert();
    else parent.identity();
    joint.quaternion.copy(parent).multiply(rotation);
    joint.updateWorldMatrix(false, true);
  };
  const rotateWorld = (joint: Bone, axis: Vector3, angle: number) => {
    joint.getWorldQuaternion(world);
    delta.setFromAxisAngle(axis, angle).multiply(world);
    setWorldRotation(joint, delta);
  };
  rotateWorld(bone('Spine'), Z, -0.64);
  rotateWorld(bone('Spine1'), Z, -0.15);
  rotateWorld(bone('Spine2'), Z, -0.1);
  // Look along the road instead of looking down with the torso.
  delta.setFromAxisAngle(Z, -0.1).multiply(headLevel);
  setWorldRotation(head, delta);
  hips.getWorldPosition(a);
  model.position.add(V(-0.25, 0.87, 0).sub(a));
  root.updateMatrixWorld(true);

  interface Chain { upper: Bone; lower: Bone; end: Bone; length1: number; length2: number }
  const chain = (upper: string, lower: string, end: string): Chain => {
    const u = bone(upper);
    const l = bone(lower);
    const e = bone(end);
    u.getWorldPosition(a);
    l.getWorldPosition(b);
    e.getWorldPosition(c);
    return { upper: u, lower: l, end: e, length1: a.distanceTo(b), length2: b.distanceTo(c) };
  };
  const aim = (joint: Bone, child: Bone, target: Vector3) => {
    joint.getWorldPosition(a);
    child.getWorldPosition(b);
    direction.subVectors(b, a).normalize();
    desired.subVectors(target, a).normalize();
    joint.getWorldQuaternion(world);
    delta.setFromUnitVectors(direction, desired).multiply(world);
    setWorldRotation(joint, delta);
  };
  const solve = (limb: Chain, target: Vector3, pole: Vector3) => {
    limb.upper.getWorldPosition(a);
    direction.subVectors(target, a);
    const reach = Math.min(limb.length1 + limb.length2 - 0.00001,
      Math.max(Math.abs(limb.length1 - limb.length2) + 0.00001, direction.length()));
    direction.normalize();
    bend.subVectors(pole, a).addScaledVector(direction, -bend.dot(direction)).normalize();
    const along = (limb.length1 * limb.length1 + reach * reach - limb.length2 * limb.length2) / (2 * reach);
    const outward = Math.sqrt(Math.max(0, limb.length1 * limb.length1 - along * along));
    middle.copy(a).addScaledVector(direction, along).addScaledVector(bend, outward);
    aim(limb.upper, limb.lower, middle);
    aim(limb.lower, limb.end, target);
  };
  const anchor = (joint: Bone, name: string, local: Vector3) => {
    const node = new Group();
    node.name = name;
    node.position.copy(local);
    joint.add(node);
    return node;
  };
  const pivot = options.swingarmPivot ?? SWINGARM_PIVOT;
  const feet = [chain('LeftUpLeg', 'LeftLeg', 'LeftFoot'), chain('RightUpLeg', 'RightLeg', 'RightFoot')];
  for (let i = 0; i < feet.length; i++) {
    const side = i === 0 ? -1 : 1;
    const leg = feet[i]!;
    const footRotation = footLevel[i]!;
    const contact = V(pivot[0] - 0.115, pivot[2] - 0.03, side * 0.2);
    const soleOffset = V(0.055, -0.085, 0);
    const ankle = contact.clone().sub(soleOffset);
    const pole = V(0.07, 0.63, side * 0.25);
    solve(leg, ankle, pole);
    setWorldRotation(leg.end, footRotation);
    leg.end.getWorldScale(rootScale);
    q.copy(footRotation).invert();
    const local = soleOffset.clone().applyQuaternion(q).divide(rootScale);
    anchor(leg.end, `rider:${side < 0 ? 'left' : 'right'}-foot`, local);
  }

  // Close the actual finger joints around the grips, retaining the imported palm/finger anatomy.
  for (const side of ['Left', 'Right']) {
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
      for (let segment = 1; segment <= 3; segment++) {
        const joint = bone(`${side}Hand${finger}${segment}`);
        joint.rotateZ(segment === 1 ? -0.5 : -0.8);
      }
    }
    for (let segment = 1; segment <= 3; segment++) bone(`${side}HandThumb${segment}`).rotateZ(-0.55);
  }
  root.updateMatrixWorld(true);
  const arms = [chain('LeftArm', 'LeftForeArm', 'LeftHand'), chain('RightArm', 'RightForeArm', 'RightHand')];
  const armRest = arms.map((arm) => [arm.upper.quaternion.clone(), arm.lower.quaternion.clone(), arm.end.quaternion.clone()]);
  const handNodes = arms.map((arm, i) => anchor(arm.end, `rider:${i === 0 ? 'left' : 'right'}-hand`, V(0, 4.2, 0)));
  const handScales = arms.map((arm) => arm.end.getWorldScale(V()).y);
  const defaultHead = options.steeringHead ?? steeringPoints(FORK_RAKE, FORK_OFFSET, HEAD_ABOVE_AXLE).head;
  const halfWidth = Math.max(0.1, (options.tyreWidth ?? 0.12) / 2 + 0.045);
  const steeringHead = V();
  const steeringAxis = V();
  const forward = V();
  const down = V();
  const grip = V();
  const gripDirection = V();
  const palmX = V();
  const palmY = V();
  const palmZ = V();
  const wrist = V();
  const pole = V();
  const palmOffset = V();
  const steeringRotation = new Quaternion();
  const handRotation = new Quaternion();
  let disposed = false;

  const update = (steer: number, front?: RiderFrontGeometry) => {
    if (disposed) return;
    const rake = front?.rake ?? options.rake ?? FORK_RAKE;
    const offset = front?.offset ?? options.forkOffset ?? FORK_OFFSET;
    const h = front?.steeringHead ?? defaultHead;
    steeringHead.set(h[0], h[2], -h[1]);
    steeringAxis.set(-Math.sin(rake), Math.cos(rake), 0);
    down.copy(steeringAxis).negate();
    forward.set(Math.cos(rake), Math.sin(rake), 0);
    steeringRotation.setFromAxisAngle(steeringAxis, steer);
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i]!;
      const rest = armRest[i]!;
      arm.upper.quaternion.copy(rest[0]!);
      arm.lower.quaternion.copy(rest[1]!);
      arm.end.quaternion.copy(rest[2]!);
    }
    // The vehicle parent has just moved: update its world pose before converting bike-local targets.
    root.updateWorldMatrix(true, true);
    root.getWorldQuaternion(rootOrientation);
    for (let i = 0; i < arms.length; i++) {
      const side = i === 0 ? -1 : 1;
      const arm = arms[i]!;
      gripDirection.set(-0.13, -0.035, side * 0.22).normalize();
      grip.copy(steeringHead).addScaledVector(down, 0.03).addScaledVector(forward, offset);
      grip.z += side * (halfWidth + 0.03);
      grip.x -= 0.13;
      grip.y -= 0.035;
      grip.z += side * 0.22;
      grip.addScaledVector(gripDirection, -0.0625);
      grip.sub(steeringHead).applyQuaternion(steeringRotation).add(steeringHead);
      gripDirection.applyQuaternion(steeringRotation);
      // Palm faces down and the fingers close forwards around the bar; mirrored thumbs point inward.
      palmZ.copy(gripDirection).multiplyScalar(side);
      palmY.set(1, -0.2, 0).addScaledVector(palmZ, -palmY.dot(palmZ)).normalize();
      palmX.crossVectors(palmY, palmZ).normalize();
      palmY.crossVectors(palmZ, palmX).normalize();
      basis.makeBasis(palmX, palmY, palmZ);
      handRotation.setFromRotationMatrix(basis).premultiply(rootOrientation);
      root.localToWorld(grip);
      palmOffset.copy(handNodes[i]!.position).multiplyScalar(handScales[i]!).applyQuaternion(handRotation);
      wrist.copy(grip).sub(palmOffset);
      pole.set(0.02, 1.02, side * 0.33);
      root.localToWorld(pole);
      solve(arm, wrist, pole);
      setWorldRotation(arm.end, handRotation);
    }
    root.updateWorldMatrix(false, true);
    for (const skeleton of skeletons) skeleton.update();
  };
  update(0);
  const helmet = createRiderHelmet(head, meshes, root);
  meshes.push(...helmet.meshes);
  for (const material of helmet.materials) materials.add(material);
  root.updateMatrixWorld(true);
  for (const mesh of meshes) {
    if (!(mesh as SkinnedMesh).isSkinnedMesh) continue;
    (mesh as SkinnedMesh).computeBoundingBox();
    (mesh as SkinnedMesh).computeBoundingSphere();
  }

  return {
    root, meshes, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      const geometry = new Set(meshes.map((mesh) => mesh.geometry));
      const textures = new Set<Texture>();
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      }
      for (const item of geometry) item.dispose();
      for (const item of materials) item.dispose();
      const bitmaps = new Set<ImageBitmap>();
      for (const texture of textures) {
        const image = texture.source.data;
        if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) bitmaps.add(image);
        texture.dispose();
      }
      // Texture disposal releases the GPU allocation; GLTFLoader's decoded images need closing too.
      for (const bitmap of bitmaps) bitmap.close();
      for (const skeleton of skeletons) skeleton.dispose();
    },
  };
}
