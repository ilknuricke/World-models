/**
 * The proving loop (ARCHITECTURE §7.5, research 11 §C): a designed test track, clockwise, start line at s = 0
 * heading +X. Corner radii, feature sizes, bank angles and target speeds are DESIGN INPUTS for this fictional
 * track, chosen from research ranges (many tagged [M]/[U] there: typical values, not standards).
 * Right turns have negative angles/curvature; bank + = left edge up.
 */
import type { TrackDefinition, TrackPrimitive, TrackProp } from '../../contracts/track';
import { DEG_TO_RAD } from '../../contracts/units';

/**
 * Clothoid-in, arc, clothoid-out corner with net turn `netDeg` (sign = direction). Each clothoid of length lc
 * turns lc / (2 R), so the arc takes the rest.
 */
function corner(radius: number, netDeg: number, lc: number): TrackPrimitive[] {
  const sign = Math.sign(netDeg);
  const k = sign / radius;
  return [
    { kind: 'clothoid', length: lc, k0: 0, k1: k },
    { kind: 'arc', radius, angle: netDeg * DEG_TO_RAD - sign * (lc / radius) },
    { kind: 'clothoid', length: lc, k0: k, k1: 0 },
  ];
}

/** Design vehicle width for the lane-change gates (ISO 3888-1 widths are multiples of it), m. */
const DLC_VEHICLE_WIDTH = 1.95;
const DLC_RUN_UP = 100;
const DLC_OFFSET = 3.5;

/** ISO 3888-1 double lane change: section lengths 15/30/25/25/15/15 m, lane width = factor * W + 0.25 m. */
function dlcCones(): TrackProp[] {
  const gates: [s0: number, len: number, centre: number, factor: number][] = [
    [0, 15, 0, 1.1],
    [45, 25, DLC_OFFSET, 1.2],
    [95, 30, 0, 1.3],
  ];
  const cones: TrackProp[] = [];
  for (const [s0, len, centre, factor] of gates) {
    const half = (factor * DLC_VEHICLE_WIDTH + 0.25) / 2;
    for (const f of [0, 0.5, 1]) {
      const s = DLC_RUN_UP + s0 + f * len;
      cones.push({ kind: 'cone', s, l: centre + half }, { kind: 'cone', s, l: centre - half });
    }
  }
  return cones;
}

/** Driving line offset that puts the right wheels onto the right kerb (half width 4.5 m + about 0.3 m). */
const KERB_CLIP = -4;

