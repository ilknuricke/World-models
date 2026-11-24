/**
 * Double wishbone (short-long arm) car suspension, front + rear. AXLE frame, LEFT side, metres.
 *
 * Topology from Project Chrono's ChDoubleWishbone (BSD-3-Clause): lower and upper A-arms (revolute to the chassis,
 * ball joint to the upright) + tie rod / toe link. Hardpoints are our own sports-car packaging for the GT coupe
 * (shared wheel centre, tyre, alignment and travel from gt-geometry.ts): lower ball joint deep in a 20-inch wheel,
 * upper ball joint inside the top of the rim barrel, upper arm about half the lower arm length, coil-over from the
 * lower arm to the chassis between the upper arm legs. Lower-arm pivot axes are inclined in side view (front axle
 * front pivot down, rear axle front pivot up). Tie-rod / toe-link inner points were placed by a 2-D search so toe
 * is unchanged at +-60 mm travel (the usual bump-steer setup). 02-05: rear coil-over moved to x = 0 so it passes
 * between the upper arm legs instead of through the front leg. All metrics are computed by the solver.
 */
import type { AxleLinkage, CarSuspensionDefinition } from '../../contracts/suspension';
import { GT_CORNER } from './gt-geometry';

function axle(points: AxleLinkage['points'], steered: boolean, corner: typeof GT_CORNER.front | typeof GT_CORNER.rear): AxleLinkage {
  return {
    points: { wheelCentre: corner.wheelCentre, ...points },
    uprightPoints: ['wheelCentre', 'lbj', 'ubj', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'lbj', chassis: 'lcaFront', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'lbj', chassis: 'lcaRear', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaFront', role: 'upper-arm', member: 'upperArm' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaRear', role: 'upper-arm', member: 'upperArm' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
    ],
    ...(steered ? { steer: 'tieRodInner' } : {}),
    spring: { upper: 'springTop', lower: { on: 'arm', member: 'lowerArm', point: 'springSeat' } },
    antiRollBarMount: { member: 'lowerArm', point: 'arbPickup' },
    alignment: corner.alignment,
    travel: GT_CORNER.travel,
  };
}

export const doubleWishbone: CarSuspensionDefinition = {
  id: 'double-wishbone',
  vehicleClass: 'car',
  visualKey: 'spatial-linkage',
  copy: {
    label: 'Çift salıncak',
    short: 'Çift salıncak',
    descriptor: 'İki salıncak, viraj boyunca tekerleği dik tutar',
    strengths: [
      'Genellikle en güçlü kamber kontrolünü sağlar: gövde yattığında dış lastik daha düz kalır',
      'Yalpa merkezi genellikle alçak ve kararlıdır',
      'Yaylı amortisör tekerlek hareketiyle aynı yöndedir; amortisör sürtünmesi genellikle düşüktür',
      'Alçak kaput çizgisine ve direksiyon ekseni geometrisinin serbestçe seçilmesine olanak tanır',
    ],
    costs: [
      'Genellikle dikme tipine göre daha fazla parça, mafsal ve maliyet gerektirir',
      'Yüksek kamber kazanımı, sıkışmada genellikle daha fazla iz genişliği değişimi getirir',
      'Motor bölmesinin yanında genellikle daha fazla enine alan kaplar',
    ],
    qualitative: { cost: 'medium', packaging: 'medium', complexity: 'medium' },
  },
  axles: {
    front: axle(
      {
        lbj: [0, 0.815, 0.165],
        ubj: [-0.045, 0.765, 0.585],
        lcaFront: [0.22, 0.37, 0.1362],
        lcaRear: [-0.2, 0.39, 0.158],
        ucaFront: [0.08, 0.52, 0.49],
        ucaRear: [-0.17, 0.53, 0.495],
        tieRodOuter: [-0.13, 0.78, 0.25],
        tieRodInner: [-0.15, 0.4338, 0.2121],
        springSeat: [-0.03, 0.7, 0.165],
        springTop: [-0.05, 0.62, 0.72],
        arbPickup: [0.04, 0.65, 0.155],
      },
      true,
      GT_CORNER.front,
    ),
    rear: axle(
      {
        lbj: [0, 0.815, 0.16],
        ubj: [0, 0.765, 0.58],
        lcaFront: [0.22, 0.38, 0.1588],
        lcaRear: [-0.2, 0.4, 0.142],
        ucaFront: [0.13, 0.53, 0.5],
        ucaRear: [-0.13, 0.53, 0.5],
        tieRodOuter: [-0.13, 0.78, 0.26],
        tieRodInner: [-0.14, 0.4339, 0.2255],
        springSeat: [0, 0.7, 0.17],
        springTop: [0, 0.62, 0.7],
        arbPickup: [0.06, 0.66, 0.16],
      },
      false,
      GT_CORNER.rear,
    ),
  },
  extras: { damperFriction: 15, unsprungMassDelta: 0 },
};
