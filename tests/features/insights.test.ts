/** Insight rules, rate limiting, hysteresis, templates and the same-spot delta chip (2- and 4-corner frames). */
import { describe, expect, it } from 'vitest';
import { createTelemetryFrame, type CornerLayout, type TelemetryFrame } from '../../src/contracts/telemetry';
import { G, SIM_DT } from '../../src/contracts/units';
import { computeDelta, deltaMetric, formatDelta, LapRecord } from '../../src/features/insights/lap-record';
import { compose, fill, InsightEngine, MIN_GAP_S, onSection, RULE_COOLDOWN_S, RULES } from '../../src/features/insights/rules';
import { createSimulation } from '../../src/sim-core/index';
import { deg, fmt } from '../../src/ui/format';

const CAR: CornerLayout[] = [
  { id: 'fl', axle: 'front', side: 1 },
  { id: 'fr', axle: 'front', side: -1 },
  { id: 'rl', axle: 'rear', side: 1 },
  { id: 'rr', axle: 'rear', side: -1 },
];
const MOTO: CornerLayout[] = [
  { id: 'f', axle: 'front', side: 0 },
  { id: 'r', axle: 'rear', side: 0 },
];

function frame(layout: CornerLayout[], set: Partial<Pick<TelemetryFrame, 'ay' | 'ax' | 'roll' | 'pitch' | 's'>> = {}): TelemetryFrame {
  const t = Object.assign(createTelemetryFrame(layout.length === 2 ? 'motorcycle' : 'car', layout), set);
  t.corners.forEach((c, i) => {
    c.camber = -0.03 - 0.001 * i;
    c.travel = 0.004 * i;
    c.load = 3000 + 500 * i;
  });
  t.axles[0]!.rollCentreHeight = layout.length === 2 ? Number.NaN : 0.08;
  t.axles[1]!.rollCentreHeight = layout.length === 2 ? Number.NaN : 0.06;
  return t;
}
const lat = (g: number) => g * G;

describe('templates', () => {
  const texts = RULES.flatMap((r) => [r.text, r.chip ?? '']);

  it('contain no digits (numbers come from the frame only)', () => {
    expect(texts.filter((t) => /\d/.test(t))).toEqual([]);
  });

  it('never rank or name a suspension type', () => {
    expect(texts.filter((t) => /best|better|worse|superior|macpherson|strut|wishbone|multi-?link/i.test(t))).toEqual([]);
  });

  it('are one short line (at most twelve words)', () => {
    expect(RULES.filter((r) => r.text.split(/\s+/).length > 12).map((r) => r.id)).toEqual([]);
  });

  it('fill every placeholder from TRUE frame values via format.ts', () => {
    const t = frame(CAR, { roll: -0.03, pitch: 0.01 });
    for (const r of RULES) {
      const i = compose(r, t, 2);
      expect(`${i.text} ${i.chip}`).not.toMatch(/[{}]/);
    }
    expect(fill('Roll {roll}', t, 0)).toBe(`Roll ${fmt(Math.abs(deg(-0.03)), 1)}°`);
    expect(fill('The {wheel} wheel, {corner} {camber}', t, 2)).toBe(`The sol arka wheel, SA ${fmt(deg(-0.032), 1)}°`);
    expect(fill('Roll centre front {rcFront} · rear {rcRear}', t, 0)).toBe('Roll centre front 80 mm · rear 60 mm');
  });
});

