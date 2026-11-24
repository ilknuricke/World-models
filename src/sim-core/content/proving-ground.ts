/**
 * The proving-ground annex beside the proving loop (ARCHITECTURE-M2 §8.3, research m2/11): a dynamics pad (steering
 * circle, slalom, ISO 3888-2 lane change), a ride street (washboard, cobbles, sleepers, single-wheel steps, twist,
 * pothole), a braking platform (dry, wet, split and low-grip lanes) and two spurs joining the loop. World metres, X east,
 * Y north; rect zones start at the centre of their start edge; headings in radians.
 * Sourced [S]: the ISO 3888-2 section lengths, lane offset and gate-width formulas (ISO 3888-2:2011); the braking lane
 * width 4.5 m (AVL ZalaZONE); wet ceramic tiles about a tenth of dry grip (Nardo, AVL, AARC: contracts/world.ts SURFACES).
 * Estimates [E] (design inputs of this fictional ground, scaled down for a keyboard driver): the circle radius, the
 * slalom spacing, every ride-street amplitude and spacing, the platform lengths, the wet-asphalt and the remaining surface
 * grip factors. The copy below calls the grip "approximate" and never ranks a suspension type.
 */
import type { RoadFeature, TrackPrimitive } from '../../contracts/track';
import type { StationDefinition, WorldDefinition, WorldProp, ZoneDefinition } from '../../contracts/world';

const DEG = Math.PI / 180;
/** Annex base height, m. */
const Z = 0.5;

/** Spur corner: clothoid 15 m into R 25 m, arc, clothoid out; net +90 deg (left). The arc takes pi/2 - 2 * 15 / (2 * 25). */
const SPUR_R = 25;
const SPUR_CLOTHOID = 15;
const SPUR_LINE = 18.649;
const spurCorner: TrackPrimitive[] = [
  { kind: 'clothoid', length: SPUR_CLOTHOID, k0: 0, k1: 1 / SPUR_R },
  { kind: 'arc', radius: SPUR_R, angle: Math.PI / 2 - SPUR_CLOTHOID / SPUR_R },
  { kind: 'clothoid', length: SPUR_CLOTHOID, k0: 1 / SPUR_R, k1: 0 },
];

/** Design vehicle width W for the lane-change gates (the loop's ISO 3888-1 gates use the same), m. */
const W = 1.95;
/** ISO 3888-2 lane: start x and centre line y of the entry lane. */
const LANE_X0 = -120;
const LANE_Y = 400;

/** ISO 3888-2 cones: sections 1, 3 and 5 (12, 11 and 12 m long), gate widths 1.1W+0.25, W+1, max(1.3W+0.25, 3);
 *  the offset lane is shifted left by half the entry width + 1 m + half its own width. Cones at both edges at each
 *  section's start, middle and end (18). */
function laneChangeCones(): WorldProp[] {
  const entry = 1.1 * W + 0.25;
  const offset = W + 1;
  const exit = Math.max(1.3 * W + 0.25, 3);
  const gates: [x0: number, len: number, centre: number, width: number][] = [
    [0, 12, LANE_Y, entry],
    [25.5, 11, LANE_Y + entry / 2 + 1 + offset / 2, offset],
    [49, 12, LANE_Y, exit],
  ];
  const cones: WorldProp[] = [];
  for (const [x0, len, centre, width] of gates)
    for (const f of [0, 0.5, 1]) {
      const x = LANE_X0 + x0 + f * len;
      cones.push({ kind: 'cone', x, y: centre + width / 2 }, { kind: 'cone', x, y: centre - width / 2 });
    }
  return cones;
}

/** Slalom: seven cones on y = 280, 25 m apart. */
const slalomCones = (): WorldProp[] => [-90, -65, -40, -15, 10, 35, 60].map((x) => ({ kind: 'cone', x, y: 280 }));

