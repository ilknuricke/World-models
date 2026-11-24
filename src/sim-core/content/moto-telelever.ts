/**
 * Telelever preset: wishbone-located fork (the tubes only steer and guide; the shock works on the A-arm) + single-sided
 * swingarm with a direct shock (research 08 §1 preset 3). The wishbone geometry, not a number, sets the anti-dive.
 * Inputs are estimates; the simulation computes what is shown.
 */
import type { MotorcycleSuspensionDefinition } from '../../contracts/suspension';
import { DEG_TO_RAD, type Vec3 } from '../../contracts/units';
import { REAR_AXLE, steeringPoints, SWINGARM_PIVOT } from './cafe-racer';

const RAKE = 25 * DEG_TO_RAD;
const OFFSET = 0.03;
const axis = steeringPoints(RAKE, OFFSET, 0.7, 0.33);
const joint = axis.onAxis;
const pivot: Vec3 = [joint[0] - 0.32, 0, joint[2] - 0.04];
const shockArm: Vec3 = [pivot[0] + 0.55 * (joint[0] - pivot[0]), 0, pivot[2] + 0.55 * (joint[2] - pivot[2]) + 0.02];

export const motoTelelever: MotorcycleSuspensionDefinition = {
  id: 'moto-telelever',
  vehicleClass: 'motorcycle',
  visualKey: 'moto-planar',
  copy: {
    label: 'Telelever',
    short: 'Telelever',
    descriptor: 'Salıncakla konumlandırılan çatal ve tek taraflı arka salıncak',
    strengths: [
      'Geometri fren dalmasına karşı koyar; şasi neredeyse yatay kalır',
      'Sıkışma sırasında tekerlek yolu iz mesafesini artırır; frenlemede iz mesafesi çok daha az düşer',
      'Çatal borularında yay yoktur; ilk hareket sürtünmesinin etkisi bu yüzden çok azdır',
    ],
    costs: [
      'Daha az dalma, frenlemede alışılmış ön taraf hissini de azaltır',
      'Tekerlek yolu öne eğimlidir; keskin kenarlı engellerde genellikle daha sert tepki verir',
      'Direksiyon başı çevresinde genellikle daha fazla parça ve ağırlık vardır',
    ],
    qualitative: { cost: 'higher', packaging: 'higher', complexity: 'higher' },
  },
  front: {
    kind: 'telelever',
    rake: RAKE,
    offset: OFFSET,
    steeringHead: axis.head,
    armPivot: pivot,
    armJoint: joint,
    shockTop: [shockArm[0] - 0.05, 0, shockArm[2] + 0.3],
    shockArm,
    travel: 0.115,
    spring: { rate: 115_000, preload: 700, progression: 0 },
    damper: { bump: 4_700, rebound: 9_400 },
    unsprungMass: 17.5,
  },
  rear: {
    kind: 'swingarm',
    pivot: SWINGARM_PIVOT,
    axle: [REAR_AXLE[0], 0, REAR_AXLE[1]],
    shocks: 1,
    singleSided: true,
    // Outboard of the arm on the right (-y), not inside the tyre; the planar model ignores y.
    shockTop: [-0.43, -0.165, 0.66],
    shockLower: [-0.5, -0.165, 0.36],
    travel: 0.12,
    spring: { rate: 90_000, preload: 400, progression: 0 },
    damper: { bump: 3_500, rebound: 7_000 },
    unsprungMass: 21,
  },
};