describe('InsightEngine', () => {
  it('fires a section rule only after the signal is sustained, then respects the global gap', () => {
    const e = new InsightEngine();
    const t = frame(CAR, { ay: lat(0.6), roll: 0.02 });
    expect(e.tick(t, 'steady-state-roll', 0)).toBeNull();
    expect(e.tick(t, 'steady-state-roll', 0.5)).toBeNull();
    const first = e.tick(t, 'steady-state-roll', 0.7);
    expect(first?.id).toBe('roll');
    expect(first?.chip).toBe(`Yatma ${fmt(deg(0.02), 1)}°`);
    expect(e.tick(t, 'steady-state-roll', 0.7 + MIN_GAP_S - 0.1)).toBeNull();
    expect(e.tick(t, 'steady-state-roll', 0.71 + MIN_GAP_S)?.id).toBe('outer-camber');
  });

  it('ignores rules of other phenomena and re-arms only below the hysteresis band', () => {
    const e = new InsightEngine(RULES.filter((r) => r.id === 'brake-dive'));
    const hard = frame(CAR, { ax: -0.7 * G });
    expect(e.tick(hard, 'steady-state-roll', 0)).toBeNull();
    e.tick(hard, 'brake-dive', 0);
    expect(e.tick(hard, 'brake-dive', 0.4)?.id).toBe('brake-dive');
    const later = 0.4 + RULE_COOLDOWN_S + 1;
    e.tick(frame(CAR, { ax: -0.45 * G }), 'brake-dive', later); // dips into the band, not below: still disarmed
    e.tick(hard, 'brake-dive', later + 0.1);
    expect(e.tick(hard, 'brake-dive', later + 1)).toBeNull();
    e.tick(frame(CAR, { ax: 0 }), 'brake-dive', later + 2); // below the band: re-armed
    e.tick(hard, 'brake-dive', later + 3);
    expect(e.tick(hard, 'brake-dive', later + 3.4)?.id).toBe('brake-dive');
  });

  it('fires the roll-reversal rule on a sign flip of lateral acceleration', () => {
    const e = new InsightEngine(RULES.filter((r) => r.id === 'roll-reversal'));
    expect(e.tick(frame(CAR, { ay: lat(0.5) }), 'roll-reversal', 0)).toBeNull();
    expect(e.tick(frame(CAR, { ay: lat(0.1) }), 'roll-reversal', 0.5)).toBeNull();
    expect(e.tick(frame(CAR, { ay: lat(-0.5) }), 'roll-reversal', 1)?.id).toBe('roll-reversal');
  });

  it('describes the corner an event names, in amber', () => {
    const e = new InsightEngine();
    const i = e.event({ kind: 'liftoff', corner: 3 }, frame(CAR), 0);
    expect(i).toMatchObject({ id: 'liftoff', warn: true, text: 'sağ arka tekerlek hafifler: üzerinde neredeyse hiç yük yoktur.', chip: 'Yük SĞA 4.5 kN' });
    expect(e.event({ kind: 'grip-limit', corner: 0 }, frame(CAR), 1)).toBeNull(); // global gap
    expect(e.event({ kind: 'section', index: 1, id: 'x' }, frame(CAR), 20)).toBeNull();
  });

  it('2-corner frame: two-track rules stay quiet, lean / fork dive / squat speak, events and vertical rules work', () => {
    const e = new InsightEngine();
    const t = frame(MOTO, { ay: lat(0.8) });
    const said: string[] = [];
    for (let k = 0; k < 40; k++) {
      const i = e.tick(t, 'steady-state-roll', k * 0.1);
      if (i) said.push(i.id);
    }
    expect(said).toEqual(['lean']);
    expect(e.event({ kind: 'bump-stop', corner: 1 }, t, 10)?.text).toBe('arka tekerlek darbe takozuna dayandı.');
    const brake = frame(MOTO, { ax: -0.8 * G });
    brake.corners[0]!.travel = 0.05;
    brake.trail = 0.0735;
    const de = new InsightEngine();
    expect(de.tick(brake, 'brake-dive', 0)).toBeNull(); // sustain
    expect(de.tick(brake, 'brake-dive', 0.5)).toMatchObject({ id: 'fork-dive', chip: 'Ön hareket +50 mm · iz mesafesi 74 mm · öne yatma ' + fmt(Math.abs(deg(brake.pitch)), 1) + '°' });
    const power = frame(MOTO, { ax: 0.3 * G });
    power.corners[1]!.travel = -0.004;
    power.axles[1]!.antiPitch = 1.27;
    const se = new InsightEngine();
    se.tick(power, 'ride-resonance', 0);
    expect(se.tick(power, 'ride-resonance', 0.6)).toMatchObject({ id: 'squat', chip: 'Arka hareket −4 mm · çökmeye direnç 127%' });
    const bump = frame(MOTO);
    bump.corners[0]!.travel = 0.04;
    expect(e.tick(bump, 'single-wheel-bump', 30)?.chip).toBe('Hareket ön +40 mm');
  });
});

