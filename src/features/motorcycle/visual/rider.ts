/** Helmeted road rider, authored in motorcycle body space: +X forward, +Y up, +Z right, metres. */
import { BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3 } from '../../../contracts/units';
import { FORK_OFFSET, FORK_RAKE, HEAD_ABOVE_AXLE, steeringPoints, SWINGARM_PIVOT } from '../../../sim-core/content/cafe-racer';
import { createRiderMaterials } from './rider-materials';

export interface RiderFrontGeometry {
  readonly steeringHead: Vec3;
  readonly rake: number;
  readonly offset: number;
}

export interface RiderOptions {
  readonly steeringHead?: Vec3;
  readonly rake?: number;
  readonly forkOffset?: number;
  readonly tyreWidth?: number;
  readonly swingarmPivot?: Vec3;
}

export interface RiderVisual {
  readonly root: Group;
  readonly meshes: readonly Mesh[];
  /** Follow the same steered grip centres as the suspension visual; no per-frame allocations. */
  update(steer: number, front?: RiderFrontGeometry): void;
  dispose(): void;
}

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const UP = V(0, 1, 0);
const JACKET = 0x2d3338;
const TROUSERS = 0x24272a;
const LEATHER = 0x10151a;
const PANEL = 0x3b4043;
const TRIM = 0x969c9b;
const HELMET = 0xe4e7e5;

/** Vertex colours let clothing, seams, pads and boots share one opaque material and draw. */
function coloured(g: BufferGeometry, hex: number): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  if (!flat.getAttribute('uv')) {
    const positions = flat.getAttribute('position');
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      uv[i * 2] = positions.getZ(i) * 2;
      uv[i * 2 + 1] = positions.getY(i) * 2;
    }
    flat.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
  const colour = new Color(hex);
  const data = new Float32Array(flat.getAttribute('position').count * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = colour.r;
    data[i + 1] = colour.g;
    data[i + 2] = colour.b;
  }
  flat.setAttribute('color', new Float32BufferAttribute(data, 3));
  return flat;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!g) throw new Error('rider: incompatible geometry');
  g.computeBoundingSphere();
  return g;
}

function ellipsoid(at: Vector3, size: Vector3, colour: number, segments = 14): BufferGeometry {
  return coloured(new SphereGeometry(1, segments, 10).scale(size.x, size.y, size.z).translate(at.x, at.y, at.z), colour);
}

function link(a: Vector3, b: Vector3, ra: number, rb: number, colour: number): BufferGeometry {
  const d = b.clone().sub(a);
  const g = new CylinderGeometry(rb, ra, d.length(), 14, 1);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return coloured(g, colour);
}

/** Cross-sections of a clothed body: height, spine x, front depth, back depth, half width. */
type Ring = readonly [number, number, number, number, number];
function section(rings: readonly Ring[], y: number): number[] {
  let i = 0;
  while (i < rings.length - 2 && y > rings[i + 1]![0]) i++;
  const a = rings[i]!;
  const b = rings[i + 1]!;
  const t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
  const h = t * t * (3 - 2 * t);
  return [a[1] + (b[1] - a[1]) * h, a[2] + (b[2] - a[2]) * h, a[3] + (b[3] - a[3]) * h, a[4] + (b[4] - a[4]) * h];
}

