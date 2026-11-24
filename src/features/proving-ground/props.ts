/**
 * Annex props: one InstancedMesh of traffic cones (a procedural lathe, vertex-coloured orange with a white band, on
 * a square base) and one merged mesh of station signboards whose faces read the station names from a canvas atlas
 * (the track's signboard style: dark board, accent bar, Geist Sans). Heights from the GroundWorld.
 */
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GroundHit, GroundWorld, WorldDefinition } from '../../contracts/world';

const ORANGE = [1, 0.22, 0.02] as const;
const WHITE = [0.86, 0.86, 0.86] as const;
/** Cone profile (radius, height) m: 0.5 m cone, reflective band 0.24-0.36 m. */
const PROFILE = [
  [0.155, 0.03],
  [0.135, 0.12],
  [0.112, 0.24],
  [0.097, 0.3],
  [0.083, 0.36],
  [0.02, 0.495],
  [0, 0.5],
] as const;
const BAND: readonly [number, number] = [0.24, 0.36];

function coloured(g: BufferGeometry, colourAt: (y: number) => readonly [number, number, number]): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const c = new Float32Array(pos.count * 3);
  // one colour per triangle (by its centre height): crisp bands
  for (let i = 0; i < pos.count; i += 3) {
    const rgb = colourAt((pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3);
    for (let k = 0; k < 3; k++) c.set(rgb, (i + k) * 3);
  }
  ng.setAttribute('color', new BufferAttribute(c, 3));
  ng.deleteAttribute('uv');
  return ng;
}

/** Traffic cone, origin on the ground. */
export function coneGeometry(): BufferGeometry {
  const lathe = new LatheGeometry(
    PROFILE.map(([r, y]) => new Vector2(r, y)),
    20,
  );
  const body = coloured(lathe, (y) => (y > BAND[0] && y < BAND[1] ? WHITE : ORANGE));
  const base = coloured(new BoxGeometry(0.38, 0.03, 0.38).translate(0, 0.015, 0), () => ORANGE);
  return mergeGeometries([body, base])!;
}

export function createCones(world: GroundWorld, def: WorldDefinition): InstancedMesh | undefined {
  const cones = def.props.filter((p) => p.kind === 'cone');
  if (cones.length === 0) return undefined;
  const mesh = new InstancedMesh(coneGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), cones.length);
  mesh.name = 'annex-cones';
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  cones.forEach((c, i) => {
    m.compose(new Vector3(c.x, world.sample(c.x, c.y, NaN, hit).h, -c.y), q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Atlas: one column of 1024 x 256 cells; the last cell is plain board colour for the body and posts. */
const CELL_W = 1024;
const CELL_H = 256;
const BOARD = { width: 2.6, height: 0.65, depth: 0.08, lift: 0.75, post: 0.07 } as const;

function drawAtlas(names: readonly string[], fontFamily: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W;
  canvas.height = CELL_H * (names.length + 1);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, canvas.width, canvas.height);
  names.forEach((name, i) => {
    const y = i * CELL_H;
    g.fillStyle = '#7cf0d4'; // --accent
    g.fillRect(56, y + 64, 14, CELL_H - 128);
    g.fillStyle = '#edeef0'; // --text-1
    let size = 104;
    g.font = `600 ${size}px ${fontFamily}`;
    g.textBaseline = 'middle';
    while (g.measureText(name.toLocaleUpperCase('tr-TR')).width > CELL_W - 160 && size > 56) g.font = `600 ${(size -= 4)}px ${fontFamily}`;
    g.fillText(name.toLocaleUpperCase('tr-TR'), 112, y + CELL_H / 2 + 4);
  });
  return canvas;
}

function toCell(g: BufferGeometry, i: number, rows: number): BufferGeometry {
  const uv = g.getAttribute('uv') as BufferAttribute;
  const v0 = 1 - (i + 1) / rows;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), v0 + uv.getY(k) / rows);
  return g.index ? g.toNonIndexed() : g;
}

/** Station signboards (world props `sign`), each facing its prop heading. Needs a DOM canvas. */
export async function createSigns(world: GroundWorld, def: WorldDefinition): Promise<Mesh | undefined> {
  const signs = def.props.filter((p) => p.kind === 'sign');
  if (signs.length === 0) return undefined;
  const names = signs.map((s) => def.stations.find((st) => st.id === s.station)?.name ?? s.station);
  const fontFamily = '"Geist Sans", system-ui, sans-serif';
  try {
    await document.fonts.load(`600 104px ${fontFamily}`);
  } catch {
    // fall back to the system face
  }
  const rows = names.length + 1;
  const map = new CanvasTexture(drawAtlas(names, fontFamily));
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const q = new Quaternion();
  const m = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const parts: BufferGeometry[] = [];
  const top = BOARD.lift + BOARD.height;
  signs.forEach((s, i) => {
    // three +Z of the board -> world direction of `heading`: rotation heading + pi/2 about three Y
    q.setFromAxisAngle(up, s.heading + Math.PI / 2);
    m.compose(new Vector3(s.x, world.sample(s.x, s.y, NaN, hit).h, -s.y), q, new Vector3(1, 1, 1));
    const face = toCell(new PlaneGeometry(BOARD.width, BOARD.height), i, rows).translate(0, BOARD.lift + BOARD.height / 2, BOARD.depth / 2 + 0.002);
    const body = toCell(new BoxGeometry(BOARD.width + 0.06, BOARD.height + 0.06, BOARD.depth), names.length, rows).translate(0, BOARD.lift + BOARD.height / 2, 0);
    const posts = [-1, 1].map((k) =>
      toCell(new BoxGeometry(BOARD.post, top, BOARD.post), names.length, rows).translate((k * BOARD.width) / 3, top / 2 - 0.1, -BOARD.depth / 2 - BOARD.post / 2),
    );
    for (const g of [face, body, ...posts]) parts.push(g.applyMatrix4(m));
  });
  const mesh = new Mesh(mergeGeometries(parts)!, new MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.1 }));
  mesh.name = 'annex-signs';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- 11-05: facility props (restrained, procedural)

