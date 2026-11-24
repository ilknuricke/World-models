/**
 * GT coupe (ARCHITECTURE §7.5): REPRESENTATIVE parameters (research 05 §8 adapted), never manufacturer data.
 * Wheelbase, tracks and tyre radius are the measured dimensions of the hero mesh (gt-geometry.ts). Ride frequency,
 * damping ratio and anti-roll stiffness are targets shared by all three suspension types: each type's motion ratio
 * turns them into its own physical spring/damper rates, so visible differences come from the geometry.
 */
import type { CarDefinition, TyreParams } from '../../contracts/vehicle';
import { GT_GEOMETRY } from './gt-geometry';
import { gtCoupeHandling } from './gt-coupe-handling';

const tyre = (width: number, verticalStiffness: number, radius: number): TyreParams => ({
  radius,
  width,
  verticalStiffness,
  verticalDamping: 400,
  mu: 1.1,
  loadSensitivity: -5e-5,
  nominalLoad: 4200,
});

const damping = { bump: 0.32, rebound: 0.58 };

export const gtCoupe: CarDefinition = {
  id: 'gt-coupe',
  class: 'car',
  name: 'GT kupe',
  subtitle: 'Temsili parametreler',
  visualKey: 'db11',
  mass: 1700,
  sprungMass: 1540,
  cgHeight: 0.5,
  inertia: { roll: 550, pitch: 2500, yaw: 2800 },
  wheelbase: GT_GEOMETRY.wheelbase,
  cgToFront: 0.49 * GT_GEOMETRY.wheelbase,
  limits: { lateral: 8.3, accel: 5.0, brake: 8.5, vMax: 36 },
  dragArea: 0.65,
  suspensions: ['macpherson', 'double-wishbone', 'multilink'],
  defaultSuspension: 'double-wishbone',
  // Anti-roll stiffness: tuned so the double-wishbone car's SUSPENSION roll gradient (body relative to the axles, the
  // textbook definition behind the 1.0-1.2 deg/g band) is ~1.1 deg/g; with tyre compliance the body rolls ~1.7 deg/g
  // relative to the road (tests/sim-core/simulation.test.ts). Front share of roll stiffness ~57 % (front weight + 6 %).
  front: {
    track: GT_GEOMETRY.front.track,
    unsprungMass: 40,
    rideFrequency: 1.45,
    damping,
    antiRollStiffness: 145e3,
    tyre: tyre(0.255, 260e3, GT_GEOMETRY.front.tyreRadius),
    steered: true,
    driven: false,
    brakeShare: 0.62,
  },
  rear: {
    track: GT_GEOMETRY.rear.track,
    unsprungMass: 43,
    rideFrequency: 1.6,
    damping,
    antiRollStiffness: 85e3,
    tyre: tyre(0.295, 280e3, GT_GEOMETRY.rear.tyreRadius),
    steered: false,
    driven: true,
    brakeShare: 0.38,
  },
  maxSteer: 0.35,
  handling: gtCoupeHandling,
};
