/**
 * Classic preset: right-way-up telescopic fork + twin shocks (research 08 §1 preset 1, Bonneville-like numbers).
 * Inputs are estimates; sag, rates, trail and anti-dive are computed by the simulation from this geometry.
 */
import type { MotorcycleSuspensionDefinition } from '../../contracts/suspension';
import { FORK_OFFSET, FORK_RAKE, HEAD_ABOVE_AXLE, REAR_AXLE, steeringPoints, SWINGARM_PIVOT } from './cafe-racer';

export const motoClassic: MotorcycleSuspensionDefinition = {
  id: 'moto-classic',
  vehicleClass: 'motorcycle',
  visualKey: 'moto-planar',
  copy: {
    label: 'Klasik',
    short: 'Klasik',
    descriptor: 'Düz teleskopik çatal ve çift amortisör',
    strengths: [
      'Üretimi ve bakımı genellikle en basit ve en ucuz düzendir',
      'Ön taraf daldıkça iz mesafesi azalır; motosiklet frenleme sırasında genellikle daha kolay viraja girer',
      'Çift amortisör, selenin altındaki alanı boş bırakır',
    ],
    costs: [
      'Dalmayı artırır: fren kuvveti çatalı kendi ekseni boyunca aşağı iter',
      'Kayma yüzeylerindeki ilk hareket sürtünmesi, küçük tümseklere tepkiyi genellikle azaltır',
      'Arka sistem neredeyse doğrusaldır; artan sertlik yalnızca çift kademeli yaydan gelir',
    ],
    qualitative: { cost: 'lower', packaging: 'lower', complexity: 'lower' },
  },
  front: {
    kind: 'telescopic',
    inverted: false,
    rake: FORK_RAKE,
    offset: FORK_OFFSET,
    steeringHead: steeringPoints(FORK_RAKE, FORK_OFFSET, HEAD_ABOVE_AXLE).head,
    travel: 0.12,
    // Both legs together, along the fork axis.
    spring: { rate: 23_000, preload: 380, progression: 0.15 },
    damper: { bump: 1_000, rebound: 1_900 },
    stiction: 60,
    unsprungMass: 16.5,
    stanchionDiameter: 0.041,
  },
  rear: {
    kind: 'swingarm',
    pivot: SWINGARM_PIVOT,
    axle: [REAR_AXLE[0], 0, REAR_AXLE[1]],
    shocks: 2,
    singleSided: false,
    shockTop: [-0.497, 0.12, 0.683],
    shockLower: [-0.62, 0.12, 0.345],
    travel: 0.12,
    spring: { rate: 22_000, preload: 250, dualRate: { rate: 32_000, crossover: 0.032 }, progression: 0 },
    damper: { bump: 950, rebound: 1_900 },
    unsprungMass: 21,
  },
};