type Rgb = readonly [number, number, number];
const POLE_GREY = [0.55, 0.56, 0.57] as const;
const LAMP = [0.85, 0.85, 0.8] as const;
const HUT_WALL = [0.72, 0.71, 0.68] as const;
const HUT_ROOF = [0.22, 0.23, 0.25] as const;
const GLASS = [0.08, 0.1, 0.12] as const;
const BOARD_WHITE = [0.86, 0.86, 0.84] as const;
const BOARD_BLACK = [0.05, 0.05, 0.05] as const;
const TREE = [
  [0.055, 0.085, 0.045],
  [0.075, 0.1, 0.055],
  [0.045, 0.065, 0.04],
] as const;


const tinted = (g: BufferGeometry, rgb: Rgb): BufferGeometry => coloured(g, () => rgb);

/** Light pole, origin on the ground: an 8 m mast, a short arm and a flat lamp head facing the paving (-Z side). */
function poleGeometry(): BufferGeometry {
  const mast = tinted(new BoxGeometry(0.16, 8, 0.16).translate(0, 4, 0), POLE_GREY);
  const arm = tinted(new BoxGeometry(0.08, 0.08, 1.2).translate(0, 7.9, -0.6), POLE_GREY);
  const head = tinted(new BoxGeometry(0.5, 0.14, 0.7).translate(0, 7.84, -1.25), LAMP);
  return mergeGeometries([mast, arm, head])!;
}

/** A tree in the distance: a tall low-poly blob, white (coloured per instance; no trunk: it is seen through fog). */
function treeGeometry(): BufferGeometry {
  return tinted(new SphereGeometry(1, 6, 4).scale(1, 0.8, 1).translate(0, 0.55, 0), [1, 1, 1]);
}

export interface FacilityPlacement {
  /** Paved edges meeting grass: world start/end points and the outward unit normal (x, y). */
  readonly edges: readonly { readonly a: readonly [number, number]; readonly b: readonly [number, number]; readonly n: readonly [number, number]; readonly zone: string }[];
  /** Braking-lane brake-bar positions: world point and the lane direction (unit), half width of the lined lanes. */
  readonly brake: readonly { readonly x: number; readonly y: number; readonly dir: readonly [number, number]; readonly half: number }[];
  /** Control hut position (world) and heading (rad, the door side faces +heading). */
  readonly hut: { readonly x: number; readonly y: number; readonly heading: number } | null;
  /** The field rectangle (treeline beyond it). */
  readonly field: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
}

/**
 * Light poles along the large slabs' grass edges, countdown marker boards before each brake bar, a low control hut,
 * and a sparse treeline round the field (so the grass does not run on for ever). Two instanced meshes and one merged
 * mesh; vertex / instance colours only. Heights from the GroundWorld.
 */
