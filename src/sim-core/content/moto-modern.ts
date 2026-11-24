/**
 * Modern preset: upside-down telescopic fork + monoshock on a rising-rate linkage (research 08 §1 preset 2).
 * Same frame, steering geometry and swingarm as the classic; only the mechanisms differ. Inputs are estimates.
 */
import type { MotorcycleSuspensionDefinition } from '../../contracts/suspension';
import { FORK_OFFSET, FORK_RAKE, HEAD_ABOVE_AXLE, REAR_AXLE, steeringPoints, SWINGARM_PIVOT } from './cafe-racer';

export const motoModern: MotorcycleSuspensionDefinition = {
  id: 'moto-modern',
  vehicleClass: 'motorcycle',
  visualKey: 'moto-planar',
  copy: {
    label: 'Modern',
    short: 'Modern',
    descriptor: 'Ters çatal ve artan sertlik oranlı tek amortisör',
    strengths: [
      'Bağlantılardaki büyük çaplı borular, sert frenlemede genellikle daha az esner',
      'Bağlantı mekanizması, arka süspansiyonu hareketin başında yumuşak, sonunda sert yapar',
      'Amortisör ve bağlantı mekanizması şaside alçakta ve merkeze yakın konumlanır',
    ],
    costs: [
      'Diğer teleskopik çatallarla aynı dalma geometrisine sahiptir; frenlemede yine dalar',
      'Genellikle bakım gerektiren daha fazla mafsal ve yatak vardır',
      'Bağlantı mekanizması, salıncağın ve motorun altında yer kaplar',
    ],
    qualitative: { cost: 'medium', packaging: 'medium', complexity: 'medium' },
  },
  front: {
    kind: 'telescopic',
    inverted: true,
    rake: FORK_RAKE,
    offset: FORK_OFFSET,
    steeringHead: steeringPoints(FORK_RAKE, FORK_OFFSET, HEAD_ABOVE_AXLE).head,
    travel: 0.12,
    spring: { rate: 20_000, preload: 450, progression: 0.3 },
    damper: { bump: 1_100, rebound: 2_100 },
    stiction: 45,
    unsprungMass: 15.5,
    stanchionDiameter: 0.043,
  },
  rear: {
    kind: 'swingarm-linkage',
    pivot: SWINGARM_PIVOT,
    axle: [REAR_AXLE[0], 0, REAR_AXLE[1]],
    rockerPivot: [-0.303, 0, 0.227],
    swingarmLink: [-0.326, 0, 0.318],
    rockerLink: [-0.353, 0, 0.253],
    // The shock pair (rockerShock, shockTop) is the original vertical layout turned -30 deg about rockerPivot: a rigid
    // rotation in the plane leaves the motion-ratio curve unchanged and leans the shock forward, clear of the tyre
    // (every point of it stays within 0.21 m of the swingarm pivot; the tyre never comes closer than 0.24 m).
    rockerShock: [-0.3605, 0, 0.3214],
    shockTop: [-0.2028, 0, 0.5745],
    travel: 0.12,
    spring: { rate: 130_000, preload: 1_500, progression: 0 },
    damper: { bump: 7_000, rebound: 14_000 },
    unsprungMass: 19,
  },
};