export const provingLoop: TrackDefinition = {
  id: 'proving-loop',
  name: 'Test pisti',
  width: 9,
  kerbWidth: 1.5,
  runoff: 12,
  swell: { amplitude: 1.5, cycles: 1 },
  seed: 42,
  visualKey: 'proving-loop',
  closure: ['dlc', 'run-in'],
  segments: [
    {
      id: 'launch',
      name: 'Başlangıç düzlüğü',
      caption: 'Uzun dalgadan kısa dalgaya geçen engebeli zemin, gövde ve tekerlek sıçraması rezonanslarını ortaya çıkarır.',
      primitives: [{ kind: 'line', length: 100 }],
      phenomenon: 'ride-resonance',
      roughness: 'C',
      features: [{ kind: 'washboard', s: 0, length: 80, amplitude: 0.012, wavelength: [3.0, 0.9] }],
      props: [{ kind: 'start-line', s: 0 }],
    },
    {
      id: 'brake-zone',
      name: 'Fren bölgesi',
      caption: 'Düzgün asfaltta sert frenleme, ön tarafın ne kadar daldığını gösterir.',
      primitives: [{ kind: 'line', length: 80 }],
      phenomenon: 'brake-dive',
      roughness: 'A',
    },
    {
      id: 'hairpin',
      name: 'Firkete viraj',
      caption: 'Tam direksiyon açısı, direksiyon geometrisini ortaya çıkarır.',
      primitives: corner(20, -180, 15),
      phenomenon: 'steering-lock',
      roughness: 'B',
      // Research range for hairpins is 30-40 km/h; the upper end keeps the lap inside its 65-85 s design range now
      // that the clothoid transitions make the loop about 140 m longer than the research sketch.
      targetSpeed: 11.1,
    },
    {
      id: 'bump-strip',
      name: 'Engebeli şerit',
      caption: 'Her seferinde tek tekerlek: bir tümsek, bir çukur ve bir bordür darbesi.',
      primitives: [{ kind: 'line', length: 150 }],
      phenomenon: 'single-wheel-bump',
      roughness: 'B',
      targetSpeed: 22,
      features: [
        { kind: 'cosine-bump', s: 40, length: 0.8, height: 0.05, lateral: [0.4, 1.3] },
        { kind: 'pothole', s: 70, l: -0.8, radius: 0.3, depth: 0.06 },
        { kind: 'kerb-strike', s: 100, length: 12, height: 0.06, side: 'right' },
      ],
      line: [
        [72, 0],
        [100, KERB_CLIP],
        [112, KERB_CLIP],
        [145, 0],
      ],
    },
    {
      id: 'sweeper',
      name: 'Uzun viraj',
      caption: 'Uzun, hızlı ve sabit: sürekli gövde yatması ve dış tekerlekte kamber kazanımı.',
      primitives: corner(120, 90, 30),
      phenomenon: 'sustained-roll',
      bank: -3 * DEG_TO_RAD,
      roughness: 'B',
      targetSpeed: 26.7,
    },
    {
      id: 'pave',
      name: 'Parke ve kasisler',
      caption: 'Sertlik hissi için parke taşları; ardından aracı önce öne, sonra arkaya yatıran kasisler.',
      primitives: [{ kind: 'line', length: 100 }],
      phenomenon: 'harshness',
      roughness: 'D',
      targetSpeed: 12.5,
      features: [
        { kind: 'pave', s: 0, length: 45, stone: 0.12, amplitude: 0.008, jointDepth: 0.005 },
        { kind: 'humps', s: 55, count: 3, spacing: 16, length: 3.7, height: 0.08 },
      ],
    },
    {
      id: 'chicane',
      name: 'Şikan',
      caption: 'Sağ, sol, sağ: gövde önce bir yana, sonra diğer yana yatar.',
      primitives: [...corner(38, -30, 8), ...corner(38, 60, 8), ...corner(38, -30, 8)],
      phenomenon: 'roll-reversal',
      roughness: 'B',
      targetSpeed: 15.3,
    },
    {
      id: 'crest',
      name: 'Tepe ve çukur',
      caption: 'Tepede yük hafifler, çukurda artar.',
      primitives: [{ kind: 'line', length: 60 }],
      phenomenon: 'heave',
      roughness: 'B',
      targetSpeed: 19.4,
      // Raised-cosine profile: minimum vertical radius = length^2 / (2 pi^2 |height|), about 130 m here.
      features: [
        { kind: 'vertical-curve', s: 0, length: 30, height: 0.35 },
        { kind: 'vertical-curve', s: 30, length: 30, height: -0.35 },
      ],
    },
    {
      id: 'carousel',
      name: 'Eğimli yarım daire',
      caption: 'Sabit yarıçaplı uzun ve eğimli bir yarım daire: kararlı gövde yatması.',
      primitives: corner(45, -180, 20),
      phenomenon: 'steady-state-roll',
      bank: 8 * DEG_TO_RAD,
      roughness: 'B',
    },
    {
      id: 'dlc',
      name: 'Şerit değiştirme',
      caption: 'Koniler arasında kaçınma amaçlı çift şerit değiştirme.',
      // Length solved by buildTrack so the loop closes.
      primitives: [{ kind: 'line', length: 0 }],
      phenomenon: 'lane-change',
      roughness: 'A',
      targetSpeed: 22.2,
      line: [
        [DLC_RUN_UP, 0],
        [DLC_RUN_UP + 15, 0],
        [DLC_RUN_UP + 45, DLC_OFFSET],
        [DLC_RUN_UP + 70, DLC_OFFSET],
        [DLC_RUN_UP + 95, 0],
        [DLC_RUN_UP + 125, 0],
      ],
      props: dlcCones(),
    },
    {
      id: 'off-camber',
      name: 'Ters eğimli viraj',
      caption: 'Yol virajın dışına eğimlidir; dış tekerlek bu yüzden daha fazla yük taşır.',
      primitives: corner(70, -90, 25),
      phenomenon: 'off-camber',
      bank: -5 * DEG_TO_RAD,
      roughness: 'C',
      targetSpeed: 18,
    },
    {
      id: 'run-in',
      name: 'Bitiş düzlüğü',
      caption: 'Araç bitiş çizgisinden önce dengelenir.',
      // Length solved by buildTrack so the loop closes.
      primitives: [{ kind: 'line', length: 0 }],
      phenomenon: 'settle',
      roughness: 'C',
    },
  ],
};