export function createFacility(world: GroundWorld, place: FacilityPlacement): Mesh[] {
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const h = (x: number, y: number) => world.sample(x, y, NaN, hit).h;
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const out: Mesh[] = [];
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });

  // light poles: every 40 m along long grass edges of the big slabs, 4 m out (past the gravel), facing the paving
  const poles: Matrix4[] = [];
  for (const e of place.edges) {
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    if (len < 60) continue;
    const n = Math.floor(len / 40);
    for (let i = 0; i <= n; i++) {
      const t = (len - n * 40) / 2 + i * 40;
      const x = e.a[0] + ((e.b[0] - e.a[0]) * t) / len + e.n[0] * 4;
      const y = e.a[1] + ((e.b[1] - e.a[1]) * t) / len + e.n[1] * 4;
      // three -Z (the lamp side) toward the paving: world direction -n
      q.setFromAxisAngle(up, Math.atan2(e.n[1], e.n[0]) + Math.PI / 2);
      poles.push(new Matrix4().compose(new Vector3(x, h(x, y), -y), q.clone(), new Vector3(1, 1, 1)));
    }
  }
  if (poles.length) {
    const mesh = new InstancedMesh(poleGeometry(), material, poles.length);
    poles.forEach((pm, i) => mesh.setMatrixAt(i, pm));
    mesh.name = 'annex-poles';
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    out.push(mesh);
  }

  // countdown boards (3, 2, 1 stripes) 25 / 50 / 75 m before each brake bar, both sides; and the hut: one merged mesh
  const parts: BufferGeometry[] = [];
  const at = (x: number, y: number, heading: number, g: BufferGeometry) => {
    q.setFromAxisAngle(up, heading + Math.PI / 2);
    m.compose(new Vector3(x, h(x, y), -y), q, new Vector3(1, 1, 1));
    parts.push(g.applyMatrix4(m));
  };
  for (const b of place.brake) {
    const [dx, dy] = b.dir;
    for (const [k, d] of [
      [1, 25],
      [2, 50],
      [3, 75],
    ] as const) {
      for (const side of [1, -1]) {
        const x = b.x - dx * d + -dy * side * (b.half + 3);
        const y = b.y - dy * d + dx * side * (b.half + 3);
        const board: BufferGeometry[] = [
          tinted(new BoxGeometry(0.08, 1.6, 0.08).translate(0, 0.8, -0.05), POLE_GREY),
          tinted(new BoxGeometry(0.7, 1.1, 0.04).translate(0, 1.45, 0), BOARD_WHITE),
        ];
        for (let s = 0; s < k; s++) board.push(tinted(new BoxGeometry(0.7, 0.14, 0.01).translate(0, 1.2 + s * 0.25, 0.025), BOARD_BLACK));
        // the face (+Z) toward the approaching car: world direction -dir
        at(x, y, Math.atan2(-dy, -dx), mergeGeometries(board)!);
      }
    }
  }
  if (place.hut) {
    const { x, y, heading } = place.hut;
    const hut = mergeGeometries([
      tinted(new BoxGeometry(9, 3, 4.5).translate(0, 1.5, 0), HUT_WALL),
      tinted(new BoxGeometry(7.4, 0.9, 0.02).translate(0, 1.9, 2.26), GLASS),
      tinted(new BoxGeometry(10, 0.25, 5.6).translate(0, 3.12, 0.3), HUT_ROOF),
      tinted(new BoxGeometry(0.12, 4, 0.12).translate(3.8, 5.2, -1.5), POLE_GREY),
    ])!;
    at(x, y, heading, hut);
  }
  if (parts.length) {
    const mesh = new Mesh(mergeGeometries(parts)!, material);
    mesh.name = 'annex-facility';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  }

  // treeline: a row of clumps about 135 m beyond the field, only on open grass away from the loop corridor
  const f = place.field;
  if (f) {
    // one instanced mesh per side of the field (frustum culling works per side)
    const sides: [colour: number, matrix: Matrix4][][] = [[], [], [], []];
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) >>> 0;
      seed = (seed + 0x6d2b79f5) >>> 0;
      return seed / 4294967296;
    };
    for (const [margin, step] of [[135, 10]] as const) {
      const x0 = f.minX - margin;
      const x1 = f.maxX + margin;
      const y0 = f.minY - margin;
      const y1 = f.maxY + margin;
      const ring: [number, number, number, number][] = [
        [x0, y1, x1, y1],
        [x1, y1, x1, y0],
        [x1, y0, x0, y0],
        [x0, y0, x0, y1],
      ];
      for (const [side, [ax, ay, bx, by]] of ring.entries()) {
        const len = Math.hypot(bx - ax, by - ay);
        for (let t = 0; t < len; t += step) {
          const j = (rnd() - 0.5) * 14;
          const x = ax + ((bx - ax) * t) / len + (by === ay ? 0 : j);
          const y = ay + ((by - ay) * t) / len + (by === ay ? j : 0);
          world.sample(x, y, NaN, hit);
          if (hit.surface !== 'grass' || hit.s === hit.s) continue; // paving or the loop's corridor
          // a clump: two or three overlapping crowns of different heights (a hedgerow silhouette, not a row of balls)
          const crowns = 2;
          for (let c = 0; c < crowns; c++) {
            const s = 4 + rnd() * 3.5;
            const cx = x + (rnd() - 0.5) * 12;
            const cy = y + (rnd() - 0.5) * 12;
            q.setFromAxisAngle(up, rnd() * Math.PI * 2);
            sides[side]!.push([Math.floor(rnd() * TREE.length), new Matrix4().compose(new Vector3(cx, hit.h - 0.5, -cy), q.clone(), new Vector3(s, s * (1.1 + rnd() * 0.9), s))]);
          }
        }
      }
    }
    // a blob coloured per instance (three's instanceColor x the white vertex colour)
    const blob = treeGeometry();
    const leaves = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    sides.forEach((all, i) => {
      if (all.length === 0) return;
      const mesh = new InstancedMesh(blob, leaves, all.length);
      all.forEach(([k, mm], j) => {
        mesh.setMatrixAt(j, mm);
        mesh.setColorAt(j, new Color(...TREE[k]!));
      });
      mesh.name = `annex-treeline-${i}`;
      mesh.computeBoundingSphere();
      out.push(mesh);
    });
  }
  return out;
}
