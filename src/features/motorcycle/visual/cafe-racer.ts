/**
 * `cafe-racer` VehicleVisual: a procedural Thruxton-style cafe racer with an imported, textured human rider.
 * Body (frame, parallel-twin engine, sculpted tank with knee cut-outs, seat and hump, exhausts, rear-sets) is
 * rigid with the sprung body and posed from bodyPosition/bodyRotation: the sim leans the body about the vehicle-frame
 * origin on the ground, i.e. about the contact line. Wheels are posed from wheelPosition/wheelRotation and spun by
 * CornerFrame.spin; the chain runs follow the rear sprocket. The front end (fork, yokes, bars, headlight) and all
 * suspension parts belong to the `moto-planar` suspension visual.
 * The rider sits on the sprung body; skeletal arms keep both hands on the steered clip-ons.
 *
 * Draw calls: paint, body palette, x-ray ghost (hidden when off), 2 wheels, 2 chain runs, batched rider materials.
 * Coordinates: authored in three.js vehicle space (x fwd, y up, z = right = -sim y), metres.
 */
import { BoxGeometry, Group, Matrix4, Mesh, Quaternion, Shape, Vector2, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import type { VehicleVisual, VehicleVisualDefinition } from '../../../contracts/services';
import type { TelemetryFrame } from '../../../contracts/telemetry';
import { simQuatToThree, simToThree, type Vec3 } from '../../../contracts/units';
import type { MotorcycleDefinition } from '../../../contracts/vehicle';
import { bakedDisc, bakedTube, mergeParts } from '../../../kit3d/tube';
import { FORK_OFFSET, FORK_RAKE, HEAD_ABOVE_AXLE, steeringPoints, SWINGARM_PIVOT } from '../../../sim-core/content/cafe-racer';
import { motoClassic } from '../../../sim-core/content/moto-classic';
import { motoModern } from '../../../sim-core/content/moto-modern';
import { motoTelelever } from '../../../sim-core/content/moto-telelever';
import { createMotoPalette, disposeMotoPalette, motoPaint, type MotoFinish } from './palette';
import { createRider, type RiderVisual } from './rider';
import { loadRiggedRider } from './rigged-rider';
import { addDither, createGhostMaterial, createPaintMaterial, type PaintSpec } from './shaders';
import {
  basis,
  bentTube,
  curve,
  ellipse,
  endRound,
  finStack,
  lathe,
  loft,
  outward,
  rod,
  roundedRect,
  se,
  roundedPoly,
  slab,
  spokedWheel,
  sprocketGeometry,
  taperedTube,
  twinBarrel,
  yToZ,
} from './shapes';

export const CAFE_RACER_VISUAL_ID = 'cafe-racer';

/** Chain line (three z; left side = sim +y). Shared with the suspension visual's sprocket side. */
export const CHAIN_Z = -0.105;

/** Default paint: deep oxblood metallic with twin ivory stripes and gold pinstripes. */
export const DEFAULT_PAINT: PaintSpec = {
  color: 0x7c0b16,
  stripe: 0xe9e3d4,
  pinstripe: 0xb8913f,
  stripeWidth: 0.018,
  stripeGap: 0.011,
  stripeFrom: 0.84,
};

export interface CafeRacerOptions {
  /** Loaded human model; production always supplies this through the async visual loader. */
  readonly rider?: RiderVisual;
  /** Frame hardpoints (sim vehicle frame). Pass the default suspension's values so the head tube lines up. */
  readonly steeringHead?: Vec3;
  readonly rake?: number;
  readonly forkOffset?: number;
  readonly swingarmPivot?: Vec3;
  readonly paint?: PaintSpec;
}

export interface CafeRacerVisual extends VehicleVisual {
  /** Debug/test: draw-call meshes and the wheel hubs. */
  inspect(): { meshes: readonly Mesh[]; hubs: { readonly f: Group; readonly r: Group } };
}

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const RIDER_FRONTS = new Map([motoClassic, motoModern, motoTelelever].map((preset) => [preset.id, preset.front]));

/** Rim (bead-seat) radius for a tyre: 17 in, or 18 in when the sidewall would be tall. */
function rimRadius(tyreRadius: number): number {
  return tyreRadius - 0.2159 > 0.105 ? 0.2286 : 0.2159;
}

export function buildCafeRacer(vehicle: MotorcycleDefinition, options: CafeRacerOptions = {}): CafeRacerVisual {
  const xf = vehicle.cgToFront;
  const xr = -(vehicle.wheelbase - vehicle.cgToFront);
  const Rf = vehicle.front.tyre.radius;
  const Rr = vehicle.rear.tyre.radius;
  // Frame hardpoints default to the cafe-racer content's shared frame geometry (all presets use one frame).
  const sh = options.steeringHead ?? steeringPoints(FORK_RAKE, FORK_OFFSET, HEAD_ABOVE_AXLE).head;
  const pv = options.swingarmPivot ?? SWINGARM_PIVOT;
  const rake = options.rake ?? FORK_RAKE;
  const H = V(sh[0], sh[2]);
  const P = V(pv[0], pv[2]);
  const axisDown = V(Math.sin(rake), -Math.cos(rake));
  const Hb = H.clone().addScaledVector(axisDown, 0.17);
  const [sx, sy] = vehicle.chain.sprocketCentre;

  const palette: BufferGeometry[] = [];
  // Bodywork (seat, hump pad, tail, battery box, badges): ghosted by x-ray with the paint. Frame, engine, exhausts
  // stay solid, so a naked bike's x-ray only clears what hides the shock, never the machine itself.
  const bodywork: BufferGeometry[] = [];
  const paintParts: BufferGeometry[] = [];
  const pal = (g: BufferGeometry, finish: MotoFinish) => palette.push(motoPaint(g.index ? g.toNonIndexed() : g, finish));
  const bw = (g: BufferGeometry, finish: MotoFinish) => bodywork.push(motoPaint(g.index ? g.toNonIndexed() : g, finish));
  const both = (make: (side: 1 | -1) => void) => {
    make(1);
    make(-1);
  };

  // ------------------------------------------------------------------ frame (gloss black twin cradle)
  const fr = 0.016;
  both((s) => {
    const z = (v: number) => s * v;
    pal(bentTube([V(H.x - 0.03, H.y - 0.035, z(0.03)), V(H.x - 0.16, H.y - 0.1, z(0.075)), V(0.0, 0.775, z(0.1)), V(-0.2, 0.752, z(0.105)), V(-0.5, 0.735, z(0.105)), V(-0.8, 0.752, z(0.085)), V(-0.845, 0.762, z(0.05))], fr, 48, 10), 'frame');
    pal(bentTube([V(Hb.x - 0.03, Hb.y + 0.03, z(0.03)), V(Hb.x - 0.05, Hb.y - 0.08, z(0.06)), V(0.33, 0.36, z(0.085)), V(0.3, 0.2, z(0.09)), V(0.2, 0.135, z(0.095)), V(0.0, 0.128, z(0.1)), V(-0.11, 0.15, z(0.1)), V(P.x + 0.005, P.y - 0.08, z(0.105))], fr, 48, 10), 'frame');
    pal(bentTube([V(P.x + 0.005, P.y - 0.09, z(0.105)), V(P.x - 0.012, P.y + 0.12, z(0.108)), V(-0.19, 0.66, z(0.106)), V(-0.205, 0.752, z(0.105))], fr, 24, 10), 'frame');
    pal(bentTube([V(P.x - 0.02, P.y + 0.12, z(0.11)), V(-0.4, 0.62, z(0.11)), V(-0.6, 0.738, z(0.104))], fr * 0.85, 24, 10), 'frame');
    // Swingarm pivot plate (forged alloy) and its bolt boss.
    pal(slab(roundedRect(0.1, 0.19, 0.045), 0.012, 0.003, basis(V(P.x + 0.012, P.y - 0.02, z(0.138)), V(1, 0, 0), V(0, 0, 1)), 'alloy', 'polished'), 'alloy');
    // Rear-set hanger, peg and lever.
    const peg = V(P.x - 0.115, P.y - 0.03, z(0.17));
    pal(slab(roundedPoly([[P.x + 0.02, P.y + 0.03], [P.x - 0.02, P.y - 0.045], [peg.x - 0.012, peg.y - 0.016], [peg.x - 0.02, peg.y + 0.018]], 0.014), 0.009, 0.002, new Matrix4().makeTranslation(0, 0, z(0.15)), 'alloy', 'polished'), 'alloy');
    pal(rod(V(peg.x, peg.y, z(0.13)), V(peg.x, peg.y, z(0.25)), 0.011, 'alloy', 0.011, 16), 'alloy');
    for (let k = 0; k < 6; k++) pal(bakedDisc(V(peg.x, peg.y, z(0.165 + k * 0.014)), V(0, 0, 1), 0.0125, 0.004, 16), 'black');
    pal(rod(V(peg.x + 0.005, peg.y - 0.005, z(0.152)), V(peg.x + 0.17, peg.y - 0.03, z(0.152)), 0.006, 'alloy'), 'alloy');
    pal(rod(V(peg.x + 0.17, peg.y - 0.03, z(0.14)), V(peg.x + 0.17, peg.y - 0.03, z(0.175)), 0.007, 'black'), 'black');
  });
  // Cross tubes: behind the head, under the seat, tail loop.
  pal(bakedTube(V(H.x - 0.14, H.y - 0.09, 0.07), V(H.x - 0.14, H.y - 0.09, -0.07), fr, fr, 12), 'frame');
  pal(bakedTube(V(-0.42, 0.742, 0.105), V(-0.42, 0.742, -0.105), fr * 0.85, fr * 0.85, 12), 'frame');
  pal(bakedTube(V(-0.845, 0.762, 0.05), V(-0.845, 0.762, -0.05), fr * 0.85, fr * 0.85, 12), 'frame');
  pal(bakedTube(V(P.x + 0.005, P.y + 0.12, 0.108), V(P.x + 0.005, P.y + 0.12, -0.108), fr, fr, 12), 'frame');
  // Head-stock gusset where the rails meet the head tube.
  pal(slab(roundedRect(0.09, 0.05, 0.02), 0.05, 0.008, basis(V(H.x - 0.05, H.y - 0.075, 0), V(1, -0.35, 0), V(0, 0, 1)), 'frame'), 'frame');

  // ------------------------------------------------------------------ engine (air-cooled parallel twin)
  // Crankcase: a lofted casting, rounded-box section (superellipse), swelling at the crank and the gearbox, so the
  // cases catch the light as volumes instead of reading as one flat black side.
  const caseF = 0.3;
  const caseB = P.x + 0.03;
  const cTop = curve([[0, 0.405], [0.08, 0.452], [0.25, 0.472], [0.55, 0.466], [0.8, 0.478], [1, 0.445]]);
  const cBot = curve([[0, 0.29], [0.1, 0.19], [0.28, 0.156], [0.6, 0.15], [0.85, 0.165], [1, 0.235]]);
  const cW = curve([[0, 0.11], [0.2, 0.127], [0.5, 0.126], [0.8, 0.129], [1, 0.112]]);
  const caseSurface = (s: number, t: number, out: Vector3) => {
    const e = endRound(s, 0.07) * endRound(1 - s, 0.06);
    const top = cTop(s);
    const bot = cBot(s);
    const sn = Math.sin(t);
    out.set(caseF - (caseF - caseB) * s, (top + bot) / 2 + ((top - bot) / 2) * se(sn, 5) * Math.max(0.3, e), cW(s) * se(Math.cos(t), 5) * e);
  };
  pal(outward(loft(40, 36, caseSurface)), 'engine');
  // Finned sump under the crank: cast-alloy ribs catch a highlight below the dark cases.
  for (let k = 0; k < 5; k++) pal(slab(roundedRect(0.2, 0.026, 0.01), 0.005, 0.0015, new Matrix4().makeTranslation(0.06, 0.15, -0.08 + k * 0.04), 'fin'), 'fin');
  // Brushed covers with polished edges: clutch (right) with a domed pressure-plate boss, a domed alternator cover
  // (left), sprocket cover; a raised parting rib round the cases; bolt heads round every cover.
  pal(slab(roundedPoly([[-0.1, 0.25], [0.11, 0.24], [0.15, 0.33], [0.08, 0.42], [-0.07, 0.43], [-0.12, 0.36]], 0.05), 0.026, 0.01, new Matrix4().makeTranslation(0, 0, 0.138), 'alloy', 'polished'), 'alloy');
  /** Domed cover facing +z (side +1) or -z (side -1), centred at (x, y), base at |z| = z0. */
  const dome = (x: number, y: number, z0: number, side: 1 | -1, r: number, h: number, finish: MotoFinish) => {
    const g = yToZ(lathe([[0, h], [r * 0.35, h * 0.97], [r * 0.65, h * 0.82], [r * 0.88, h * 0.5], [r, h * 0.16], [r, 0]], 40, 0.5));
    if (side < 0) g.rotateY(Math.PI);
    pal(g.translate(x, y, side * z0), finish);
  };
  const bolts = (x: number, y: number, z: number, r: number, n: number, phase = 0) => {
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      const p = V(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
      pal(rod(p, p.clone().setZ(z + Math.sign(z) * 0.007), 0.0055, 'polished', 0.0055, 6), 'polished');
    }
  };
  dome(0.02, 0.335, 0.162, 1, 0.05, 0.022, 'alloy');
  pal(yToZ(lathe([[0.05, 0], [0.054, 0.003], [0.054, 0.007], [0.05, 0.009]], 40, 0.5)).translate(0.02, 0.335, 0.16), 'polished');
  bolts(0.02, 0.335, 0.164, 0.038, 6, 0.3);
  bolts(0.01, 0.335, 0.164, 0.118, 9, 0.1);
  dome(0.165, 0.305, 0.138, -1, 0.09, 0.03, 'alloy');
  pal(yToZ(lathe([[0.09, 0], [0.095, 0.004], [0.095, 0.01], [0.09, 0.013]], 48, 0.5)).rotateY(Math.PI).translate(0.165, 0.305, -0.136), 'polished');
  bolts(0.165, 0.305, -0.164, 0.072, 8, 0.2);
  for (const z of [-0.126, 0.126]) pal(slab(roundedRect(0.33, 0.012, 0.005), 0.008, 0.002, new Matrix4().makeTranslation(0.085, 0.365, z), 'black'), 'black');
  pal(slab(roundedRect(0.14, 0.11, 0.045), 0.02, 0.008, new Matrix4().makeTranslation(sx + 0.035, sy + 0.005, -0.142), 'alloy', 'polished'), 'alloy');
  pal(yToZ(sprocketGeometry(vehicle.chain.frontRadius, 0)).translate(sx, sy, CHAIN_Z), 'steel');
  // Cylinder block, head and cam cover on an axis tilted forward.
  const tilt = (8 * Math.PI) / 180;
  const cyl = new Matrix4().makeRotationZ(-tilt).setPosition(0.105, 0.462, 0);
  // Two barrels in one finned block (twin-lobed fins with a filleted waist), a deeper-finned head, a twin-dome cam
  // cover with a polished parting line, and spark-plug caps on top of each bore.
  const block = finStack(13, 0.0, 0.2, { depth: 0.165, width: 0.29, thickness: 0.0052 }, { depth: 0.11, width: 0.23 }, 0.16, 'engine', 'fin', twinBarrel);
  const head = finStack(5, 0.205, 0.278, { depth: 0.2, width: 0.31, thickness: 0.0062 }, { depth: 0.15, width: 0.262 }, 0, 'engine', 'fin', twinBarrel);
  const cam = slab(twinBarrel(0.27, 0.15), 0.034, 0.016, new Matrix4().makeBasis(V(0, 0, 1), V(1, 0, 0), V(0, 1, 0)).setPosition(0, 0.282, 0), 'engine', 'fin');
  const camLine = slab(twinBarrel(0.276, 0.156), 0.004, 0, new Matrix4().makeBasis(V(0, 0, 1), V(1, 0, 0), V(0, 1, 0)).setPosition(0, 0.282, 0), 'polished');
  for (const g of [block, head, cam]) pal(g.applyMatrix4(cyl), 'engine');
  pal(camLine.applyMatrix4(cyl), 'polished');
  for (const z of [-0.057, 0.057]) {
    pal(rod(V(0.072, 0.0, z).applyMatrix4(cyl).setY(0.462 + 0.33), V(0.07, 0.0, z).applyMatrix4(cyl).setY(0.462 + 0.36), 0.011, 'black', 0.009, 10), 'black');
  }
  const local = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(cyl);
  both((s) => {
    // Faux carburettor throttle bodies behind the head.
    const a = local(-0.085, 0.24, s * 0.07);
    const b = local(-0.2, 0.228, s * 0.074);
    pal(rod(a, b, 0.03, 'alloy', 0.034, 18), 'alloy');
    pal(rod(b, local(-0.225, 0.225, s * 0.075), 0.041, 'polished', 0.041, 20), 'polished');
    pal(rod(local(-0.225, 0.225, s * 0.075), local(-0.24, 0.223, s * 0.075), 0.036, 'black', 0.03, 20), 'black');
    pal(rod(local(-0.14, 0.262, s * 0.072), local(-0.14, 0.3, s * 0.072), 0.016, 'alloy'), 'alloy');
  });

  // ------------------------------------------------------------------ exhausts (2-into-2, upswept peashooters)
  both((s) => {
    const z = (v: number) => s * v;
    const port = local(0.1, 0.235, z(0.07));
    const header = [port, local(0.13, 0.2, z(0.074)), V(0.305, 0.5, z(0.1)), V(0.315, 0.33, z(0.12)), V(0.27, 0.2, z(0.14)), V(0.15, 0.158, z(0.155)), V(-0.05, 0.168, z(0.18)), V(-0.18, 0.212, z(0.205)), V(-0.28, 0.236, z(0.215))];
    pal(bentTube(header, 0.021, 72, 12), 'chrome');
    pal(rod(port, local(0.125, 0.226, z(0.072)), 0.027, 'heat', 0.027, 16), 'heat');
    const a = V(-0.3, 0.24, z(0.217));
    const b = V(-0.87, 0.365, z(0.217));
    pal(taperedTube([a, a.clone().lerp(b, 0.5), b], 0.034, 0.05, 24, 24), 'chrome');
    const dir = b.clone().sub(a).normalize();
    pal(rod(a.clone().addScaledVector(dir, -0.03), a.clone().addScaledVector(dir, 0.04), 0.038, 'polished', 0.038, 20), 'polished');
    pal(rod(b.clone().addScaledVector(dir, -0.012), b.clone().addScaledVector(dir, 0.004), 0.053, 'polished', 0.053, 24), 'polished');
    pal(rod(b.clone().addScaledVector(dir, 0.002), b.clone().addScaledVector(dir, 0.005), 0.044, 'black', 0.044, 24), 'black');
    // Silencer hanger to the rear-set plate.
    pal(rod(V(-0.42, 0.27, z(0.2)), V(P.x - 0.11, P.y - 0.02, z(0.165)), 0.006, 'black'), 'black');
  });

  // ------------------------------------------------------------------ tank (sculpted, knee cut-outs)
  const tankF = H.x - 0.035;
  const tankB = -0.2;
  const tTop = curve([[0, 0.962], [0.18, 1.005], [0.45, 1.0], [0.75, 0.955], [1, 0.872]]);
  const tBot = curve([[0, 0.79], [0.5, 0.768], [1, 0.795]]);
  const tW = curve([[0, 0.125], [0.25, 0.16], [0.5, 0.168], [0.78, 0.15], [1, 0.105]]);
  const tankSurface = (s: number, t: number, out: Vector3) => {
    // Blunt in side view (height rounds off over a short span), rounded in plan (width over a longer one).
    const eh = endRound(s, 0.035) * endRound(1 - s, 0.05);
    const ew = endRound(s, 0.14) * endRound(1 - s, 0.11);
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const top = tTop(s);
    const bot = tBot(s);
    const mid = (top + bot) / 2;
    const hh = (top - bot) / 2;
    const ey = se(sn, sn > 0 ? 2.5 : 4);
    const ex = se(c, 2.7);
    let w = tW(s) * (1 - 0.14 * Math.max(0, -ey));
    // Knee cut-outs: a soft dish low on the rear flanks.
    const bump = (u: number) => (Math.abs(u) < 1 ? (1 - u * u) * (1 - u * u) : 0);
    w -= 0.026 * bump((s - 0.76) / 0.2) * bump((ey + 0.15) / 0.6);
    out.set(tankF - (tankF - tankB) * s, mid + hh * ey * eh, w * ex * ew);
  };
  paintParts.push(loft(64, 48, tankSurface));
  // Monza flip cap and its hinge.
  const capS = 0.3;
  const capTop = tTop(capS);
  const capX = tankF - (tankF - tankB) * capS;
  bw(lathe([[0, 0.012], [0.04, 0.012], [0.046, 0.006], [0.046, 0], [0.03, -0.006]], 40).translate(capX, capTop + 0.002, 0), 'polished');
  bw(rod(V(capX - 0.05, capTop + 0.004, -0.012), V(capX - 0.05, capTop + 0.004, 0.012), 0.006, 'polished'), 'polished');
  // Tank straps/mount rubber under the rear.
  bw(rod(V(tankB + 0.03, 0.79, 0.07), V(tankB + 0.03, 0.79, -0.07), 0.012, 'black'), 'black');

  // ------------------------------------------------------------------ seat (pleated leather) and hump
  const seatF = -0.17;
  const seatB = -0.585;
  const sTop = curve([[0, 0.8], [0.15, 0.815], [0.55, 0.81], [1, 0.822]]);
  const sW = curve([[0, 0.095], [0.3, 0.126], [1, 0.118]]);
  const seatSurface = (s: number, t: number, out: Vector3) => {
    const e = endRound(s, 0.12) * endRound(1 - s, 0.06);
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const top = sTop(s);
    const bot = 0.732;
    const ey = se(sn, sn > 0 ? 3.2 : 8);
    out.set(seatF - (seatF - seatB) * s, (top + bot) / 2 + ((top - bot) / 2) * ey * e, sW(s) * se(c, 3.2) * e);
  };
  bodywork.push(motoPaint(loft(40, 40, seatSurface).toNonIndexed(), 'leather'));
  both((s) => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const p = V();
      seatSurface(0.04 + (0.92 * i) / 16, s > 0 ? -0.42 : Math.PI + 0.42, p);
      pts.push(p);
    }
    bw(bentTube(pts, 0.0035, 48, 6), 'piping');
  });
  for (let k = 0; k < 7; k++) {
    const sk = 0.22 + k * 0.085;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const p = V();
      seatSurface(sk, Math.PI * (0.15 + (0.7 * i) / 10), p);
      pts.push(p.setY(p.y + 0.0015));
    }
    bw(bentTube(pts, 0.0026, 20, 5), 'leather');
  }
  const humpF = -0.555;
  const humpB = -0.86;
  const hTop = curve([[0, 0.85], [0.12, 0.898], [0.32, 0.908], [0.7, 0.862], [1, 0.8]]);
  const hBot = curve([[0, 0.73], [1, 0.762]]);
  const hW = curve([[0, 0.118], [0.3, 0.112], [1, 0.064]]);
  paintParts.push(
    loft(40, 40, (s, t, out) => {
      const e = endRound(s, 0.05) * endRound(1 - s, 0.28);
      const sn = Math.sin(t);
      const ey = se(sn, sn > 0 ? 2.6 : 5);
      const top = hTop(s);
      const bot = hBot(s);
      out.set(humpF - (humpF - humpB) * s, (top + bot) / 2 + ((top - bot) / 2) * ey * e, hW(s) * se(Math.cos(t), 2.8) * e);
    }),
  );
  // Leather back pad on the hump's front face.
  bw(slab(roundedRect(0.2, 0.075, 0.03), 0.022, 0.009, new Matrix4().makeRotationY(Math.PI / 2).setPosition(humpF - 0.002, 0.835, 0), 'leather', 'piping'), 'leather');
  // Tail light under the hump, plate hanger.
  bw(slab(ellipse(0.034, 0.019), 0.02, 0.006, new Matrix4().makeRotationY(Math.PI / 2).setPosition(humpB + 0.015, 0.772, 0), 'tail', 'black'), 'tail');
  bw(bentTube([V(-0.83, 0.75, 0), V(-0.89, 0.7, 0), V(-0.93, 0.62, 0)], 0.012, 16, 10), 'black');

  // ------------------------------------------------------------------ side panels, battery box
  both((s) => {
    const panel = roundedPoly([[-0.195, 0.735], [-0.445, 0.735], [-0.36, 0.53], [-0.235, 0.53]], 0.035);
    paintParts.push(stripUv(slab(panel, 0.016, 0.006, new Matrix4().makeTranslation(0, 0, s * 0.122), 'frame')));
    bw(slab(ellipse(0.018, 0.018), 0.006, 0.002, new Matrix4().makeTranslation(-0.3, 0.68, s * 0.131), 'polished'), 'polished');
  });
  bw(slab(roundedRect(0.15, 0.17, 0.04), 0.15, 0.02, new Matrix4().makeTranslation(-0.27, 0.645, 0), 'black'), 'black');

  // ------------------------------------------------------------------ meshes
  const xray = { uXray: { value: 0 } };
  const paintMat = createPaintMaterial(options.paint ?? DEFAULT_PAINT, xray);
  const bodyMat = createMotoPalette('moto-body');
  const bodyworkMat = createMotoPalette('moto-bodywork');
  addDither(bodyworkMat, xray, 'moto-bodywork');
  const wheelMat = createMotoPalette('moto-wheels');
  const ghostMat = createGhostMaterial(xray);
  const materials: Material[] = [paintMat, ghostMat];
  const geometries: BufferGeometry[] = [];

  const root = new Group();
  root.name = `vehicle:${CAFE_RACER_VISUAL_ID}`;
  const body = new Group();
  body.name = 'body';
  root.add(body);
  const meshes: Mesh[] = [];
  const add = (parent: Group, g: BufferGeometry, m: Material, name: string, shadow = true): Mesh => {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    parent.add(mesh);
    meshes.push(mesh);
    if (!geometries.includes(g)) geometries.push(g);
    return mesh;
  };
  const paintGeometry = mergeParts(paintParts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => stripUv(g)));
  const paintMesh = add(body, paintGeometry, paintMat, 'body:paint');
  const bodyMesh = add(body, mergeParts(palette), bodyMat, 'body:palette');
  const bodyworkMesh = add(body, mergeParts(bodywork), bodyworkMat, 'body:bodywork');
  const ghost = add(body, paintGeometry, ghostMat, 'xray-ghost', false);
  ghost.renderOrder = 10;
  ghost.visible = false;
  const shadowCasters = [paintMesh, bodyworkMesh];
  const rider = options.rider ?? createRider({ steeringHead: sh, rake, forkOffset: options.forkOffset ?? FORK_OFFSET, tyreWidth: vehicle.front.tyre.width, swingarmPivot: pv });
  body.add(rider.root);
  meshes.push(...rider.meshes);
  shadowCasters.push(...rider.meshes);
  for (const material of new Set(rider.meshes.flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]))) {
    addDither(material, xray, 'moto-rider');
  }
  const presetRiderGeometry = options.steeringHead === undefined && options.rake === undefined && options.forkOffset === undefined;

  const wheel = (id: 'f' | 'r', tyre: MotorcycleDefinition['front']['tyre'], spokes: number, hubHalf: number, sprocket: boolean) => {
    const hub = new Group();
    hub.name = `hub:${id}`;
    const spin = new Group();
    spin.name = `spin:${id}`;
    hub.add(spin);
    root.add(hub);
    const g = spokedWheel({
      radius: tyre.radius,
      width: tyre.width,
      crown: tyre.crownRadius ?? tyre.width / 2,
      rimRadius: rimRadius(tyre.radius),
      rimWidth: tyre.width * 0.74,
      hubHalf,
      hubRadius: 0.05,
      spokes,
      ...(sprocket ? { sprocket: { z: CHAIN_Z, radius: vehicle.chain.rearRadius } } : {}),
    });
    add(spin, g, wheelMat, `${id}:wheel`);
    hub.position.set(id === 'f' ? xf : xr, tyre.radius, 0);
    return { hub, spin };
  };
  const front = wheel('f', vehicle.front.tyre, 28, 0.05, false);
  const rear = wheel('r', vehicle.rear.tyre, 32, 0.068, true);

  // Chain: a run of links (side plates + rollers) at rest length, stretched per frame along the tangent.
  const chainRest = Math.hypot(xr - sx, Rr - sy);
  const chainRun = (): Mesh => {
    const links: BufferGeometry[] = [];
    const pitch = 0.01588;
    const n = Math.floor(chainRest / pitch);
    for (let i = 0; i < n; i++) {
      const y = (i + 0.5) * pitch;
      for (const zz of [-0.0055, 0.0055]) links.push(motoPaint(new BoxGeometry(0.012, pitch * 0.92, 0.0016).translate(0, y, zz), 'chain'));
      links.push(motoPaint(bakedDisc(V(0, y - pitch / 2, 0), V(0, 0, 1), 0.0045, 0.011, 8), 'steel'));
    }
    const m = add(body, mergeParts(links), bodyMat, 'chain');
    return m;
  };
  const chainTop = chainRun();
  const chainBottom = chainRun();
  updateChain(chainTop, chainBottom, V(sx, sy, CHAIN_Z), V(xr, Rr, CHAIN_Z), vehicle.chain.frontRadius, vehicle.chain.rearRadius, chainRest);

  const _q = new Quaternion();
  const _a = new Vector3();
  const _b = new Vector3();
  const sprocket = V(sx, sy, CHAIN_Z);
  const hubs = { f: front, r: rear } as const;

  return {
    root,
    update(t: TelemetryFrame): void {
      simToThree(t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z, body.position);
      simQuatToThree(t.bodyRotation, body.quaternion);
      rider.update(t.steer, presetRiderGeometry ? RIDER_FRONTS.get(t.suspensionId) : undefined);
      for (let i = 0; i < t.corners.length; i++) {
        const c = t.corners[i]!;
        const w = c.id === 'f' ? front : c.id === 'r' ? rear : undefined;
        if (!w) continue;
        simToThree(c.wheelPosition.x, c.wheelPosition.y, c.wheelPosition.z, w.hub.position);
        simQuatToThree(c.wheelRotation, w.hub.quaternion);
        // Rolling forward is + about the axle (sim +y = three -z).
        w.spin.rotation.z = -c.spin;
      }
      // Rear sprocket centre in the body frame (the chain lives in the body).
      _q.copy(body.quaternion).invert();
      _a.copy(rear.hub.position).sub(body.position).applyQuaternion(_q);
      _b.set(_a.x, _a.y, CHAIN_Z);
      updateChain(chainTop, chainBottom, sprocket, _b, vehicle.chain.frontRadius, vehicle.chain.rearRadius, chainRest);
    },
    setXray(amount: number): void {
      xray.uXray.value = amount;
      ghost.visible = amount > 0.001;
      for (const m of shadowCasters) m.castShadow = amount < 0.5;
    },
    inspect() {
      return { meshes, hubs: { f: hubs.f.hub, r: hubs.r.hub } };
    },
    dispose(): void {
      root.removeFromParent();
      rider.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const m of [bodyMat, bodyworkMat, wheelMat] as MeshStandardMaterial[]) disposeMotoPalette(m);
    },
  };
}

