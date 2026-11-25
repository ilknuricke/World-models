/** Pure helpers of the browser panel (src/features/engineer/snapshot.ts), checked against the worker's schema. */
import { describe, expect, it } from 'vitest';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import { G } from '../../src/contracts/units';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { ruleAnswer } from '../../src/features/engineer/rules';
import { buildTelemetry, CHIPS, chipsFor, eventLabel, SnapshotRing } from '../../src/features/engineer/snapshot';
import { ungroundedNumbers } from '../../worker/engineer/numbers';
import { engineerRequestSchema } from '../../worker/schemas/engineer';

const IDS = ['fl', 'fr', 'rl', 'rr'];
function carFrame(set: (t: TelemetryFrame) => void): TelemetryFrame {
  const t = createTelemetryFrame('car', [
    { id: 'fl', axle: 'front', side: 1 },
    { id: 'fr', axle: 'front', side: -1 },
    { id: 'rl', axle: 'rear', side: 1 },
    { id: 'rr', axle: 'rear', side: -1 },
  ]);
  t.speed = 19.7;
  for (const c of t.corners) c.load = 4000;
  set(t);
  return t;
}
const summary = { camberGain: -0.0227, rollCamber: 0.82, bumpSteer: 0, rollCentreHeight: 0.107, rollCentreMigration: 0.3, kingpinInclination: 0.22, caster: 0.12, scrubRadius: 0.02, trail: 0.017, antiPitch: 0.301, motionRatio: 0.94 };
const ctx = { vehicleClass: 'car' as const, vehicleId: 'gt-coupe', suspensionId: 'macpherson', sectionId: 'carousel', sectionName: 'Carousel', summaries: { front: summary, rear: { ...summary, kingpinInclination: Number.NaN } } };

describe('snapshot ring', () => {
  it('copies frames into preallocated slots and finds the most eventful one in the window', () => {
    const ring = new SnapshotRing(5, IDS);
    const calm = carFrame(() => {});
    const corner = carFrame((t) => (t.ay = -0.85 * G));
    for (let i = 0; i < 7; i++) ring.push(i === 5 ? corner : calm, i * 0.1);
    const slots = new Set<object>();
    for (let i = 0; i < 10; i++) {
      ring.push(calm, 1 + i * 0.1);
      slots.add(ring.latest()!);
    }
    expect(slots.size).toBe(5); // identity-stable slots, no allocation per push
    ring.push(corner, 2.5);
    ring.push(calm, 2.6);
    expect(ring.peak(2.0)!.ay).toBeCloseTo(-0.85 * G);
    expect(ring.peak(99)).toBe(ring.latest()); // empty window -> latest
  });
});

function motorcycleTelemetry(suspensionId = 'moto-classic') {
  const frame = createTelemetryFrame('motorcycle', [
    { id: 'f', axle: 'front', side: 0 },
    { id: 'r', axle: 'rear', side: 0 },
  ]);
  frame.speed = 16;
  frame.ay = -0.7 * G;
  frame.roll = -0.5;
  frame.corners.forEach((corner, i) => { corner.load = 1800 - i * 200; corner.travel = 0.012 - i * 0.02; });
  frame.axles.forEach((axle) => { axle.rollCentreHeight = Number.NaN; });
  const ring = new SnapshotRing(1, ['f', 'r']);
  ring.push(frame, 0);
  return buildTelemetry(ring.latest()!, ring.cornerIds, { ...ctx, vehicleClass: 'motorcycle', vehicleId: 'cafe-racer', suspensionId, summaries: undefined });
}

describe('motorcycle engineer context', () => {
  const carOnly = /MacPherson|çift salıncak|çok bağlantılı|sol ön|sağ ön|sol arka|sağ arka/i;

  it('offers bike questions for every section while preserving car questions', () => {
    for (const section of provingLoop.segments) {
      expect(chipsFor(section.phenomenon, 'car')).toEqual(CHIPS[section.phenomenon]);
      const questions = chipsFor(section.phenomenon, 'motorcycle');
      expect(questions).toHaveLength(3);
      for (const question of questions) expect(question).not.toMatch(carOnly);
    }
    expect(chipsFor('steady-state-roll', 'motorcycle').join(' ')).toMatch(/Motosiklet/);
    expect(chipsFor(undefined, 'motorcycle')).toEqual([]);
  });

  it.each([
    ['moto-classic', /Klasik/, /Düz teleskopik çatal/],
    ['moto-modern', /Modern/, /Ters teleskopik çatal/],
    ['moto-telelever', /Telelever/, /ön salınca(?:k|ğ)/],
  ] as const)('explains the selected %s layout with front/rear telemetry', (preset, label, mechanism) => {
    const telemetry = motorcycleTelemetry(preset);
    expect(Object.keys(telemetry.corners)).toEqual(['f', 'r']);
    expect(telemetry.derived).not.toHaveProperty('roll_centre_front_mm');
    expect(telemetry.derived).not.toHaveProperty('roll_centre_rear_mm');
    expect(engineerRequestSchema.safeParse({ question: 'Seçili motosiklet süspansiyonu nasıl çalışıyor?', telemetry, history: [] }).success).toBe(true);
    const answer = ruleAnswer('Seçili motosiklet süspansiyonu nasıl çalışıyor?', 'settle', telemetry);
    expect(answer).toMatch(label);
    expect(answer).toMatch(mechanism);
    expect(answer).not.toMatch(carOnly);
    expect(ungroundedNumbers(answer, telemetry)).toEqual([]);
  });

  it.each([
    ['Kamber nedir?', /Motosiklet.*virajın içine/],
    ['Yalpa merkezi nedir?', /Motosiklette.*yalpa merkezi gösterilmez/],
    ['Hangi süspansiyon daha iyi?', /Klasik.*Modern.*Telelever/],
  ] as const)('keeps "%s" in the motorcycle glossary', (question, subject) => {
    const telemetry = motorcycleTelemetry();
    const answer = ruleAnswer(question, 'steady-state-roll', telemetry);
    expect(answer).toMatch(subject);
    expect(answer).not.toMatch(carOnly);
    expect(ungroundedNumbers(answer, telemetry)).toEqual([]);
  });
});

