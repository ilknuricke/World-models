/**
 * The Race Engineer's fact cards and rule-based answers make comparative claims about the three car suspensions
 * ("highest roll centre", "moves sideways the least", ...). Each claim below is pinned to its wording AND to the
 * ordering the simulation actually produces, so a geometry change that flips an ordering fails here instead of
 * leaving the engineer quietly wrong. Every number is computed from sim-core; nothing is typed in.
 */
import { describe, expect, it } from 'vitest';
import type { AxleId } from '../../src/contracts/units';
import { RAD_TO_DEG, SIM_DT } from '../../src/contracts/units';
import type { SimCatalog } from '../../src/contracts/sim';
import { GT_GEOMETRY } from '../../src/sim-core/content/gt-geometry';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { createSimulation } from '../../src/sim-core/index';
import { createCornerSolution, solveAxleKinematics } from '../../src/sim-core/kinematics/table';
import { COMMON_CAR, SUSPENSION_FACTS } from '../../worker/engineer/facts';
import { ruleAnswer, type RuleTelemetry } from '../../worker/engineer/fallback';

const DEFS = { macpherson, 'double-wishbone': doubleWishbone, multilink } as const;
type Id = keyof typeof DEFS;
const IDS = Object.keys(DEFS) as Id[];
// Same solver options as tests/sim-core/kinematics-gates.test.ts (GT coupe, ARCHITECTURE §7.5).
const CG_HEIGHT = 0.5;
const BRAKE_SHARE = { front: 0.62, rear: 0.38 } as const;
const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };

function axle(id: Id, a: AxleId) {
  const { table, kinematics } = solveAxleKinematics(DEFS[id].axles[a], {
    tyreRadius: GT_GEOMETRY[a].tyreRadius,
    axle: a,
    cgHeight: CG_HEIGHT,
    wheelbase: GT_GEOMETRY.wheelbase,
    brakeShare: BRAKE_SHARE[a],
    ...(a === 'front' ? { maxSteer: 0.35 } : {}),
  });
  const s = createCornerSolution(table);
  const cpY = (t: number) => (table.sample(t, 0, s), s.contactPatch.y);
  const sum = kinematics.summary;
  return {
    gain: Math.abs(sum.camberGain),
    rollCamber: sum.rollCamber,
    rc: sum.rollCentreHeight * 1000,
    rcSideways: Math.abs(sum.rollCentreMigration) * 1000,
    bumpSteer: Math.abs(sum.bumpSteer) * RAD_TO_DEG * 0.01, // deg per 10 mm
    caster: sum.caster * RAD_TO_DEG,
    antiPitch: sum.antiPitch * 100,
    scrubRadius: sum.scrubRadius * 1000,
    scrubOverBump: Math.abs(cpY(0.03) - cpY(0)) * 1000, // track change at +30 mm, mm
  };
}

/** Carousel apex (right-hander: left wheels outside) and the brake zone, from the full simulation. */
function onTrack(id: Id) {
  const sim = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: id, lapTime: 0 });
  const sec = (sid: string) => sim.track.sections.find((s) => s.id === sid)!;
  const carousel = sec('carousel');
  sim.seek(sim.lapTimeAt((carousel.s0 + carousel.s1) / 2));
  let f = sim.sample(1);
  const out = { roll: Math.abs(f.roll * RAD_TO_DEG), camberOF: f.corners[0]!.camber * RAD_TO_DEG, camberOR: f.corners[2]!.camber * RAD_TO_DEG, gripOF: f.corners[0]!.gripUse, brakePitch: 0 };
  const brake = sec('brake-zone');
  sim.seek(sim.lapTimeAt(brake.s0));
  for (let k = 0; k < 4000; k++) {
    sim.step(SIM_DT);
    f = sim.sample(1);
    sim.drainEvents(() => {});
    if (f.sectionId === 'brake-zone') out.brakePitch = Math.max(out.brakePitch, f.pitch * RAD_TO_DEG);
    else if (f.s > brake.s1) break;
  }
  return out;
}