const rideStreetFeatures: RoadFeature[] = [
  { kind: 'washboard', s: 20, length: 60, amplitude: 0.025, wavelength: [1.8, 1.8] },
  { kind: 'pave', s: 100, length: 60, stone: 0.15, amplitude: 0.012, jointDepth: 0.008 },
  { kind: 'humps', s: 180, count: 8, spacing: 5, length: 0.3, height: 0.03 },
  { kind: 'cosine-bump', s: 235, length: 0.6, height: 0.04, lateral: [0.3, 2.0] },
  { kind: 'cosine-bump', s: 250, length: 0.6, height: 0.08, lateral: [-2.0, -0.3] },
  { kind: 'cosine-bump', s: 265, length: 3, height: 0.06, lateral: [0.3, 2.0] },
  { kind: 'cosine-bump', s: 271, length: 3, height: 0.06, lateral: [-2.0, -0.3] },
  { kind: 'cosine-bump', s: 277, length: 3, height: 0.06, lateral: [0.3, 2.0] },
  { kind: 'cosine-bump', s: 283, length: 3, height: 0.06, lateral: [-2.0, -0.3] },
  { kind: 'pothole', s: 293, l: 0.8, radius: 0.3, depth: 0.05 },
];

const zones: ZoneDefinition[] = [
  {
    id: 'spur-east',
    name: 'Doğu bağlantı yolu',
    shape: { kind: 'path', x: 85, y: 8.5, heading: 0, primitives: [...spurCorner, { kind: 'line', length: SPUR_LINE }], width: 8 },
    surface: 'asphalt',
    // z0 = the loop's base where the spur leaves it (swell at s 85); ground.ts follows the loop near it anyway
    z: [0.477, Z],
    roughness: 'A',
    priority: 4,
  },
  {
    id: 'spur-west',
    name: 'Batı bağlantı yolu',
    shape: { kind: 'path', x: -60, y: 60, heading: -90 * DEG, primitives: [{ kind: 'line', length: SPUR_LINE }, ...spurCorner], width: 8 },
    surface: 'asphalt',
    z: [Z, -0.155],
    roughness: 'A',
    priority: 4,
  },
  { id: 'apron', name: 'Padok', shape: { kind: 'rect', x: 40, y: 60, heading: 90 * DEG, length: 40, width: 260 }, surface: 'asphalt', z: Z, roughness: 'A', priority: 2 },
  { id: 'street-link', name: 'Test yolu bağlantısı', shape: { kind: 'rect', x: 60, y: 100, heading: 90 * DEG, length: 28, width: 10 }, surface: 'asphalt', z: Z, roughness: 'A', priority: 2 },
  {
    id: 'ride-street',
    name: 'Konfor test yolu',
    shape: { kind: 'rect', x: -240, y: 124, heading: 0, length: 300, width: 8 },
    surface: 'asphalt',
    z: Z,
    roughness: 'B',
    features: rideStreetFeatures,
    patches: [{ u: [100, 160], w: [-4, 4], surface: 'pave' }],
    priority: 3,
  },
  { id: 'dynamics-pad', name: 'Dinamik test alanı', shape: { kind: 'rect', x: -80, y: 240, heading: 90 * DEG, length: 190, width: 320 }, surface: 'asphalt', z: Z, roughness: 'A', priority: 2 },
  { id: 'pad-link', name: 'Test alanı bağlantısı', shape: { kind: 'rect', x: -80, y: 128, heading: 90 * DEG, length: 112, width: 10 }, surface: 'asphalt', z: Z, roughness: 'A', priority: 2 },
  {
    id: 'braking-platform',
    name: 'Fren test alanı',
    shape: { kind: 'rect', x: 147.5, y: 100, heading: 90 * DEG, length: 330, width: 35 },
    surface: 'asphalt',
    z: Z,
    roughness: 'A',
    // lanes 4.5 m wide (w + west): dry | wet asphalt | split (west half wet tiles, east half dry) | wet tiles
    patches: [
      { u: [160, 260], w: [0, 4.5], surface: 'asphalt-wet' },
      { u: [160, 260], w: [-2.25, 0], surface: 'ceramic-wet' },
      { u: [160, 260], w: [-9, -4.5], surface: 'ceramic-wet' },
    ],
    priority: 3,
  },
];