describe('while driving (Manual)', () => {
  it('quiet outside Auto: no section captions anywhere and no event captions (the coach explains the driven car)', () => {
    const e = new InsightEngine();
    const t = frame(CAR, { ay: lat(0.6), roll: 0.02 });
    for (const mode of ['manual', 'returning', 'replay'] as const) {
      t.drive.mode = mode;
      for (const zone of ['loop', 'terrain', 'dynamics-pad']) {
        t.drive.zone = zone;
        expect(onSection(t)).toBe(false);
        for (let k = 0; k <= 30; k++) expect(e.tick(t, 'steady-state-roll', k * 0.1)).toBeNull();
        expect(e.event({ kind: 'liftoff', corner: 1 } as never, t, 100)).toBeNull();
        expect(e.event({ kind: 'bump-stop', corner: 0 } as never, t, 200)).toBeNull();
      }
    }
    t.drive.mode = 'auto';
    expect(onSection(t)).toBe(true);
    expect(e.tick(t, 'steady-state-roll', 10)).toBeNull(); // sustain restarts in Auto
    expect(e.tick(t, 'steady-state-roll', 10.7)?.id).toBe('roll');
    expect(e.event({ kind: 'liftoff', corner: 1 } as never, t, 10.7 + MIN_GAP_S)?.id).toBe('liftoff');
  });

  it('no same-place delta and no lap record from a driven car', () => {
    const rec = new LapRecord(4, 100, 100);
    const driven = frame(CAR, { s: 30 });
    driven.drive.mode = 'manual';
    rec.write('a', driven);
    expect(Number.isNaN(rec.value('a', 30, 'camber', 0))).toBe(true);
    rec.write('a', frame(CAR, { s: 30 }));
    const b = frame(CAR, { s: 30 });
    expect(computeDelta(rec, 'a', b, 'steady-state-roll', null)).not.toBeNull();
    b.drive.mode = 'manual';
    expect(computeDelta(rec, 'a', b, 'steady-state-roll', 30)).toBeNull();
  });
});

describe('delta chip', () => {
  it('compares the previous suspension at the same track position and reports the most changed corner', () => {
    const rec = new LapRecord(4, 100, 100);
    const a = frame(CAR, { s: 30 });
    rec.write('a', a);
    const b = frame(CAR, { s: 30 });
    b.corners[2]!.camber -= 0.01;
    const d = computeDelta(rec, 'a', b, 'steady-state-roll', null);
    expect(d).toMatchObject({ metric: 'camber', corner: 2 });
    expect(d!.after - d!.before).toBeCloseTo(-0.01);
    expect(formatDelta(d!, 'RL')).toEqual({ label: 'Kamber RL', before: fmt(deg(-0.032), 1) + '°', after: fmt(deg(-0.042), 1) + '°' });
  });

  it('falls back to the value just before the swap only in a steady section', () => {
    const rec = new LapRecord(4, 100, 100);
    rec.write('a', frame(CAR, { s: 30 }));
    const later = frame(CAR, { s: 50 });
    expect(computeDelta(rec, 'a', later, 'roll-reversal', 30)).toBeNull();
    expect(computeDelta(rec, 'a', later, 'steady-state-roll', 30)).not.toBeNull();
    expect(computeDelta(rec, 'a', later, 'steady-state-roll', null)).toBeNull();
  });

  it('picks the section quantity: pitch under braking, travel over bumps, camber elsewhere', () => {
    expect(deltaMetric('brake-dive')).toBe('pitch');
    expect(deltaMetric('heave')).toBe('travel');
    expect(deltaMetric('lane-change')).toBe('camber');
    const rec = new LapRecord(2, 100, 100);
    rec.write('a', frame(MOTO, { s: 5, pitch: 0.01 }));
    expect(computeDelta(rec, 'a', frame(MOTO, { s: 5, pitch: 0.02 }), 'brake-dive', null)).toMatchObject({ metric: 'pitch', corner: -1, before: expect.closeTo(0.01, 6) });
  });

  it('real simulation: a carousel swap yields a same-lap comparison of TRUE camber', () => {
    const sim = createSimulation({
      catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined },
      trackId: 'proving-loop',
      vehicleId: 'gt-coupe',
      suspensionId: 'macpherson',
    });
    const carousel = sim.track.sections.find((s) => s.def.phenomenon === 'steady-state-roll')!;
    sim.seek(sim.lapTimeAt((carousel.s0 + carousel.s1) / 2) - 2);
    const rec = new LapRecord(4, sim.track.length);
    const run = (seconds: number) => {
      for (let i = 0; i < seconds / SIM_DT; i++) {
        sim.step(SIM_DT);
        if (i % 4 === 0) rec.write(sim.suspension.id, sim.sample(1));
      }
    };
    run(1);
    const swapS = sim.sample(1).s;
    sim.setSuspension('double-wishbone');
    run(1);
    const t = sim.sample(1, 2.5); // amplified pose: the chip still reads TRUE values
    expect(t.sectionIndex).toBe(carousel.index);
    const d = computeDelta(rec, 'macpherson', t, 'steady-state-roll', swapS)!;
    expect(d.metric).toBe('camber');
    expect(d.after).toBe(t.corners[d.corner]!.camber);
    expect(Math.abs(d.after - d.before)).toBeGreaterThan(0);
    const e = new InsightEngine();
    let shown = 0;
    for (let k = 0; k < 20; k++) if (e.tick(t, 'steady-state-roll', k * 0.5)) shown++;
    expect(shown).toBe(2); // roll, then camber 8 s later; the roll-centre rule waits for the gap
  });
});
