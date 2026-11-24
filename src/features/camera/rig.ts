/**
 * Camera rig (research 13 §A3/A4/A6): every source (chase, closeup, explore, director shots) produces a WORLD pose
 * each frame; switches blend from the captured pose to the live target in the CAR FRAME (driving-line point at the
 * frame's lap time, yawed by the path heading), so a blend never lags a fast car and arcs around it, never through it.
 * Pure three.js math, no DOM: unit-tested in node. Allocates only in the constructor.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { DirectorShot, ShotKind } from '../../contracts/services';
import type { PathState, Simulation } from '../../contracts/sim';
import type { ViewMode } from '../../contracts/store';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { GroundHit } from '../../contracts/world';
import { RAD_TO_DEG, simQuatToThree, simToThree, type CornerId } from '../../contracts/units';
import { clamp, damp, dampAngle, smootherstep, wrapAngle } from './damp';
import { dampAngleRamp, dampRamp, MANUAL, manualHeading } from './manual';

export interface Pose {
  readonly pos: Vector3;
  readonly quat: Quaternion;
  /** Vertical FOV, deg. */
  fov: number;
}

export const createPose = (): Pose => ({ pos: new Vector3(), quat: new Quaternion(), fov: 50 });

export function copyPose(from: Pose, to: Pose): Pose {
  to.pos.copy(from.pos);
  to.quat.copy(from.quat);
  to.fov = from.fov;
  return to;
}

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(1, 0, 0);
const lookMatrix = new Matrix4();

/** Writes the orientation of a camera at `eye` looking at `target` (world up). */
export function lookAt(eye: Vector3, target: Vector3, out: Quaternion): Quaternion {
  return out.setFromRotationMatrix(lookMatrix.lookAt(eye, target, UP));
}

/** Blend duration between sources, s (plan: ≤ 1.4 s). */
export const BLEND_S = 1.2;
/** Dip-from-black after a reduced-motion cut, s. */
export const FADE_S = 0.25;
/** Height of the orbit/blend pivot above the road, m (about the car's visual centre). */
export const PIVOT_Y = 0.6;

/** Per-vehicle chase framing: distance, height and FOV from standstill to vMax, and the aim height. */
export interface ChaseFraming {
  readonly dist: readonly [number, number];
  readonly height: readonly [number, number];
  readonly fov: readonly [number, number];
  readonly aimY: number;
}

// Chase tuning (research 13 §A3), all decay rates in 1/s.
export const CHASE = {
  /** Heading lag: reveals the car's flank in corners (lag ≈ yaw rate / lambda). */
  headingLambda: 2.2,
  maxHeadingLag: 0.55,
  dist: [5.4, 6.9] as const,
  height: [1.45, 1.8] as const,
  fov: [45, 54] as const,
  speedLambda: 1.2,
  /** Look-ahead along the known driving line, s, and how far the aim leans toward it. */
  aheadS: 0.6,
  aheadWeight: 0.3,
  lookLambda: 5,
  aimY: 0.7,
  /** Minimum clearance over the road behind the car, m. */
  clearance: 1.0,
} as const;

/** Frame both the motorcycle and its seated rider, keeping the helmet clear of the top edge. */
export const BIKE_CHASE: ChaseFraming = { dist: [3.7, 4.6], height: [1.55, 1.8], fov: [44, 52], aimY: 0.84 };
/** Size of a bike's director shots (orbit, front view) relative to the car's. */
export const BIKE_SHOT_SCALE = 0.62;

/** Hero orbit: start azimuth in the car frame (x forward, z right; negative = left of the nose) and turn rate, rad/s. */
export const ORBIT_START = -0.55;
export const ORBIT_RATE = 0.12;

/** Default FOV per shot kind, deg (DirectorShot.fov overrides). */
const DEFAULT_FOV: Record<ShotKind, number> = { chase: 50, orbit: 38, closeup: 42, trackside: 20, overhead: 34, 'front-view': 30 };

/** Driving-line frame at the current lap time: origin on the road, x along the path heading, y up. */
export class CarFrame {
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  private readonly inv = new Quaternion();
  heading = 0;

