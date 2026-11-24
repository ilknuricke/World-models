/**
 * Trackside props: one InstancedMesh of cones (from `track.props`) and one merged mesh of low section signboards
 * whose faces read the section names from a single canvas atlas. Two draw calls (+ shadow) for all of it.
 */
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import { APRON } from './ribbon';

const CONE_ORANGE = [1, 0.22, 0.02] as const;
const CONE_WHITE = [0.85, 0.85, 0.85] as const;

function coloured(g: BufferGeometry, rgb: readonly [number, number, number]): BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** Traffic cone, 0.5 m, square base; origin on the ground. */
function coneGeometry(): BufferGeometry {
  const base = coloured(new BoxGeometry(0.36, 0.03, 0.36).translate(0, 0.015, 0), CONE_ORANGE);
  const lower = coloured(new CylinderGeometry(0.105, 0.15, 0.2, 16, 1, true).translate(0, 0.13, 0), CONE_ORANGE);
  const band = coloured(new CylinderGeometry(0.075, 0.105, 0.14, 16, 1, true).translate(0, 0.3, 0), CONE_WHITE);
  const tip = coloured(new ConeGeometry(0.075, 0.13, 16, 1, true).translate(0, 0.435, 0), CONE_ORANGE);
  return mergeGeometries([base, lower, band, tip])!;
}

export function createCones(track: BuiltTrack): InstancedMesh | undefined {
  const cones = track.props.filter((p) => p.kind === 'cone');
  if (cones.length === 0) return undefined;
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const mesh = new InstancedMesh(coneGeometry(), material, cones.length);
  mesh.name = 'track-cones';
  const sample: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  const p = { x: 0, y: 0, z: 0 };
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  cones.forEach((c, i) => {
    track.sample(c.s, sample);
    track.toWorld(c.s, c.l, p);
    q.setFromAxisAngle(up, sample.heading);
    m.compose(new Vector3(p.x, p.z, -p.y), q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Atlas: 2 columns x 8 rows of 512 x 128 cells; the last cell is plain board colour for the board body. */
const CELL_W = 512;
const CELL_H = 128;
const COLS = 2;
const ROWS = 8;
const BOARD = { width: 1.6, height: 0.4, depth: 0.06, lift: 0.22, post: 0.04 } as const;
/** Board placement: metres past the section start, distance outside the kerb, yaw towards the road (rad). */
const PLACE = { ahead: 4, outside: APRON / 2, toe: 0.35 } as const;

function drawAtlas(names: readonly string[], fontFamily: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;
  canvas.height = CELL_H * ROWS;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, canvas.width, canvas.height);
  names.forEach((name, i) => {
    const x = (i % COLS) * CELL_W;
    const y = Math.floor(i / COLS) * CELL_H;
    g.fillStyle = '#7cf0d4'; // --accent
    g.fillRect(x + 28, y + 34, 8, CELL_H - 68);
    g.fillStyle = '#edeef0'; // --text-1
    g.font = `600 52px ${fontFamily}`;
    g.textBaseline = 'middle';
    let size = 52;
    while (g.measureText(name.toLocaleUpperCase('tr-TR')).width > CELL_W - 90 && size > 28) g.font = `600 ${(size -= 2)}px ${fontFamily}`;
    g.fillText(name.toLocaleUpperCase('tr-TR'), x + 58, y + CELL_H / 2 + 2);
  });
  return canvas;
}

/** Writes atlas UVs for cell `i` into a face whose uv spans 0..1. */
function toCell(g: BufferGeometry, i: number): BufferGeometry {
  const uv = g.getAttribute('uv') as BufferAttribute;
  const u0 = (i % COLS) / COLS;
  const v0 = 1 - (Math.floor(i / COLS) + 1) / ROWS;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / COLS, v0 + uv.getY(k) / ROWS);
  return g;
}

/** Section signboards on the right-hand apron, facing oncoming cars. Needs a DOM canvas. */
export async function createSignboards(track: BuiltTrack): Promise<Mesh> {
  const names = track.sections.map((s) => s.def.name);
  const fontFamily = '"Geist Sans", system-ui, sans-serif';
  try {
    await document.fonts.load(`600 52px ${fontFamily}`);
  } catch {
    // fall back to the system face
  }
  const map = new CanvasTexture(drawAtlas(names.slice(0, COLS * ROWS - 1), fontFamily));
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const plain = COLS * ROWS - 1;

  const sample: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  const p = { x: 0, y: 0, z: 0 };
  const q = new Quaternion();
  const m = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const parts: BufferGeometry[] = [];
  const l = -(track.def.width / 2 + track.def.kerbWidth + PLACE.outside);
  names.slice(0, plain).forEach((_, i) => {
    const s = track.sections[i]!.s0 + PLACE.ahead;
    track.sample(s, sample);
    track.toWorld(s, l, p);
    // Face +Z of the board points back down the road (heading + pi), toed in towards the track.
    q.setFromAxisAngle(up, sample.heading - Math.PI / 2 - PLACE.toe);
    m.compose(new Vector3(p.x, p.z, -p.y), q, new Vector3(1, 1, 1));
    const top = BOARD.lift + BOARD.height;
    const face = toCell(new PlaneGeometry(BOARD.width, BOARD.height), i).translate(0, BOARD.lift + BOARD.height / 2, BOARD.depth / 2 + 0.001);
    const body = toCell(new BoxGeometry(BOARD.width + 0.04, BOARD.height + 0.04, BOARD.depth), plain).translate(0, BOARD.lift + BOARD.height / 2, 0);
    const postL = toCell(new BoxGeometry(BOARD.post, top, BOARD.post), plain).translate(-BOARD.width / 3, top / 2 - 0.1, 0);
    const postR = toCell(new BoxGeometry(BOARD.post, top, BOARD.post), plain).translate(BOARD.width / 3, top / 2 - 0.1, 0);
    for (const g of [face, body.toNonIndexed(), postL.toNonIndexed(), postR.toNonIndexed()]) parts.push((g.index ? g.toNonIndexed() : g).applyMatrix4(m));
  });
  const mesh = new Mesh(mergeGeometries(parts)!, new MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.1 }));
  mesh.name = 'track-signboards';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