function stripUv(g: BufferGeometry): BufferGeometry {
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

const _d = new Vector3();
const _n = new Vector3();
const _p = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Places the two chain runs on the external tangents of the sprockets (body x–y plane, at z of the chain line).
 * Each run's geometry is authored along +Y at `rest` length; it is stretched to the tangent length. No allocation.
 */
function updateChain(top: Mesh, bottom: Mesh, a: Vector3, b: Vector3, ra: number, rb: number, rest: number): void {
  _d.subVectors(b, a);
  _d.z = 0;
  const L = _d.length();
  if (L < 1e-6) return;
  _d.multiplyScalar(1 / L);
  const k = (ra - rb) / L;
  const q = Math.sqrt(Math.max(0, 1 - k * k));
  placeRun(top, 1, a, b, ra, rb, k, q, rest);
  placeRun(bottom, -1, a, b, ra, rb, k, q, rest);
}

function placeRun(mesh: Mesh, sign: number, a: Vector3, b: Vector3, ra: number, rb: number, k: number, q: number, rest: number): void {
  // Unit normal m with m.d = k: m = k d + sign q d_perp, d_perp the upward perpendicular of d.
  let px = -_d.y;
  let py = _d.x;
  if (py < 0) {
    px = -px;
    py = -py;
  }
  _n.set(k * _d.x + sign * q * px, k * _d.y + sign * q * py, 0);
  mesh.position.set(a.x + ra * _n.x, a.y + ra * _n.y, a.z);
  _p.set(b.x + rb * _n.x - mesh.position.x, b.y + rb * _n.y - mesh.position.y, 0);
  const len = _p.length();
  mesh.quaternion.setFromUnitVectors(UP, _p.multiplyScalar(1 / len));
  mesh.scale.set(1, len / rest, 1);
}

export const cafeRacerVisual: VehicleVisualDefinition = {
  id: CAFE_RACER_VISUAL_ID,
  async load(vehicle, ctx): Promise<VehicleVisual> {
    if (vehicle.class !== 'motorcycle') throw new Error(`${CAFE_RACER_VISUAL_ID}: motorcycle visual, got vehicle class "${vehicle.class}"`);
    const rider = await loadRiggedRider(ctx.assets.url('rider/rocketbox-male'));
    try {
      return buildCafeRacer(vehicle, { rider });
    } catch (error) {
      rider.dispose();
      throw error;
    }
  },
};