  set(path: PathState): void {
    simToThree(path.x, path.y, path.z, this.pos);
    this.setHeading(path.heading);
  }

  /** Origin (three coordinates, already in `pos`) and heading set directly (Manual Drive anchor). */
  setHeading(heading: number): void {
    this.heading = heading;
    // Sim heading is CCW from +X seen from above = rotation about three +Y.
    this.quat.setFromAxisAngle(UP, heading);
    this.inv.copy(this.quat).invert();
  }

  toLocal(world: Pose, out: Pose): Pose {
    out.pos.copy(world.pos).sub(this.pos).applyQuaternion(this.inv);
    out.quat.copy(this.inv).multiply(world.quat);
    out.fov = world.fov;
    return out;
  }

  pointToLocal(world: Vector3, out: Vector3): Vector3 {
    return out.copy(world).sub(this.pos).applyQuaternion(this.inv);
  }

  toWorld(local: Pose, out: Pose): Pose {
    out.pos.copy(local.pos).applyQuaternion(this.quat).add(this.pos);
    out.quat.copy(this.quat).multiply(local.quat);
    out.fov = local.fov;
    return out;
  }
}

/** Spherical blend about `pivot` (all in the car frame): radius, azimuth (shortest way) and elevation interpolate. */
export function blendLocal(from: Pose, to: Pose, e: number, pivot: Vector3, out: Pose): Pose {
  const ax = from.pos.x - pivot.x;
  const ay = from.pos.y - pivot.y;
  const az = from.pos.z - pivot.z;
  const bx = to.pos.x - pivot.x;
  const by = to.pos.y - pivot.y;
  const bz = to.pos.z - pivot.z;
  const ra = Math.hypot(ax, ay, az);
  const rb = Math.hypot(bx, by, bz);
  const r = ra + (rb - ra) * e;
  const thA = Math.atan2(az, ax);
  const th = thA + wrapAngle(Math.atan2(bz, bx) - thA) * e;
  const elA = Math.asin(clamp(ay / (ra || 1), -1, 1));
  const el = elA + (Math.asin(clamp(by / (rb || 1), -1, 1)) - elA) * e;
  out.pos.set(pivot.x + r * Math.cos(el) * Math.cos(th), pivot.y + r * Math.sin(el), pivot.z + r * Math.cos(el) * Math.sin(th));
  out.quat.slerpQuaternions(from.quat, to.quat, e);
  out.fov = from.fov + (to.fov - from.fov) * e;
  return out;
}

/**
 * Spring-free chase: the anchor is the exact driving-line point (smooth, no lag at speed); the offset swings with a
 * damped heading, eases distance/height/FOV with speed, and the aim leans toward the line `aheadS` seconds ahead.
 */
export class Chase {
  framing: ChaseFraming = CHASE;
  heading = 0;
  dist: number = CHASE.dist[0];
  height: number = CHASE.height[0];
  fov: number = CHASE.fov[0];
  readonly look = new Vector3(0, CHASE.aimY, 0);
  private readonly eye = new Vector3();
  private readonly aim = new Vector3();
  private readonly local = createPose();
  /** Targets of the previous stepTo() (ramp smoothing); invalid after an auto step or a reset. */
  private ramp = false;
  private readonly prev = { heading: 0, dist: 0, height: 0, fov: 0 };

  /** Snap every channel to its target (after a seek or on first use). */
  reset(frame: CarFrame, speed01: number, heading = frame.heading): void {
    this.ramp = false;
    this.heading = heading;
    const f = this.framing;
    this.dist = f.dist[0] + (f.dist[1] - f.dist[0]) * speed01;
    this.height = f.height[0] + (f.height[1] - f.height[0]) * speed01;
    this.fov = f.fov[0] + (f.fov[1] - f.fov[0]) * smootherstep(speed01);
    this.look.set(0, f.aimY, 0);
  }

