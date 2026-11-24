/**
 * MacPherson strut car suspension, front + rear (rear = Chapman-style strut with a fixed toe link).
 * AXLE frame, LEFT side, metres.
 *
 * Topology from Project Chrono's ChMacPhersonStrut (BSD-3-Clause): lower A-arm (revolute to the chassis, ball joint
 * to the upright), tie rod / toe link, and a strut clamped to the upright that slides and spins in line with the
 * chassis top mount (cylindrical joint = 2 equations). Hardpoints are our own sports-car packaging for the GT coupe
 * (shared wheel centre, tyre, alignment and travel from gt-geometry.ts): long strut with a high tower top mount,
 * strut body clearing the tyre's inner sidewall, lower ball joint deep in a 20-inch wheel to keep the ground offset
 * small, which leaves the steering axis (ball joint to top mount) steeply inclined. Lower-arm pivot axes are
 * inclined in side view like the other types. Tie-rod / toe-link inner points were placed by a 2-D search so toe is
 * unchanged at +-70 mm travel. 02-05: strut axis moved inboard (and the top mount 40 mm up to hold the kingpin
 * inclination) so the coil and its lower seat clear the real DB11 tyre shoulder; measured against the wheel mesh.
 * All metrics are computed by the solver.
 */
import type { AxleLinkage, CarSuspensionDefinition } from '../../contracts/suspension';
import { GT_CORNER } from './gt-geometry';

function axle(points: AxleLinkage['points'], steered: boolean, corner: typeof GT_CORNER.front | typeof GT_CORNER.rear): AxleLinkage {
  return {
    points: { wheelCentre: corner.wheelCentre, ...points },
    uprightPoints: ['wheelCentre', 'lbj', 'strutLower', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'lbj', chassis: 'lcaFront', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'lbj', chassis: 'lcaRear', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
      { kind: 'strut', upright: 'strutLower', chassis: 'strutTop' },
    ],
    ...(steered ? { steer: 'tieRodInner' } : {}),
    // Coil and damper act along the strut: spring length = top mount to strut clamp.
    spring: { upper: 'strutTop', lower: { on: 'upright', point: 'strutLower' } },
    antiRollBarMount: { member: 'lowerArm', point: 'arbPickup' },
    alignment: corner.alignment,
    travel: GT_CORNER.travel,
  };
}

export const macpherson: CarSuspensionDefinition = {
  id: 'macpherson',
  vehicleClass: 'car',
  visualKey: 'spatial-linkage',
  copy: {
    label: 'MacPherson dikme',
    short: 'Dikme',
    descriptor: 'Kompakt ve hafif. Kamber gövdenin yatmasını izler.',
    strengths: [
      'Genellikle en az parça ve en düşük maliyet',
      'Enine yönde genellikle kompakttır; motor bölmesine yer bırakır',
      'Genellikle hafiftir; büyük üst bağlantısı titreşimi iyi yalıtır',
      'Kamber kontrolü, kısa ve sert süspansiyon hareketi için genellikle yeterlidir',
    ],
    costs: [
      'Sıkışmada kamber kazanımı genellikle azdır; dış lastik gövdeyle birlikte yatar',
      'Yalpa merkezi genellikle daha yüksektir ve gövde yattıkça çok yer değiştirir',
      'Dikme üzerindeki yanal yük genellikle daha fazla sürtünme oluşturur',
      'Genellikle yüksek bir kule gerektirir; bu da kaput çizgisini yükseltir',
    ],
    qualitative: { cost: 'lower', packaging: 'lower', complexity: 'lower' },
  },
  axles: {
    front: axle(
      {
        lbj: [0, 0.792, 0.155],
        strutTop: [-0.085, 0.61, 0.9],
        strutLower: [-0.06, 0.632, 0.52],
        lcaFront: [0.2, 0.38, 0.182],
        lcaRear: [-0.22, 0.4, 0.2038],
        tieRodOuter: [-0.14, 0.76, 0.24],
        tieRodInner: [-0.16, 0.3411, 0.2743],
        arbPickup: [0.04, 0.64, 0.17],
      },
      true,
      GT_CORNER.front,
    ),
    rear: axle(
      {
        lbj: [0, 0.792, 0.155],
        strutTop: [-0.01, 0.61, 0.9],
        strutLower: [0, 0.632, 0.52],
        lcaFront: [0.2, 0.38, 0.198],
        lcaRear: [-0.22, 0.4, 0.1812],
        tieRodOuter: [-0.14, 0.76, 0.24],
        tieRodInner: [-0.16, 0.3214, 0.271],
        arbPickup: [0.04, 0.64, 0.18],
      },
      false,
      GT_CORNER.rear,
    ),
  },
  extras: { damperFriction: 60, unsprungMassDelta: -2 },
};
