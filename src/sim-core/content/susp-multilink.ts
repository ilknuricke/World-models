/**
 * Multi-link car suspension, front + rear: five separate ball-jointed links per wheel. AXLE frame, LEFT side, metres.
 *
 * Topology seeded from Project Chrono's ChMultiLink (BSD-3-Clause: upper arm + lateral link + trailing link + tie rod),
 * with the upper arm split into two separate links so every link is a single rod. Hardpoints are our own sports-car
 * packaging for the GT coupe (shared wheel centre, tyre, alignment and travel from gt-geometry.ts):
 * - front: two short upper links mounted high beside the tyre, a transverse lower link carrying the coil-over and a
 *   lower tension link from behind; the virtual lower pivot sits deep in the wheel, so the steering axis is virtual.
 * - rear: two upper links, a forward lower link, a transverse lower spring link behind the drive shaft, a toe link.
 * Lower-link chassis points are inclined in side view like the other types. Tie-rod / toe-link inner points were
 * placed by a 2-D search so toe is unchanged at +-70 mm travel. 02-05 packaging against the real DB11 wheel: the
 * trailing (front) / leading (rear) lower link swung inboard through the same virtual lower pivot so it no longer runs
 * along the tyre's inner sidewall; spring links raised and the coil-over moved inboard (spring at 0.75 / 0.7 of the
 * link) so the damper eye clears the rim lip; upper outer joints moved inboard along their link lines so the upright
 * necks clear the rim; spring tops moved so the rods pass between the upper links. All metrics are computed by the solver.
 */
import type { AxleLinkage, CarSuspensionDefinition, ComponentRole } from '../../contracts/suspension';
import { GT_CORNER } from './gt-geometry';

function axle(
  points: AxleLinkage['points'],
  steered: boolean,
  corner: typeof GT_CORNER.front | typeof GT_CORNER.rear,
  roles: { lowerFront: ComponentRole; lowerRear: ComponentRole },
  springLink: 'lowerFront' | 'lowerRear',
  springFraction: number,
): AxleLinkage {
  return {
    points: { wheelCentre: corner.wheelCentre, ...points },
    uprightPoints: ['wheelCentre', 'upperFrontOuter', 'upperRearOuter', 'lowerFrontOuter', 'lowerRearOuter', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'upperFrontOuter', chassis: 'upperFrontInner', role: 'upper-arm', member: 'upperFront' },
      { kind: 'distance', upright: 'upperRearOuter', chassis: 'upperRearInner', role: 'upper-arm', member: 'upperRear' },
      { kind: 'distance', upright: 'lowerFrontOuter', chassis: 'lowerFrontInner', role: roles.lowerFront, member: 'lowerFront' },
      { kind: 'distance', upright: 'lowerRearOuter', chassis: 'lowerRearInner', role: roles.lowerRear, member: 'lowerRear' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
    ],
    ...(steered ? { steer: 'tieRodInner' } : {}),
    spring: { upper: 'springTop', lower: { on: 'link', member: springLink, fraction: springFraction } },
    antiRollBarMount: { member: springLink, point: 'arbPickup' },
    alignment: corner.alignment,
    travel: GT_CORNER.travel,
  };
}

export const multilink: CarSuspensionDefinition = {
  id: 'multilink',
  vehicleClass: 'car',
  visualKey: 'spatial-linkage',
  copy: {
    label: 'Çok bağlantılı',
    short: 'Çok bağlantılı',
    descriptor: 'Her biri ayrı konumlandırılan bağlantılar. En fazla parça.',
    strengths: [
      'Kamberi, toe açısını, fren dalmasını ve hızlanma çömesini ayrı ayarlamak için genellikle en fazla özgürlüğü sunar',
      'Burç esnekliği bilinçli seçilerek yük altında genellikle en iyi toe kontrolü sağlanır',
      'Sanal direksiyon ekseni, geniş lastiklerde yer temasındaki eksen ofsetini küçük tutabilir',
      'Alt şasiye bağlı bağlantılarla genellikle iyi yalıtım sağlar',
    ],
    costs: [
      'Genellikle en fazla bağlantı, mafsal ve burca, ayrıca en yüksek maliyete sahiptir',
      'Yerleştirilmesi ve ayarlanması genellikle en zor düzendir',
      'Genellikle çok sayıda burç vardır; aşınmaları tekerlek ayarını değiştirir',
    ],
    qualitative: { cost: 'higher', packaging: 'higher', complexity: 'higher' },
  },
  axles: {
    front: axle(
      {
        upperFrontInner: [0.09, 0.48, 0.61],
        upperFrontOuter: [0.0158, 0.645, 0.6678],
        upperRearInner: [-0.19, 0.5, 0.61],
        upperRearOuter: [-0.0933, 0.645, 0.6624],
        lowerFrontInner: [0.04, 0.37, 0.152],
        lowerFrontOuter: [0.02, 0.8, 0.172],
        lowerRearInner: [-0.19, 0.47, 0.145],
        lowerRearOuter: [-0.013, 0.765, 0.1502],
        tieRodOuter: [-0.14, 0.785, 0.24],
        tieRodInner: [-0.15, 0.4509, 0.212],
        springTop: [-0.04, 0.54, 0.75],
        arbPickup: [0.028, 0.628, 0.164],
      },
      true,
      GT_CORNER.front,
      { lowerFront: 'lateral-link', lowerRear: 'trailing-link' },
      'lowerFront',
      0.75,
    ),
    rear: axle(
      {
        upperFrontInner: [0.12, 0.48, 0.6],
        upperFrontOuter: [0.0413, 0.655, 0.67],
        upperRearInner: [-0.16, 0.5, 0.6],
        upperRearOuter: [-0.0567, 0.655, 0.6646],
        lowerFrontInner: [0.1416, 0.47, 0.147],
        lowerFrontOuter: [-0.0294, 0.755, 0.15],
        lowerRearInner: [-0.12, 0.37, 0.148],
        lowerRearOuter: [-0.09, 0.795, 0.172],
        tieRodOuter: [-0.16, 0.775, 0.27],
        tieRodInner: [-0.17, 0.4605, 0.2321],
        springTop: [-0.06, 0.56, 0.72],
        arbPickup: [-0.105, 0.5825, 0.16],
      },
      false,
      GT_CORNER.rear,
      { lowerFront: 'trailing-link', lowerRear: 'lateral-link' },
      'lowerRear',
      0.7,
    ),
  },
  extras: { damperFriction: 20, unsprungMassDelta: 0 },
};