  /** Steps the damped channels by dt. `aheadLocal` is the look-ahead line point in the car frame. */
  step(dt: number, frame: CarFrame, speed01: number, aheadLocal: Vector3): void {
    this.ramp = false;
    this.heading = dampAngle(this.heading, frame.heading, CHASE.headingLambda, dt);
    const lag = wrapAngle(this.heading - frame.heading);
    if (Math.abs(lag) > CHASE.maxHeadingLag) this.heading = frame.heading + Math.sign(lag) * CHASE.maxHeadingLag;
    const f = this.framing;
    this.dist = damp(this.dist, f.dist[0] + (f.dist[1] - f.dist[0]) * speed01, CHASE.speedLambda, dt);
    this.height = damp(this.height, f.height[0] + (f.height[1] - f.height[0]) * speed01, CHASE.speedLambda, dt);
    this.fov = damp(this.fov, f.fov[0] + (f.fov[1] - f.fov[0]) * smootherstep(speed01), CHASE.speedLambda, dt);
    const w = CHASE.aheadWeight;
    const k = 1 - Math.exp(-CHASE.lookLambda * dt);
    this.look.x += (aheadLocal.x * w - this.look.x) * k;
    this.look.y += (f.aimY + aheadLocal.y * w - this.look.y) * k;
    this.look.z += (aheadLocal.z * w - this.look.z) * k;
  }

  /**
   * Outside auto: the same channels follow a predicted `target` heading (research m2/08) with ramp smoothing (no
   * frame-rate dependent lag while the target moves) and a soft lag limit (the follow rate grows with the lag, so a
   * spin never parks the camera beside the car and never hits a hard stop).
   */
  stepTo(dt: number, target: number, speed01: number, aheadLocal: Vector3): void {
    const f = this.framing;
    const dist = f.dist[0] + (f.dist[1] - f.dist[0]) * speed01;
    const height = f.height[0] + (f.height[1] - f.height[0]) * speed01;
    const fov = f.fov[0] + (f.fov[1] - f.fov[0]) * smootherstep(speed01);
    const p = this.prev;
    if (!this.ramp) {
      p.heading = target;
      p.dist = dist;
      p.height = height;
      p.fov = fov;
      this.ramp = true;
    }
    const lag = wrapAngle(this.heading - p.heading) / MANUAL.softLag;
    this.heading = dampAngleRamp(this.heading, p.heading, target, CHASE.headingLambda * (1 + lag * lag), dt);
    const over = wrapAngle(this.heading - target);
    if (Math.abs(over) > MANUAL.hardLag) this.heading = target + Math.sign(over) * MANUAL.hardLag;
    this.dist = dampRamp(this.dist, p.dist, dist, CHASE.speedLambda, dt);
    this.height = dampRamp(this.height, p.height, height, CHASE.speedLambda, dt);
    this.fov = dampRamp(this.fov, p.fov, fov, CHASE.speedLambda, dt);
    p.heading = target;
    p.dist = dist;
    p.height = height;
    p.fov = fov;
    const w = CHASE.aheadWeight;
    const k = 1 - Math.exp(-CHASE.lookLambda * dt);
    this.look.x += (aheadLocal.x * w - this.look.x) * k;
    this.look.y += (f.aimY + aheadLocal.y * w - this.look.y) * k;
    this.look.z += (aheadLocal.z * w - this.look.z) * k;
  }

  /** World pose; `minY` keeps the eye above the road behind the car. */
  pose(frame: CarFrame, minY: number, out: Pose): Pose {
    const lag = wrapAngle(this.heading - frame.heading);
    // Car frame: x forward, y up, z right (left = -z). Behind the car along the lagged heading.
    this.eye.set(-this.dist * Math.cos(lag), this.height, this.dist * Math.sin(lag));
    this.local.pos.copy(this.eye).applyQuaternion(frame.quat).add(frame.pos);
    if (this.local.pos.y < minY) this.local.pos.y = minY;
    this.aim.copy(this.look).applyQuaternion(frame.quat).add(frame.pos);
    out.pos.copy(this.local.pos);
    lookAt(out.pos, this.aim, out.quat);
    out.fov = this.fov;
    return out;
  }
}

