/**
 * Cafe racer (ARCHITECTURE §7.1, §7.7): representative parameters for a twin-cylinder retro roadster with rider,
 * loosely Thruxton / Bonneville sized (research 08 §2). Every number here is an estimate used as model INPUT; what the
 * UI shows (sag, trail, anti-dive, frequencies) is computed by the simulation from it.
 *
 * Shared frame geometry (steering head, swingarm pivot, gearbox sprocket) lives here so the three presets differ only
 * in their suspension mechanisms.
 */
import { DEG_TO_RAD, type Vec3 } from '../../contracts/units';
import type { MotorcycleDefinition } from '../../contracts/vehicle';
import { dcos, dsin } from '../math/det';

const WHEELBASE = 1.415;
const CG_TO_FRONT = 0.7;
const FRONT_RADIUS = 0.3;
const REAR_RADIUS = 0.312;
/** 525 chain (pitch 15.875 mm), 17 / 41 teeth: pitch radius = p / (2 sin(pi / N)). */
const PITCH = 0.015875;
const sprocket = (teeth: number): number => PITCH / (2 * dsin(Math.PI / teeth));

/** Static wheel centres (vehicle frame x, z). */
export const FRONT_AXLE = [CG_TO_FRONT, FRONT_RADIUS] as const;
export const REAR_AXLE = [CG_TO_FRONT - WHEELBASE, REAR_RADIUS] as const;

/**
 * Steering geometry of a fork whose leg axis runs through the axle, parallel to a steering axis of `rake` with the
 * yokes offset `offset` ahead of it; `headAbove` = distance along the axis from the axle level to the top head bearing.
 * Returns the head point and the point `along` metres up the steering axis from its axle-level foot.
 */
export function steeringPoints(rake: number, offset: number, headAbove: number, along = 0): { head: Vec3; onAxis: Vec3 } {
  const [ax, az] = FRONT_AXLE;
  const footX = ax - offset * dcos(rake);
  const footZ = az - offset * dsin(rake);
  return {
    head: [footX - headAbove * dsin(rake), 0, footZ + headAbove * dcos(rake)],
    onAxis: [footX - along * dsin(rake), 0, footZ + along * dcos(rake)],
  };
}

/** Frame steering-head angle shared by both telescopic presets, and the yoke offset that gives the trail. */
export const FORK_RAKE = 24 * DEG_TO_RAD;
export const FORK_OFFSET = 0.0325;
export const HEAD_ABOVE_AXLE = 0.7;
/** Swingarm pivot on the frame and the swingarm length to the axle. */
export const SWINGARM_PIVOT: Vec3 = [-0.165, 0, 0.39];

export const cafeRacer: MotorcycleDefinition = {
  id: 'cafe-racer',
  class: 'motorcycle',
  name: 'Cafe racer',
  subtitle: 'Temsili parametreler',
  visualKey: 'cafe-racer',
  mass: 290,
  sprungMass: 254,
  cgHeight: 0.62,
  inertia: { roll: 35, pitch: 55, yaw: 70 },
  wheelbase: WHEELBASE,
  cgToFront: CG_TO_FRONT,
  limits: { lateral: 0.8 * 9.80665, accel: 4, brake: 7.5, vMax: 36 },
  dragArea: 0.42,
  suspensions: ['moto-classic', 'moto-modern', 'moto-telelever'],
  defaultSuspension: 'moto-classic',
  front: {
    tyre: {
      radius: FRONT_RADIUS,
      width: 0.12,
      verticalStiffness: 170_000,
      verticalDamping: 120,
      mu: 1.2,
      loadSensitivity: -1e-4,
      nominalLoad: 1400,
      crownRadius: 0.06,
    },
    brakeShare: 0.75,
    driven: false,
  },
  rear: {
    tyre: {
      radius: REAR_RADIUS,
      width: 0.16,
      verticalStiffness: 210_000,
      verticalDamping: 150,
      mu: 1.2,
      loadSensitivity: -8e-5,
      nominalLoad: 1500,
      crownRadius: 0.08,
    },
    brakeShare: 0.25,
    driven: true,
  },
  chain: { sprocketCentre: [-0.095, 0.375], frontRadius: sprocket(17), rearRadius: sprocket(41) },
};