/** Tailored rather than spherical silhouette, with a slightly flattened back and continuous shoulder slope. */
function ringLoft(rings: readonly Ring[], colour: number, rows = 24, columns = 20): BufferGeometry {
  const p: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const lo = rings[0]![0];
  const hi = rings[rings.length - 1]![0];
  for (let i = 0; i <= rows; i++) {
    const y = lo + (hi - lo) * i / rows;
    const [x, front, back, width] = section(rings, y) as [number, number, number, number];
    for (let j = 0; j <= columns; j++) {
      const a = j / columns * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const depth = c >= 0 ? front : back;
      p.push(x + Math.sign(c) * Math.pow(Math.abs(c), 0.84) * depth, y, s * width);
      uv.push(j / columns, i / rows);
      if (i < rows && j < columns) {
        const k = i * (columns + 1) + j;
        indices.push(k, k + columns + 1, k + 1, k + 1, k + columns + 1, k + columns + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return coloured(g, colour);
}

/** A rounded, tapered sleeve in a unit bone frame. Small radial modulation reads as cloth at the bends. */
function sleeveProfile(profile: readonly (readonly [number, number])[], colour: number): BufferGeometry {
  const rings: Ring[] = profile.map(([y, radius]) => [y, 0, radius, radius, radius * 0.93]);
  return ringLoft(rings, colour, 16, 12);
}

function seam(points: readonly Vector3[], radius: number, colour: number): BufferGeometry {
  return coloured(new TubeGeometry(new CatmullRomCurve3([...points]), Math.max(8, points.length * 3), radius, 4, false), colour);
}

/** Continuous trouser leg around a bent knee: no separate ball joint or straight cone outline. */
function trouserLeg(points: readonly Vector3[], colour: number): BufferGeometry {
  const path = new CatmullRomCurve3([...points]);
  const rows = 24;
  const columns = 14;
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const at = V();
  const tangent = V();
  const across = V();
  const side = V();
  const radius = [0.09, 0.087, 0.075, 0.061, 0.054, 0.041];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    path.getPoint(t, at);
    path.getTangent(t, tangent).normalize();
    across.set(tangent.y, -tangent.x, 0).normalize();
    side.crossVectors(tangent, across).normalize();
    const q = t * (radius.length - 1);
    const a = Math.min(radius.length - 2, Math.floor(q));
    const r = radius[a]! + (radius[a + 1]! - radius[a]!) * (q - a);
    for (let j = 0; j <= columns; j++) {
      const angle = j / columns * Math.PI * 2;
      const fold = 1 + 0.018 * Math.sin(t * 60 + angle * 3) * Math.exp(-(((t - 0.53) / 0.18) ** 2));
      const c = Math.cos(angle) * r * fold;
      const s = Math.sin(angle) * r * 0.85 * fold;
      positions.push(at.x + across.x * c + side.x * s, at.y + across.y * c + side.y * s, at.z + across.z * c + side.z * s);
      uv.push(j / columns, t * 1.8);
      if (i < rows && j < columns) {
        const k = i * (columns + 1) + j;
        indices.push(k, k + 1, k + columns + 1, k + 1, k + columns + 2, k + columns + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return coloured(g, colour);
}

const HELMET_RINGS: readonly Ring[] = [
  [1.397, 0.038, 0, 0, 0], [1.418, 0.038, 0.119, 0.083, 0.083],
  [1.445, 0.039, 0.157, 0.106, 0.118], [1.49, 0.04, 0.143, 0.124, 0.13],
  [1.55, 0.04, 0.145, 0.133, 0.133], [1.603, 0.037, 0.132, 0.125, 0.119],
  [1.646, 0.032, 0.103, 0.104, 0.091], [1.677, 0.025, 0.052, 0.055, 0.047],
  [1.69, 0.02, 0, 0, 0],
];

/** A visor patch fitted to the actual shell, rather than a floating spherical mask. */
function helmetPatch(centre: Vector3, a0: number, a1: number, b0: number, b1: number, crown: boolean, colour: number): BufferGeometry {
  const columns = 28;
  const rows = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const b = b0 + (b1 - b0) * i / rows;
    for (let j = 0; j <= columns; j++) {
      const a = a0 + (a1 - a0) * j / columns;
      const x = crown ? Math.cos(a) * Math.cos(b) : Math.cos(a);
      const y = crown ? Math.sin(a) * Math.cos(b) : Math.sin(b);
      const z = crown ? Math.sin(b) : Math.sin(a);
      const height = centre.y + 0.14 * y;
      const [sx, front, back, width] = section(HELMET_RINGS, height) as [number, number, number, number];
      positions.push(sx + Math.sign(x) * Math.pow(Math.abs(x), 0.84) * (x >= 0 ? front : back) + 0.002 * x, height, centre.z + width * z + 0.002 * z);
      if (i < rows && j < columns) {
        const k = i * (columns + 1) + j;
        indices.push(k, k + 1, k + columns + 1, k + 1, k + columns + 2, k + columns + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // In the face parameterisation a increases to the right and b upward; the default winding faces inward.
  if (!crown) {
    const index = g.index!;
    for (let i = 0; i < index.count; i += 3) {
      const next = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, next);
    }
    g.computeVertexNormals();
  }
  return coloured(g, colour);
}

interface Arm {
  readonly sleeve: Mesh;
  readonly glove: Mesh;
  readonly hand: Group;
  update(position: Vector3, gripDirection: Vector3): void;
}

/** Two-bone sleeves deform in one draw; the glove is a single separately transformed mesh. */
function arm(side: number, material: MeshStandardMaterial): Arm {
  const shoulder = V(-0.10, 1.32, side * 0.172);
  const parts: BufferGeometry[] = [];
  const ranges: { start: number; count: number; bone: number }[] = [];
  let count = 0;
  const add = (g: BufferGeometry, bone: number) => {
    const n = g.getAttribute('position').count;
    ranges.push({ start: count, count: n, bone });
    count += n;
    parts.push(g);
  };
  add(sleeveProfile([[0, 0.048], [0.08, 0.064], [0.24, 0.065], [0.5, 0.059], [0.8, 0.052], [1, 0.049]], JACKET), 0);
  add(ellipsoid(V(0, 0.08, 0), V(0.065, 0.115, 0.058), JACKET), 0);
  add(ellipsoid(V(), V(0.051, 0.054, 0.048), PANEL), 1);
  add(sleeveProfile([[0, 0.05], [0.12, 0.055], [0.35, 0.05], [0.63, 0.043], [0.88, 0.036], [1, 0.035]], JACKET), 2);
  add(coloured(new CylinderGeometry(0.039, 0.041, 0.13, 16).translate(0, 0.935, 0), LEATHER), 2);
  add(coloured(new CylinderGeometry(0.042, 0.042, 0.013, 16).translate(0, 0.86, 0), TRIM), 2);
  const g = merge(parts);
  const basePosition = (g.getAttribute('position').array as Float32Array).slice();
  const baseNormal = (g.getAttribute('normal').array as Float32Array).slice();
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const sleeve = new Mesh(g, material);
  const name = side < 0 ? 'left' : 'right';
  sleeve.name = `rider:${name}-sleeve`;
  sleeve.frustumCulled = false; // the deformed arm stays within the rider's fixed torso/grip envelope

  const hand = new Group();
  hand.name = `rider:${name}-hand`;
  // Glove wraps around the grip's axis, with a curved thumb beneath it.
  const gloveGeometry = merge([
    ellipsoid(V(), V(0.038, 0.05, 0.031), LEATHER),
    ellipsoid(V(0.024, -0.018, 0), V(0.023, 0.029, 0.025), LEATHER),
    ellipsoid(V(-0.026, 0, 0.002), V(0.01, 0.03, 0.028), PANEL),
    ...[-0.027, -0.009, 0.009, 0.027].map((y) => ellipsoid(V(-0.032, y, 0.006), V(0.008, 0.008, 0.019), PANEL, 10)),
  ]);
  const glove = new Mesh(gloveGeometry, material);
  glove.name = `rider:${name}-glove`;
  hand.add(glove);

  const axis = V();
  const bend = V();
  const elbow = V();
  const delta = V();
  const p = V();
  const n = V();
  const origins = [V(), V(), V()];
  const rotations = [new Quaternion(), new Quaternion(), new Quaternion()];
  const lengths = [1, 1, 1];
  return {
    sleeve, glove, hand,
    update(at, gripDirection) {
      hand.position.copy(at);
      hand.quaternion.setFromUnitVectors(UP, gripDirection);
      axis.subVectors(at, shoulder);
      const distance = Math.max(0.0001, axis.length());
      axis.multiplyScalar(1 / distance);
      // Elbows bend outward, with a small downward component, rather than passing through the fuel tank.
      bend.set(-0.1, -0.75, side * 0.62);
      bend.addScaledVector(axis, -bend.dot(axis)).normalize();
      const half = Math.min(distance / 2, 0.30);
      const height = Math.sqrt(Math.max(0.0004, 0.30 * 0.30 - half * half));
      elbow.copy(shoulder).addScaledVector(axis, distance / 2).addScaledVector(bend, height);
      origins[0]!.copy(shoulder);
      origins[1]!.copy(elbow);
      origins[2]!.copy(elbow);
      delta.subVectors(elbow, shoulder);
      lengths[0] = delta.length();
      rotations[0]!.setFromUnitVectors(UP, delta.normalize());
      rotations[1]!.identity();
      delta.subVectors(at, elbow);
      lengths[2] = delta.length();
      rotations[2]!.setFromUnitVectors(UP, delta.normalize());
      for (const range of ranges) {
        const scale = lengths[range.bone]!;
        const rotation = rotations[range.bone]!;
        const origin = origins[range.bone]!;
        for (let i = range.start; i < range.start + range.count; i++) {
          const k = i * 3;
          p.set(basePosition[k]!, basePosition[k + 1]! * scale, basePosition[k + 2]!).applyQuaternion(rotation).add(origin);
          n.set(baseNormal[k]!, baseNormal[k + 1]! / scale, baseNormal[k + 2]!).applyQuaternion(rotation).normalize();
          position.setXYZ(i, p.x, p.y, p.z);
          normal.setXYZ(i, n.x, n.y, n.z);
        }
      }
      position.needsUpdate = normal.needsUpdate = true;
    },
  };
}

export function createRider(options: RiderOptions = {}): RiderVisual {
  const root = new Group();
  root.name = 'rider';
  const materials = createRiderMaterials();
  const material = materials.clothing;
  const helmetMaterial = materials.helmet;
  const visorMaterial = materials.visor;
  const meshes: Mesh[] = [];
  const mesh = (g: BufferGeometry, m: MeshStandardMaterial, name: string) => {
    const result = new Mesh(g, m);
    result.name = `rider:${name}`;
    root.add(result);
    meshes.push(result);
    return result;
  };
  const clothing: BufferGeometry[] = [];
  clothing.push(ringLoft([
    [0.81, -0.41, 0, 0, 0], [0.835, -0.413, 0.104, 0.128, 0.122],
    [0.88, -0.395, 0.131, 0.137, 0.153], [0.94, -0.365, 0.115, 0.118, 0.145],
    [0.993, -0.345, 0.098, 0.099, 0.133], [1.003, -0.34, 0, 0, 0],
  ], TROUSERS));
  const torso: readonly Ring[] = [
    [0.946, -0.371, 0, 0, 0], [0.959, -0.365, 0.106, 0.113, 0.142],
    [1.025, -0.33, 0.108, 0.115, 0.146], [1.12, -0.265, 0.116, 0.127, 0.171],
    [1.235, -0.175, 0.106, 0.12, 0.19], [1.3, -0.113, 0.086, 0.109, 0.191],
    [1.34, -0.075, 0.075, 0.089, 0.165], [1.375, -0.046, 0.062, 0.072, 0.103],
    [1.405, -0.027, 0.055, 0.064, 0.064], [1.411, -0.025, 0, 0, 0],
  ];
  clothing.push(ringLoft(torso, JACKET));
  clothing.push(link(V(-0.018, 1.374, 0), V(0.019, 1.445, 0), 0.055, 0.049, LEATHER));
  const backAt = (y: number, z: number, offset = 0.002) => {
    const [x, , back, width] = section(torso, y) as [number, number, number, number];
    const q = Math.sqrt(Math.max(0, 1 - (z / width) ** 2));
    return V(x - back * Math.pow(q, 0.84) - offset, y, z);
  };
  for (const side of [-1, 1]) {
    clothing.push(seam([backAt(0.98, side * 0.089), backAt(1.08, side * 0.103), backAt(1.22, side * 0.12), backAt(1.31, side * 0.125)], 0.0015, LEATHER));
    clothing.push(seam([backAt(1.281, side * 0.035), backAt(1.284, side * 0.075), backAt(1.282, side * 0.125)], 0.0024, TRIM));
  }
  clothing.push(seam([backAt(0.984, -0.11), backAt(0.98, 0), backAt(0.984, 0.11)], 0.002, LEATHER));
  const pivot = options.swingarmPivot ?? SWINGARM_PIVOT;
  for (const side of [-1, 1]) {
    const hip = V(-0.37, 0.915, side * 0.12);
    const knee = V(-0.016, 0.64, side * 0.205);
    const ankle = V(pivot[0] - 0.16, pivot[2] + 0.065, side * 0.215);
    clothing.push(trouserLeg([hip, V(-0.21, 0.795, side * 0.173), knee, V(-0.058, 0.563, side * 0.215), ankle], TROUSERS));
    clothing.push(ellipsoid(knee.clone().add(V(0.031, 0.005, side * 0.025)), V(0.038, 0.059, 0.035), PANEL));
    clothing.push(seam([hip.clone().add(V(-0.015, 0, side * 0.066)), V(-0.21, 0.79, side * 0.237), knee.clone().add(V(-0.003, 0.0, side * 0.053)), ankle.clone().add(V(0, 0, side * 0.038))], 0.0015, LEATHER));
    clothing.push(link(ankle.clone().add(V(0, -0.043, 0)), ankle.clone().add(V(0, 0.07, 0)), 0.049, 0.048, LEATHER));
    clothing.push(ellipsoid(ankle.clone().add(V(0.035, 0.018, 0)), V(0.021, 0.063, 0.039), PANEL));
    const sole = V(pivot[0] - 0.16, pivot[2] - 0.028, side * 0.215);
    const boot: readonly Ring[] = [[-0.109, 0, 0, 0, 0], [-0.092, 0, 0.011, 0.054, 0.043], [-0.03, 0, 0.012, 0.071, 0.052], [0.06, 0, 0.011, 0.043, 0.052], [0.13, 0, 0.008, 0.025, 0.044], [0.148, 0, 0, 0, 0]];
    clothing.push(ringLoft(boot, LEATHER, 18, 14).rotateZ(-Math.PI / 2).translate(sole.x, sole.y, sole.z));
    clothing.push(seam([V(sole.x - 0.075, sole.y - 0.009, sole.z + side * 0.045), V(sole.x + 0.03, sole.y - 0.009, sole.z + side * 0.053), V(sole.x + 0.123, sole.y - 0.006, sole.z + side * 0.04)], 0.002, PANEL));
    const foot = new Group();
    foot.name = `rider:${side < 0 ? 'left' : 'right'}-foot`;
    foot.position.set(pivot[0] - 0.115, pivot[2] - 0.03, side * 0.2);
    root.add(foot);
  }
  const head = V(0.04, 1.545, 0);
  // White full-face shell, a forward chin bar, navy crown stripe and a dark, opaque curved visor.
  const helmet = merge([
    ringLoft(HELMET_RINGS, HELMET, 32, 24),
    ...[-1, 1].map((side) => ellipsoid(V(0.06, 1.542, side * 0.131), V(0.022, 0.022, 0.006), PANEL, 16)),
    seam([V(0.161, 1.615, -0.022), V(0.159, 1.622, 0), V(0.161, 1.615, 0.022)], 0.003, LEATHER),
    seam([V(-0.075, 1.61, -0.049), V(-0.085, 1.607, 0), V(-0.075, 1.61, 0.049)], 0.0025, LEATHER),
  ]);
  clothing.push(coloured(new BoxGeometry(0.005, 0.008, 0.068).translate(0.197, 1.447, 0), LEATHER));
  mesh(merge(clothing), material, 'clothing');
  mesh(helmet, helmetMaterial, 'helmet');
  mesh(helmetPatch(head, -1.27, 1.27, -0.16, 0.29, false, 0x14212c), visorMaterial, 'visor');
  const arms = [-1, 1].map((side) => arm(side, material));
  for (const a of arms) {
    root.add(a.sleeve, a.hand);
    meshes.push(a.sleeve, a.glove);
  }
  for (const m of meshes) m.castShadow = m.receiveShadow = true;

  const defaultHead = options.steeringHead ?? steeringPoints(FORK_RAKE, FORK_OFFSET, HEAD_ABOVE_AXLE).head;
  const steeringHead = V(defaultHead[0], defaultHead[2], -defaultHead[1]);
  const axis = V();
  const down = V();
  const forward = V();
  const grip = V();
  const gripDirection = V();
  const rotation = new Quaternion();
  const halfWidth = Math.max(0.1, (options.tyreWidth ?? 0.12) / 2 + 0.045);
  const update = (steer: number, front?: RiderFrontGeometry) => {
    const rake = front?.rake ?? options.rake ?? FORK_RAKE;
    const offset = front?.offset ?? options.forkOffset ?? FORK_OFFSET;
    const h = front?.steeringHead ?? defaultHead;
    steeringHead.set(h[0], h[2], -h[1]);
    axis.set(-Math.sin(rake), Math.cos(rake), 0);
    down.copy(axis).negate();
    forward.set(Math.cos(rake), Math.sin(rake), 0);
    rotation.setFromAxisAngle(axis, steer);
    for (let i = 0; i < arms.length; i++) {
      const side = i === 0 ? -1 : 1;
      gripDirection.set(-0.13, -0.035, side * 0.22).normalize();
      // The grip is the outer 125 mm of the bar; locate the palm at its centre.
      grip.copy(steeringHead).addScaledVector(down, 0.03).addScaledVector(forward, offset);
      grip.z += side * (halfWidth + 0.03);
      grip.x -= 0.13;
      grip.y -= 0.035;
      grip.z += side * 0.22;
      grip.addScaledVector(gripDirection, -0.0625);
      grip.sub(steeringHead).applyQuaternion(rotation).add(steeringHead);
      gripDirection.applyQuaternion(rotation);
      arms[i]!.update(grip, gripDirection);
    }
  };
  update(0);
  return {
    root, meshes, update,
    dispose() {
      root.removeFromParent();
      for (const m of meshes) m.geometry.dispose();
      materials.dispose();
    },
  };
}