/** Static corner geometry in the BODY frame (three axes: x forward, y up, z right). */
export interface CornerGeometry {
  /** Axle x, m. */
  readonly x: number;
  /** Half track, m (0 for a motorcycle). */
  readonly halfTrack: number;
  /** +1 left, -1 right, 0 centreline. */
  readonly side: 1 | -1 | 0;
  readonly front: boolean;
  readonly radius: number;
  /** Motorcycle close-ups: a fixed side to film from, +1 left, -1 right (a single-sided arm's own side); unset = the
   * rig picks the outside of the lean. */
  readonly filmSide?: 1 | -1;
}

export const CLOSEUP = {
  /** Car: eye ahead of (front) / behind (rear) the axle, above the hub, near the centreline, looking out and down
   * through the x-rayed bumper at the corner, so the arms, spring, damper, tie rod and bar read against the tyre. */
  along: 1.27,
  eyeY: 0.95,
  eyeLateral: 0.15,
  aimY: 0.92,
  fov: 48,
  /** Motorcycle (no track): a side view from the left, slightly ahead and above, of the fork (front: aim half-way up
   * the legs) or of the swingarm and shock (rear: aim between the axle and the pivot). */
  bikeFront: { eye: [0.3, 0.95, 1.95], aim: [-0.13, 0.28] },
  bikeRear: { eye: [0.2, 0.95, 2.05], aim: [0.27, 0.14] },
  bikeFov: 40,
  /** Lean toward the lens (rad) past which the bike close-up crosses to the outside of the lean. */
  bikeSwitchLean: 0.17,
  /** Share of a lean away from the lens the eye follows (it swings up and keeps square to the bike's side). */
  bikeFollowLean: 0.85,
} as const;

/** Close-up eye/aim in the body frame for one corner. Returns the FOV. `side`: a bike's film side when not fixed. */
export function closeupLocal(c: CornerGeometry, eye: Vector3, aim: Vector3, side: 1 | -1 = 1): number {
  const dir = c.front ? 1 : -1;
  if (c.halfTrack === 0) {
    // Left is three -z. x offsets are from the axle (aim y above the hub).
    const f = c.front ? CLOSEUP.bikeFront : CLOSEUP.bikeRear;
    eye.set(c.x + f.eye[0], f.eye[1], -(c.filmSide ?? side) * f.eye[2]);
    aim.set(c.x + f.aim[0], c.radius + f.aim[1], 0);
    return CLOSEUP.bikeFov;
  }
  const lat = c.side === 0 ? 1 : c.side;
  eye.set(c.x + dir * CLOSEUP.along, CLOSEUP.eyeY, -lat * CLOSEUP.eyeLateral);
  aim.set(c.x, c.radius * CLOSEUP.aimY, -lat * c.halfTrack);
  return CLOSEUP.fov;
}

/** Body-frame corner geometry for every corner of the current simulation (array order = TelemetryFrame.corners). */
export function cornerGeometry(sim: Simulation, t: TelemetryFrame): CornerGeometry[] {
  const v = sim.vehicle;
  const s = sim.suspension;
  // A single-sided swingarm is filmed from its own side (sim +y = left), where the arm and shock are.
  const rearSide = s.vehicleClass === 'motorcycle' && s.rear.kind === 'swingarm' && s.rear.singleSided && s.rear.shockLower[1] < 0 ? -1 : 1;
  return t.corners.map((c) => {
    const axle = v[c.axle];
    const front = c.axle === 'front';
    return {
      x: front ? v.cgToFront : v.cgToFront - v.wheelbase,
      halfTrack: 'track' in axle ? axle.track / 2 : 0,
      side: c.side,
      front,
      radius: axle.tyre.radius,
      ...(!front && rearSide < 0 ? { filmSide: -1 as const } : {}),
    };
  });
}

interface ActiveShot {
  kind: ShotKind;
  corner: CornerId | null;
  remaining: number;
  age: number;
  fov: number | undefined;
  azimuth: number;
}

export type ExplorePose = (frame: CarFrame, dt: number, out: Pose) => boolean;

/**
 * Owns every camera source and the blend. `update()` writes `out` (the world camera pose to apply).
 * View / shot changes may come between frames (store watchers); they capture the last applied pose.
 */