const stations: StationDefinition[] = [
  {
    id: 'ride-street',
    name: 'Konfor test yolu',
    caption: 'Dalgalı zemin, parke taşı, enine takozlar ve tek tekerlekli basamaklar: gövdeyi ve her tekerleği izleyin.',
    experiment: 'Yolu sabit hızla geçin, ardından süspansiyonu değiştirip yeniden sürün.',
    zone: 'ride-street',
    spawn: { x: -230, y: 124, heading: 0 },
    phenomenon: 'harshness',
    suspension: true,
  },
  {
    id: 'steering-pad',
    name: 'Dairesel sürüş',
    caption: 'Sabit viraj için çizilmiş bir daire: gövdenin yatması ve yük taşıyan dış tekerlekler.',
    experiment: 'Daireyi sabit hızla dönün; ardından süspansiyonu değiştirip dış tekerlekleri izleyin.',
    zone: 'dynamics-pad',
    spawn: { x: -130, y: 335, heading: 90 * DEG },
    phenomenon: 'steady-state-roll',
    suspension: true,
  },
  {
    id: 'slalom',
    name: 'Slalom',
    caption: 'Sıralı koniler: gövde önce bir yana, sonra diğer yana yatar.',
    experiment: 'Koniler arasında düşük hızla zikzak çizin ve gövdenin yatma yönünü izleyin.',
    zone: 'dynamics-pad',
    spawn: { x: -170, y: 280, heading: 0 },
    phenomenon: 'roll-reversal',
    suspension: true,
  },
  {
    id: 'lane-change',
    name: 'Şerit değiştirme',
    caption: 'Konilerle işaretlenmiş kaçınma manevrası: hızla yana çıkıp geri dönün.',
    experiment: 'Orta hızla girin, kapılardan geçerek yön değiştirin ve gövdenin dengelenmesini izleyin.',
    zone: 'dynamics-pad',
    spawn: { x: -200, y: 400, heading: 0 },
    phenomenon: 'lane-change',
    suspension: true,
  },
  {
    id: 'braking-platform',
    name: 'Fren test alanı',
    caption: 'Tutunma değerleri yaklaşık olan kuru, ıslak ve çok kaygan şeritler. Bu deney süspansiyon yerine lastik tutunmasını gösterir.',
    experiment: 'Bir taraf kaygan karolar üzerindeyken sert fren yapın ve aracın dönme eğilimini izleyin.',
    zone: 'braking-platform',
    spawn: { x: 149.75, y: 110, heading: 90 * DEG },
    phenomenon: 'split-mu',
    suspension: false,
  },
];

/** Station sign 6 m ahead and 6 m to the right of the spawn, facing it (heading + 135 deg). */
const signs = (): WorldProp[] =>
  stations.map((st) => {
    const { x, y, heading } = st.spawn;
    // exact for the spawn headings used here (multiples of 90 deg): ahead (c, s), right (s, -c)
    const c = quarterCos(heading);
    const s = quarterCos(heading - Math.PI / 2);
    return { kind: 'sign', x: x + 6 * c + 6 * s, y: y + 6 * s - 6 * c, heading: heading + (3 * Math.PI) / 4, station: st.id };
  });

/** cos of a multiple of a quarter turn (no transcendental call). */
function quarterCos(a: number): number {
  const q = (((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  return [1, 0, -1, 0][q]!;
}

export const provingGround: WorldDefinition = {
  id: 'proving-ground',
  trackId: 'proving-loop',
  name: 'Test alanı',
  zones,
  stations,
  props: [{ kind: 'circle', x: -170, y: 335, radius: 40 }, ...slalomCones(), ...laneChangeCones(), ...signs()],
  field: { minX: -260, minY: 60, maxX: 300, maxY: 440, z: Z, blend: 30 },
};