describe('event label', () => {
  const ring = new SnapshotRing(1, IDS);
  const label = (set: (t: TelemetryFrame) => void) => {
    ring.push(carFrame(set), 0);
    return eventLabel(ring.latest()!, IDS, 'car');
  };
  it('names corners, braking and single-wheel bumps in plain words', () => {
    expect(label(() => {})).toBe('straight and steady');
    expect(label((t) => (t.ay = -0.85 * G))).toBe('mid-corner, right-hander, outside (left) wheels loaded');
    expect(label((t) => (t.ay = 0.5 * G))).toBe('mid-corner, left-hander, outside (right) wheels loaded');
    expect(label((t) => (t.ax = -0.87 * G))).toBe('hard braking, nose loaded, on a straight');
    expect(label((t) => (t.corners[0]!.travel = 0.023))).toBe('front-left wheel rising over a bump, on a straight');
    expect(label((t) => (t.corners[1]!.travel = -0.05))).toBe('front-right wheel dropping into a dip, on a straight');
    // Roll alone (outside up, inside down) is not mistaken for a bump.
    expect(label((t) => {
      t.ay = -0.85 * G;
      for (const [i, v] of [0.021, -0.018, 0.019, -0.017].entries()) t.corners[i]!.travel = v;
    })).toBe('mid-corner, right-hander, outside (left) wheels loaded');
  });
});

describe('request payload', () => {
  it('is display units, rounded, finite-only derived values, and passes the worker schema', () => {
    const ring = new SnapshotRing(1, IDS);
    ring.push(carFrame((t) => {
      t.ay = -0.85 * G;
      t.roll = (-1.26 * Math.PI) / 180;
      t.corners[0]!.camber = (-0.76 * Math.PI) / 180;
      for (const [i, v] of [0.0213, -0.018, 0.019, -0.017].entries()) t.corners[i]!.travel = v;
      t.corners[0]!.gripUse = 0.6941;
      t.axles[0]!.rollCentreHeight = 0.1063;
    }), 0);
    const tel = buildTelemetry(ring.latest()!, IDS, ctx);
    expect(tel).toMatchObject({ speed_kmh: 71, lat_g: -0.85, roll_deg: -1.26, pitch_deg: 0, event: 'mid-corner, right-hander, outside (left) wheels loaded' });
    expect(tel.corners.fl).toEqual({ camber_deg: -0.76, toe_deg: 0, travel_mm: 21, load_n: 4000, grip_use: 0.69 });
    expect(tel.derived).toEqual({
      roll_centre_front_mm: 106,
      camber_gain_front_deg_per_cm: -0.01,
      camber_gain_rear_deg_per_cm: -0.01,
      roll_camber_front: 0.82,
      roll_camber_rear: 0.82,
      anti_dive_front_pct: 30,
      anti_squat_rear_pct: 30,
    }); // NaN rear roll centre dropped
    expect(engineerRequestSchema.safeParse({ question: 'Why?', telemetry: tel, history: [] }).success).toBe(true);
    const text = ruleAnswer('Why?', 'steady-state-roll', tel);
    expect(ungroundedNumbers(text, tel)).toEqual([]);
  });

  it('every phenomenon has three digit-free chips', () => {
    for (const seg of provingLoop.segments) {
      expect(CHIPS[seg.phenomenon]).toHaveLength(3);
      for (const q of CHIPS[seg.phenomenon]) expect(q).not.toMatch(/\d/);
    }
  });

  it.each([
    ['KAMBER NEDİR?', /^Kamber, tekerleğin/],
    ['YALPA MERKEZİ NEDİR?', /^Yalpa merkezi,/],
    ['EXPLAIN CAMBER', /^Kamber, tekerleğin/],
  ] as const)('the browser fallback recognizes "%s" with live telemetry', (question, answer) => {
    const ring = new SnapshotRing(1, IDS);
    ring.push(carFrame(() => {}), 0);
    const telemetry = buildTelemetry(ring.latest()!, IDS, ctx);
    const text = ruleAnswer(question, 'settle', telemetry);
    expect(text).toMatch(answer);
    expect(ungroundedNumbers(text, telemetry)).toEqual([]);
  });
});