const K = Object.fromEntries(IDS.map((id) => [id, { front: axle(id, 'front'), rear: axle(id, 'rear') }])) as Record<Id, { front: ReturnType<typeof axle>; rear: ReturnType<typeof axle> }>;
const T = Object.fromEntries(IDS.map((id) => [id, onTrack(id)])) as Record<Id, ReturnType<typeof onTrack>>;
const [MP, DW, ML] = ['macpherson', 'double-wishbone', 'multilink'] as const;
/** Ids sorted by a value, largest first. */
const rank = (v: (id: Id) => number) => [...IDS].sort((a, b) => v(b) - v(a));
const bothAxles = (v: (a: ReturnType<typeof axle>) => number) => (['front', 'rear'] as const).map((a) => rank((id) => v(K[id][a])));
const spread = (v: (id: Id) => number) => Math.max(...IDS.map(v)) - Math.min(...IDS.map(v));

describe('measured values behind the Race Engineer claims', () => {
  it('prints them', () => {
    const r = (x: number) => Number(x.toFixed(3));
    console.info(JSON.stringify({ K, T }, (_k, v: unknown) => (typeof v === 'number' ? r(v) : v), 1));
    for (const id of IDS) for (const v of Object.values(T[id])) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('fact cards agree with the simulation', () => {
  const card = (id: Id) => SUSPENSION_FACTS[id]!;

  it('roll centre: strut highest, multi-link lowest, wishbone in the middle (both axles)', () => {
    expect(card(MP)).toMatch(/highest roll centre of the three/);
    expect(card(DW)).toMatch(/roll centre is in the middle of the three/);
    expect(card(ML)).toMatch(/lowest roll centre of the three/);
    for (const order of bothAxles((a) => a.rc)) expect(order).toEqual([MP, DW, ML]);
  });

  it('roll-centre sideways movement: strut most, multi-link least (both axles)', () => {
    expect(card(MP)).toMatch(/roll centre moves a long way/);
    expect(card(DW)).toMatch(/moves sideways much less than the strut's/);
    expect(card(ML)).toMatch(/roll centre moves sideways the least/);
    for (const order of bothAxles((a) => a.rcSideways)) expect(order).toEqual([MP, DW, ML]);
  });

  it('camber gain in bump: wishbone most, strut least, multi-link between (both axles); wheel lean per roll the reverse', () => {
    expect(card(MP)).toMatch(/adds the least camber in bump/);
    expect(card(DW)).toMatch(/adds the most negative camber in bump/);
    expect(card(ML)).toMatch(/lie between the strut and the double wishbone/);
    for (const order of bothAxles((a) => a.gain)) expect(order).toEqual([DW, ML, MP]);
    for (const order of bothAxles((a) => a.rollCamber)) expect(order).toEqual([MP, ML, DW]);
  });

  it('body roll at the carousel: strut slightly least, multi-link slightly most, all within a tenth of a degree or so', () => {
    expect(COMMON_CAR).toMatch(/the strut, with the highest roll centre, rolls slightly the least and the multi-link slightly the most/);
    expect(card(ML)).toMatch(/body rolls a tiny bit more/);
    expect(rank((id) => T[id].roll)).toEqual([ML, DW, MP]);
    expect(spread((id) => T[id].roll)).toBeLessThan(0.2);
  });

  it('carousel outside front: wishbone flattest, strut close to the multi-link, all differences small', () => {
    expect(card(MP)).toMatch(/strut front has the most caster/);
    expect(rank((id) => K[id].front.caster)[0]).toBe(MP);
    expect(card(MP)).toMatch(/outside front ends up close to the multi-link/);
    expect(card(DW)).toMatch(/at the front, at true scale, it is small/);
    expect(COMMON_CAR).toMatch(/Differences in outside-front camber are small/);
    // Most negative first: the wishbone keeps the most camber, the strut the least.
    expect(rank((id) => -T[id].camberOF)).toEqual([DW, ML, MP]);
    expect(Math.abs(T[MP].camberOF - T[ML].camberOF)).toBeLessThan(0.15);
    expect(spread((id) => T[id].camberOF)).toBeLessThan(0.3); // below the 0.3 deg visibility threshold
  });

  it('carousel outside rear: strut clearly loses the most, wishbone the least, and that is the clearest gap', () => {
    expect(card(MP)).toMatch(/rear, which does not steer, loses clearly the most outside camber/);
    expect(card(DW)).toMatch(/clearest at the rear in long corners/);
    expect(COMMON_CAR).toMatch(/outside-rear camber in long corners/);
    expect(rank((id) => T[id].camberOR)).toEqual([MP, ML, DW]);
    expect(spread((id) => T[id].camberOR)).toBeGreaterThan(2 * spread((id) => T[id].camberOF));
  });

  it('anti-dive: strut most at the front; brake pitch differs only a tiny amount', () => {
    expect(card(MP)).toMatch(/most anti-dive here, but brake pitch differs only a tiny amount/);
    expect(rank((id) => K[id].front.antiPitch)[0]).toBe(MP);
    expect(spread((id) => T[id].brakePitch)).toBeLessThan(0.2);
  });

  it('bump steer is tuned to almost nothing on every type', () => {
    expect(card(ML)).toMatch(/all three types were tuned to almost no bump steer/);
    for (const id of IDS) for (const a of ['front', 'rear'] as const) expect(K[id][a].bumpSteer).toBeLessThan(0.05);
  });

  it('sideways tyre scrub over bumps: strut most, wishbone next, multi-link least (both axles)', () => {
    expect(card(DW)).toMatch(/tyre scrubs sideways more than the multi-link's, though less than the strut's/);
    for (const order of bothAxles((a) => a.scrubOverBump)) expect(order).toEqual([MP, DW, ML]);
  });

  it('strut: the largest scrub radius at the front (wide tyres and a small scrub radius are hard to combine)', () => {
    expect(card(MP)).toMatch(/harder to combine wide tyres with a small scrub radius/);
    expect(rank((id) => K[id].front.scrubRadius)[0]).toBe(MP);
  });

  it('grip use at the carousel differs only a little', () => {
    expect(COMMON_CAR).toMatch(/differences in body roll, brake pitch, bump steer and grip use are tiny/);
    expect(spread((id) => T[id].gripOF)).toBeLessThan(0.05);
  });
});

describe('rule-based answers agree with the simulation', () => {
  const tel = (suspension: Id): RuleTelemetry => ({
    vehicle_class: 'car',
    suspension,
    section_name: 'Carousel',
    speed_kmh: 71,
    lat_g: -0.85,
    long_g: 0,
    roll_deg: -1.26,
    pitch_deg: 0,
    corners: { fl: { camber_deg: -0.72, travel_mm: 21 } },
  });
  const roll = (id: Id) => ruleAnswer('why?', 'steady-state-roll', tel(id));

  it('roll clauses: strut gives up the most rear camber, wishbone flattest, multi-link between', () => {
    expect(roll(MP)).toMatch(/arka aksta üç tür arasında en fazla kamber kaybı bundadır/);
    expect(rank((id) => T[id].camberOR)[0]).toBe(MP);
    expect(roll(DW)).toMatch(/lastik üç tür arasında yola en düz basan konumda kalır/);
    expect(rank((id) => -T[id].camberOF)[0]).toBe(DW);
    expect(rank((id) => -T[id].camberOR)[0]).toBe(DW);
    expect(roll(ML)).toMatch(/MacPherson ile çift salıncak arasındadır/);
    for (const order of bothAxles((a) => a.gain)) expect(order[1]).toBe(ML);
  });

  it('brake-dive: the difference between the types is tiny', () => {
    expect(ruleAnswer('why?', 'brake-dive', { ...tel(MP), long_g: -0.9, pitch_deg: 1.2 })).toMatch(/türler arasındaki fark çok küçüktür/);
    expect(spread((id) => T[id].brakePitch)).toBeLessThan(0.2);
  });

  it('roll-centre glossary: a higher roll centre rolls a little less (strut highest RC, least roll)', () => {
    expect(ruleAnswer('Yalpa merkezi nedir?', undefined, tel(MP))).toMatch(/yükseldikçe .* gövde biraz daha az yatar/);
    expect(rank((id) => T[id].roll).at(-1)).toBe(rank((id) => K[id].front.rc)[0]);
  });

  it('never crowns a winner', () => {
    expect(ruleAnswer('Hangi süspansiyon en iyi?', undefined, tel(DW))).toMatch(/Her koşulda en iyi olan bir tür yoktur/);
    expect(COMMON_CAR).toMatch(/No suspension type is best overall/);
  });
});