export class CameraRig {
  readonly out = createPose();
  readonly frame = new CarFrame();
  readonly chase = new Chase();
  view: ViewMode = 'follow';
  corner: CornerId | null = null;
  shot: ActiveShot | null = null;
  /** Blend progress 0..1 (1 = settled on the target). */
  blend = 1;
  /** Black-dip opacity for reduced-motion cuts, 0..1. */
  fade = 0;
  /** Seconds the lap clock may jump before the chase snaps instead of swinging. */
  static readonly SNAP_S = 0.5;
  /** Target provider weight: 0 = Auto (the M1 code path, untouched), 1 = Manual Drive; eased over MANUAL.blendS. */
  mix = 0;
  /** The last frame was outside auto (manual, returning, replay). */
  driving = false;
  /** Set by the owner from the store: mode switches cut (with the dip from black) instead of cross-fading. */
  reducedMotion = false;

  private corners: CornerGeometry[] = [];
  private readonly path: PathState = { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 };
  private readonly ahead: PathState = { ...this.path };
  private readonly aheadWorld = new Vector3();
  private readonly aheadLocal = new Vector3();
  private readonly target = createPose();
  private readonly fromLocal = createPose();
  private readonly toLocal = createPose();
  private readonly mixLocal = createPose();
  private readonly pivot = new Vector3(0, PIVOT_Y, 0);
  private readonly bodyPos = new Vector3();
  private readonly bodyQuat = new Quaternion();
  private readonly eye = new Vector3();
  private readonly aim = new Vector3();
  private readonly tripod = new Vector3();
  private readonly bodyUp = new Vector3();
  private readonly unroll = new Quaternion();
  private shotScale = 1;
  /** Bike close-up film side (+1 left): the outside of the lean, with hysteresis. */
  private bikeSide: 1 | -1 = 1;
  /** Callers asked for cuts (reduced motion): the rig's own switches follow suit. */
  private cuts = false;
  /** Suspension the corner layout was read for (a bike's film side depends on its swingarm). */
  private layoutFor = '';
  private lastLapTime = Number.NaN;
  private started = false;
  private cutPending = false;
  // Manual anchor: CG ground point (sim x, y) and the smoothed body height (raw = last frame's target).
  private anchorValid = false;
  private anchorX = 0;
  private anchorY = 0;
  private zRaw = 0;
  private zSmooth = 0;
  private readonly anchor = new Vector3();
  private readonly anchorAhead = new Vector3();
  private readonly pathPos = new Vector3();
  private readonly ground: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: 0, l: 0 };

  constructor(
    private readonly sim: () => Simulation,
    private readonly explore: ExplorePose | null = null,
  ) {}

  /** Re-read corner layout (call after `sim:vehicle`). */
  layout(t: TelemetryFrame): void {
    this.corners = cornerGeometry(this.sim(), t);
    this.layoutFor = this.sim().suspension.id;
    const bike = this.sim().vehicle.class === 'motorcycle';
    this.chase.framing = bike ? BIKE_CHASE : CHASE;
    this.shotScale = bike ? BIKE_SHOT_SCALE : 1;
  }

  /** Discontinuous car pose (reset, teleport, immediate release): the next update snaps instead of swinging. */
  cut(): void {
    this.cutPending = true;
  }

  get transitioning(): boolean {
    return this.blend < 1;
  }

  setView(view: ViewMode, corner: CornerId | null, instant: boolean): void {
    this.view = view;
    this.corner = corner;
    this.shot = null;
    this.cuts = instant;
    this.begin(instant);
  }

  playShot(shot: DirectorShot, instant: boolean): void {
    // Director shots are refused outside auto (ARCHITECTURE-M2 §10.3).
    if (this.driving) return;
    this.cuts = instant;
    this.shot = {
      kind: shot.kind,
      corner: shot.corner ?? null,
      remaining: shot.durationS,
      age: 0,
      fov: shot.fov,
      azimuth: 0,
    };
    if (shot.kind === 'trackside') this.placeTripod(shot.durationS);
    // The hero orbit opens on a front three-quarter (left side, ~30° off the nose) and turns toward the profile.
    if (shot.kind === 'orbit') this.shot.azimuth = ORBIT_START;
    // Trackside and the hero orbit open on a cut (film grammar); everything else glides.
    this.begin(instant || shot.kind === 'trackside' || shot.kind === 'orbit');
  }

  clearShot(instant: boolean): void {
    if (!this.shot) return;
    this.shot = null;
    this.begin(instant);
  }

  /** Advance one render frame. `reducedMotion` turns blends into cuts (callers pass `instant`). */
  update(dt: number, t: TelemetryFrame): Pose {
    const sim = this.sim();
    this.driving = t.drive.mode !== 'auto';
    // Director shots are an Auto feature: one still playing when the visitor takes the wheel glides back to the chase.
    if (this.driving && this.shot) this.clearShot(this.cuts);
    const goal = this.driving ? 1 : 0;
    if (this.mix !== goal) {
      if (!this.started || this.cutPending) this.mix = goal;
      else if (this.reducedMotion) {
        this.mix = goal;
        this.cutPending = true;
        this.fade = 1;
      } else this.mix = goal > this.mix ? Math.min(1, this.mix + dt / MANUAL.blendS) : Math.max(0, this.mix - dt / MANUAL.blendS);
    }
    if (this.mix === 0) {
      this.anchorValid = false;
      sim.stateAt(t.lapTime, this.path);
      this.frame.set(this.path);
      const speed01 = clamp(this.path.v / sim.vehicle.limits.vMax, 0, 1);
      sim.stateAt(t.lapTime + CHASE.aheadS, this.ahead);
      simToThree(this.ahead.x, this.ahead.y, this.ahead.z, this.aheadWorld);
      this.frame.pointToLocal(this.aheadWorld, this.aheadLocal);
      const d = sim.lapDuration;
      const step = t.lapTime - this.lastLapTime;
      const jumped = !this.started || !(Math.abs(step - d * Math.round(step / d)) <= CameraRig.SNAP_S);
      if (jumped || this.cutPending || !Number.isFinite(this.chase.heading)) this.chase.reset(this.frame, speed01);
      else this.chase.step(dt, this.frame, speed01, this.aheadLocal);
    } else this.driven(dt, t, sim);
    this.lastLapTime = t.lapTime;
    this.cutPending = false;
    if (this.corners.length !== t.corners.length || this.layoutFor !== sim.suspension.id) this.layout(t);

    if (this.shot) {
      this.shot.age += dt;
      this.shot.remaining -= dt;
      if (this.shot.remaining <= 0) {
        this.shot = null;
        this.begin(false);
      }
    }
    this.source(dt, t, sim);
    if (!this.started) {
      this.started = true;
      this.blend = 1;
    }

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / BLEND_S);
      this.frame.toLocal(this.target, this.toLocal);
      blendLocal(this.fromLocal, this.toLocal, smootherstep(this.blend), this.pivot, this.mixLocal);
      this.frame.toWorld(this.mixLocal, this.out);
    } else copyPose(this.target, this.out);
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt / FADE_S);
    return this.out;
  }

  /** Writes the live target pose of the active shot or view into `this.target`. */
  private source(dt: number, t: TelemetryFrame, sim: Simulation): void {
    const kind: ShotKind | ViewMode = this.shot ? this.shot.kind : this.view;
    const fov = this.shot?.fov;
    const out = this.target;
    switch (kind) {
      case 'explore':
        if (this.explore?.(this.frame, dt, out)) return;
        this.chasePose(sim, out);
        return;
      case 'closeup':
        this.closeupPose(t, this.shot ? this.shot.corner : this.corner, out);
        break;
      case 'orbit': {
        const az = (this.shot?.azimuth ?? 0) - (this.shot?.age ?? 0) * ORBIT_RATE;
        const r = 7.2 * this.shotScale;
        this.local(r * Math.cos(az), 1.9 * this.shotScale, r * Math.sin(az), 0, 0.55, 0, out);
        out.fov = DEFAULT_FOV.orbit;
        break;
      }
      case 'overhead':
        this.local(-4, 17, 0.01, 0.5, 0, 0, out);
        out.fov = DEFAULT_FOV.overhead;
        break;
      case 'front-view':
        this.local(7.5 * this.shotScale, 0.8, 0, 0, 0.6, 0, out);
        out.fov = DEFAULT_FOV['front-view'];
        break;
      case 'trackside': {
        this.aim.set(0, 0.7, 0).applyQuaternion(this.frame.quat).add(this.frame.pos);
        out.pos.copy(this.tripod);
        lookAt(out.pos, this.aim, out.quat);
        // Telephoto: keep the car about the same size on screen as it approaches and passes.
        out.fov = clamp(2 * Math.atan(3.2 / Math.max(1, this.tripod.distanceTo(this.aim))) * RAD_TO_DEG, 9, 48);
        break;
      }
      default:
        this.chasePose(sim, out);
    }
    if (fov !== undefined) out.fov = fov;
  }

  /**
   * Outside auto (or blending to/from it): the car frame and the chase target cross-fade from the driving-line point
   * (Auto provider) to the driven car (Manual provider) with weight smootherstep(mix). Rig state is never reset by a
   * mode change; only a cut (or an anchor jump > MANUAL.cutJumpM) snaps it.
   */
  private driven(dt: number, t: TelemetryFrame, sim: Simulation): void {
    const d = t.drive;
    const vMax = sim.vehicle.limits.vMax;
    let snap = !this.started || this.cutPending || !Number.isFinite(this.chase.heading);
    if (this.anchorValid && Math.hypot(d.x - this.anchorX, d.y - this.anchorY) > MANUAL.cutJumpM) snap = true;
    const z = t.bodyPosition.z;
    this.zSmooth = this.anchorValid && !snap ? dampRamp(this.zSmooth, this.zRaw, z, MANUAL.zLambda, dt) : z;
    this.zRaw = z;
    this.anchorX = d.x;
    this.anchorY = d.y;
    this.anchorValid = true;

    const wheelbase = t.wheelbase > 0 ? t.wheelbase : sim.vehicle.wheelbase;
    const target = manualHeading(d, t.yawRate, t.steer, wheelbase);
    const reach = (MANUAL.aheadM * wheelbase) / MANUAL.refWheelbase;
    simToThree(d.x, d.y, this.zSmooth, this.anchor);
    // Sim heading h points along three (cos h, 0, -sin h).
    this.anchorAhead.set(this.anchor.x + reach * Math.cos(target), this.anchor.y, this.anchor.z - reach * Math.sin(target));
    let heading = d.yaw;
    let aim = target;
    let speed01 = clamp(Math.abs(d.u) / vMax, 0, 1);
    const e = smootherstep(this.mix);
    if (e < 1) {
      sim.stateAt(t.lapTime, this.path);
      sim.stateAt(t.lapTime + CHASE.aheadS, this.ahead);
      simToThree(this.path.x, this.path.y, this.path.z, this.pathPos);
      simToThree(this.ahead.x, this.ahead.y, this.ahead.z, this.aheadWorld);
      this.anchor.lerpVectors(this.pathPos, this.anchor, e);
      this.anchorAhead.lerpVectors(this.aheadWorld, this.anchorAhead, e);
      heading = this.path.heading + wrapAngle(d.yaw - this.path.heading) * e;
      aim = this.path.heading + wrapAngle(target - this.path.heading) * e;
      speed01 += (clamp(this.path.v / vMax, 0, 1) - speed01) * (1 - e);
    }
    this.frame.pos.copy(this.anchor);
    this.frame.setHeading(heading);
    this.frame.pointToLocal(this.anchorAhead, this.aheadLocal);
    if (snap) this.chase.reset(this.frame, speed01, aim);
    else this.chase.stepTo(dt, aim, speed01, this.aheadLocal);
  }

  private chasePose(sim: Simulation, out: Pose): void {
    const track = sim.track;
    if (this.mix === 0) {
      const minY = track.roadHeight(this.path.s - this.chase.dist, this.path.l) + CHASE.clearance;
      this.chase.pose(this.frame, minY, out);
      return;
    }
    // Ground under the eye (three x, -z = sim x, y); without a world (test fakes) the anchor height.
    const h = this.chase.heading;
    const ex = this.frame.pos.x - this.chase.dist * Math.cos(h);
    const ey = -(this.frame.pos.z + this.chase.dist * Math.sin(h));
    const world = sim.world;
    let minY = (world ? world.sample(ex, ey, Number.NaN, this.ground).h : this.frame.pos.y) + MANUAL.clearance;
    const e = smootherstep(this.mix);
    if (e < 1) minY += (track.roadHeight(this.path.s - this.chase.dist, this.path.l) + CHASE.clearance - minY) * (1 - e);
    this.chase.pose(this.frame, minY, out);
  }

  /** Pose from an eye and aim in the car frame. */
  private local(ex: number, ey: number, ez: number, ax: number, ay: number, az: number, out: Pose): void {
    out.pos.set(ex, ey, ez).applyQuaternion(this.frame.quat).add(this.frame.pos);
    this.aim.set(ax, ay, az).applyQuaternion(this.frame.quat).add(this.frame.pos);
    lookAt(out.pos, this.aim, out.quat);
  }

  /** Rigid body-frame anchor: the body stays still on screen and the wheel and links visibly work. */
  private closeupPose(t: TelemetryFrame, corner: CornerId | null, out: Pose): void {
    let index = 0;
    for (let i = 0; i < t.corners.length; i++) if (t.corners[i]!.id === corner) index = i;
    const c = this.corners[index];
    simToThree(t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z, this.bodyPos);
    simQuatToThree(t.bodyRotation, this.bodyQuat);
    if (!c) {
      this.chasePose(this.sim(), out);
      return;
    }
    if (c.halfTrack === 0) {
      // A bike leans as a whole. Leaning toward the lens it would show its underside, so the camera crosses to the
      // outside of the lean (hysteresis: once per corner). There it follows most of the lean about the ground line:
      // the eye swings up and stays square to the bike's side. A fixed side (single-sided arm) keeps the un-leaned
      // frame, so the camera never sinks under the road. The horizon stays level either way (world up below).
      const side = c.filmSide ?? this.bikeSide;
      if (c.filmSide === undefined && t.roll * side < -CLOSEUP.bikeSwitchLean) {
        this.bikeSide = side > 0 ? -1 : 1;
        this.begin(this.cuts);
      }
      const s = c.filmSide ?? this.bikeSide;
      // Sim roll > 0 leans right (away from a left-side camera, s = +1).
      const keep = c.filmSide === undefined ? Math.max(0, t.roll * s) * s * CLOSEUP.bikeFollowLean : 0;
      this.bodyQuat.multiply(this.unroll.setFromAxisAngle(FORWARD, keep - t.roll));
    }
    out.fov = closeupLocal(c, this.eye, this.aim, this.bikeSide);
    this.eye.applyQuaternion(this.bodyQuat).add(this.bodyPos);
    this.aim.applyQuaternion(this.bodyQuat).add(this.bodyPos);
    out.pos.copy(this.eye);
    // Camera roll follows the body so the chassis reads as a fixed stage (a bike: the horizon stays level).
    if (c.halfTrack === 0) this.bodyUp.copy(UP);
    else this.bodyUp.copy(UP).applyQuaternion(this.bodyQuat);
    out.quat.setFromRotationMatrix(lookMatrix.lookAt(this.eye, this.aim, this.bodyUp));
  }

  /** Tripod on the inside of the line where the car will be half-way through the shot. */
  private placeTripod(durationS: number): void {
    const sim = this.sim();
    sim.stateAt(this.lastLapTime + durationS * 0.5, this.ahead);
    const def = sim.track.def;
    const inside = this.ahead.curvature < 0 ? -1 : 1;
    const l = inside * (def.width / 2 + def.kerbWidth + 5);
    const p = sim.track.toWorld(this.ahead.s, l, { x: 0, y: 0, z: 0 });
    simToThree(p.x, p.y, p.z + 1.3, this.tripod);
  }

  private begin(instant: boolean): void {
    if (!this.started) return;
    if (instant) {
      this.blend = 1;
      this.fade = 1;
      return;
    }
    this.frame.toLocal(this.out, this.fromLocal);
    this.blend = 0;
  }
}
