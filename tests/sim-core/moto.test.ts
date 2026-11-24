/**
 * Motorcycle kinematics, ride and lean (ARCHITECTURE §7.7, research 08). Geometry gates are computed from the content;
 * the steady-braking checks drive the 4-DOF ride model with no road input until it settles.
 */
import { describe, expect, it } from 'vitest';
import type { MotorcycleSuspensionDefinition } from '../../src/contracts/suspension';
import { G, RAD_TO_DEG } from '../../src/contracts/units';
import { cafeRacer, FRONT_AXLE, REAR_AXLE } from '../../src/sim-core/content/cafe-racer';
import { motoClassic } from '../../src/sim-core/content/moto-classic';
import { motoModern } from '../../src/sim-core/content/moto-modern';
import { motoTelelever } from '../../src/sim-core/content/moto-telelever';
import { createLean, frameLean, PHI, STEER, STEER_MAX } from '../../src/sim-core/moto/lean';
import { prepareMotoSuspension, trailOf, type MotoSolution } from '../../src/sim-core/moto/model';
import { CHI, ICX, ICZ, KX, MR, WX, WZ } from '../../src/sim-core/moto/planar';
import { createRide4, suspensionForce, TH, ZF, ZR, type EndParams, type Ride4Input } from '../../src/sim-core/moto/ride4dof';

const PRESETS = [motoClassic, motoModern, motoTelelever] as const;
const v = cafeRacer;
const L = v.wheelbase;
const h = v.cgHeight;
const a = v.cgToFront;
const b = L - a;
const sol = (s: MotorcycleSuspensionDefinition): MotoSolution => prepareMotoSuspension(v, s);
const row = (p: EndParams, w: number): Float64Array => p.table.sample(w, new Float64Array(64));
const strings = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];

/** Travel at which the end's static-curve suspension force equals `force` (rate 0, no coupling). */
function travelFor(p: EndParams, force: number): number {
  let lo = -p.droop;
  let hi = p.bump;
  const r = new Float64Array(64);
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (suspensionForce(p, mid, 0, r) < force) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Steady braking (decel > 0, m/s²) of the bike's 4-DOF on a smooth road: settled state. */
function steadyBrake(s: MotorcycleSuspensionDefinition, decel: number) {
  const m = sol(s);
  const ride = createRide4({ sprungMass: v.sprungMass, cgHeight: h, inertiaPitch: v.inertia.pitch, front: m.front, rear: m.rear, sprocketRatio: m.sprocketRatio });
  const input: Ride4Input = { fx: new Float64Array(2), drive: 0, geff: G, road: new Float64Array(2), roadRate: new Float64Array(2) };
  ride.reset(input);
  input.fx[0] = -v.front.brakeShare * v.mass * decel;
  input.fx[1] = -v.rear.brakeShare * v.mass * decel;
  for (let k = 0; k < 240 * 6; k++) ride.step(1 / 240, input);
  return { m, ride, input };
}

/** Bounce and pitch modes of the sprung mass on the series (wheel + tyre) rates, Hz; heave-dominant first. */
function modes(m: MotoSolution): { bounce: number; pitch: number } {
  const ser = (p: EndParams) => (p.wheelRate * p.tyreRate) / (p.wheelRate + p.tyreRate);
  const kf = ser(m.front);
  const kr = ser(m.rear);
  const ms = v.sprungMass;
  const iy = v.inertia.pitch;
  const kzz = kf + kr;
  const kzt = -(a * kf - b * kr);
  const ktt = a * a * kf + b * b * kr;
  const A = ms * iy;
  const B = -(kzz * iy + ktt * ms);
  const C = kzz * ktt - kzt * kzt;
  const ls = [(-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A), (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A)];
  // Mode shape (z, θ) = (−kzt, kzz − λ·ms); heave participation against θ·L/2.
  const heaveShare = (l: number) => Math.abs(kzt) / (Math.abs(kzt) + Math.abs(kzz - l * ms) * (L / 2));
  const [l0, l1] = heaveShare(ls[0]!) >= heaveShare(ls[1]!) ? [ls[0]!, ls[1]!] : [ls[1]!, ls[0]!];
  return { bounce: Math.sqrt(l0) / (2 * Math.PI), pitch: Math.sqrt(l1) / (2 * Math.PI) };
}

describe('content', () => {
  it('copy has no digits and the vehicle is generic', () => {
    for (const s of PRESETS) expect(strings(s.copy).filter((t) => /\d/.test(t)), s.id).toEqual([]);
    expect([v.name, v.subtitle].filter((t) => /\d/.test(t))).toEqual([]);
    expect(v.subtitle).toBe('Temsili parametreler');
    expect(`${v.name} ${v.subtitle}`).not.toMatch(/triumph|bmw|thruxton|bonneville|honda|kawasaki/i);
    expect(v.suspensions).toEqual(PRESETS.map((s) => s.id));
  });

  it.each(PRESETS)('$id: geometry is consistent with the vehicle axles and the steering axis', (s) => {
    expect(s.rear.axle[0]).toBeCloseTo(REAR_AXLE[0], 6);
    expect(s.rear.axle[2]).toBeCloseTo(REAR_AXLE[1], 6);
    const f = s.front;
    // Axle at `offset` ahead of the steering axis through the head at `rake`.
    const ux = -Math.sin(f.rake);
    const uz = Math.cos(f.rake);
    const dx = FRONT_AXLE[0] - f.steeringHead[0];
    const dz = FRONT_AXLE[1] - f.steeringHead[2];
    expect(dx * uz - dz * ux).toBeCloseTo(f.offset, 6);
    if (f.kind === 'telelever') {
      const jx = f.armJoint[0] - f.steeringHead[0];
      const jz = f.armJoint[2] - f.steeringHead[2];
      expect(Math.abs(jx * uz - jz * ux)).toBeLessThan(1e-9);
    }
    const m = sol(s);
    for (const p of [m.front, m.rear]) expect(row(p, 0)[WZ]).toBeCloseTo(p === m.front ? FRONT_AXLE[1] : REAR_AXLE[1], 9);
  });

  it('the telescopic presets share one frame: same steering geometry and swingarm', () => {
    expect(motoModern.front.rake).toBe(motoClassic.front.rake);
    expect(motoModern.front.offset).toBe(motoClassic.front.offset);
    expect(motoModern.rear.pivot).toEqual(motoClassic.rear.pivot);
    expect(motoTelelever.rear.pivot).toEqual(motoClassic.rear.pivot);
  });
});

describe('kinematics (research 08 §4)', () => {
  it.each([motoClassic, motoModern])('$id: trail = (R sin ε − o) / cos ε with the loaded radius', (s) => {
    const m = sol(s);
    const R = v.front.tyre.radius - m.front.tyreDeflection;
    const e = s.front.rake;
    const expected = (R * Math.sin(e) - s.front.offset) / Math.cos(e);
    expect(m.kinematics.front.summary.trail).toBeCloseTo(expected, 6);
    expect(m.kinematics.front.summary.caster).toBeCloseTo(e, 9);
    // Nose-down pitch reduces trail by dt/dε = (R − o sin ε)/cos² ε per radian (small angle).
    const r0 = row(m.front, 0);
    const head: [number, number] = [s.front.steeringHead[0], s.front.steeringHead[2]];
    const dth = 1e-4;
    // Ground under the pitched wheel: posed wheel-centre height minus the loaded radius (the tyre stays on the road).
    const at = (th: number) => trailOf(r0, head, th, 0, -r0[WX]! * Math.sin(th) + r0[WZ]! * Math.cos(th) - R);
    const slope = (at(dth) - at(-dth)) / (2 * dth);
    expect(-slope).toBeCloseTo((R - s.front.offset * Math.sin(e)) / Math.cos(e) ** 2, 3);
  });

  it('with the frame held level, telescopic trail is constant through travel; the Telelever path adds trail', () => {
    const trailAt = (s: MotorcycleSuspensionDefinition, w: number) => {
      const m = sol(s);
      const r = row(m.front, w);
      return trailOf(r, [s.front.steeringHead[0], s.front.steeringHead[2]], 0, 0, r[WZ]! - (v.front.tyre.radius - m.front.tyreDeflection));
    };
    expect(trailAt(motoClassic, 0.04)).toBeCloseTo(trailAt(motoClassic, 0), 9);
    expect(trailAt(motoTelelever, 0.04) - trailAt(motoTelelever, 0)).toBeGreaterThan(0.005);
  });

  it('telescopic forks are pro-dive (AD < 0, = −β·(L/h)·tan ε); the Telelever is anti-dive (AD > 0)', () => {
    for (const s of [motoClassic, motoModern]) {
      const ad = sol(s).kinematics.front.summary.antiPitch;
      expect(ad).toBeLessThan(0);
      expect(ad).toBeCloseTo((-v.front.brakeShare * L * Math.tan(s.front.rake)) / h, 9);
    }
    const ad = sol(motoTelelever).kinematics.front.summary.antiPitch;
    expect(ad).toBeGreaterThan(0.3);
    expect(ad).toBeLessThan(0.9);
  });

  it('the linkage gives a rising rate; the twin shocks stay near linear', () => {
    const curve = (s: MotorcycleSuspensionDefinition) => sol(s).kinematics.rear.curves.motionRatio;
    const mr = curve(motoModern);
    for (let i = 1; i < mr.length; i++) expect(mr[i]!).toBeGreaterThan(mr[i - 1]!);
    expect(mr[mr.length - 1]! / mr[0]!).toBeGreaterThan(1.3);
    const twin = curve(motoClassic);
    expect(twin[twin.length - 1]! / twin[0]!).toBeLessThan(1.1);
    expect(twin[twin.length - 1]! / twin[0]!).toBeGreaterThan(0.95);
  });

  it.each(PRESETS)('$id: anti-squat from virtual work equals the chain/swingarm instant-centre construction', (s) => {
    const m = sol(s);
    const r = row(m.rear, 0);
    // Line from the rear contact through the IC, height at the front contact, over h.
    const xr = r[WX]!;
    const ic = (r[ICZ]! * (FRONT_AXLE[0] - xr)) / (r[ICX]! - xr) / h;
    expect(Math.hypot(r[ICX]! - xr, r[ICZ]!)).toBeLessThan(4.9); // a real intersection, not the clamp
    expect(m.kinematics.rear.summary.antiPitch).toBeCloseTo(ic, 2);
    expect(m.kinematics.rear.summary.antiPitch).toBeCloseTo((-(r[KX]! + m.sprocketRatio * r[CHI]!) * L) / h, 9);
  });

  it.each(PRESETS)('$id: static sag 25–40 % of travel and bounce 2.0–2.8 Hz', (s) => {
    const m = sol(s);
    for (const p of [m.front, m.rear]) {
      const sag = p.droop / p.table.travel;
      expect(sag).toBeGreaterThanOrEqual(0.25);
      expect(sag).toBeLessThanOrEqual(0.4);
      // At static, the suspension holds the sprung share exactly.
      expect(suspensionForce(p, 0, 0, new Float64Array(64))).toBeCloseTo(p.staticForce, 3);
    }
    const f = modes(m);
    expect(f.bounce).toBeGreaterThanOrEqual(2.0);
    expect(f.bounce).toBeLessThanOrEqual(2.8);
  });
});

describe('steady braking at 0.6 g (research 08 §4.4–4.5)', () => {
  const decel = 0.6 * G;
  const dN = (v.mass * decel * h) / L;

  it('telescopic forks compress MORE than pure load transfer predicts, the Telelever LESS', () => {
    const extra: Record<string, number> = {};
    for (const s of PRESETS) {
      const { m, ride } = steadyBrake(s, decel);
      const pureTransfer = travelFor(m.front, m.front.staticForce + dN);
      extra[s.id] = ride.w[0]! - pureTransfer;
    }
    expect(extra['moto-classic']!).toBeGreaterThan(0.005);
    expect(extra['moto-modern']!).toBeGreaterThan(0.005);
    expect(extra['moto-telelever']!).toBeLessThan(-0.005);
  });

  it.each(PRESETS)('$id: compression force follows AD, and pitch matches the quasi-static formula within 5 %', (s) => {
    const { m, ride, input } = steadyBrake(s, decel);
    const rf = row(m.front, ride.w[0]!);
    const rr = row(m.rear, ride.w[1]!);
    const adF = (v.front.brakeShare * rf[KX]! * L) / h;
    // Front: ΔS = ΔN·(1 − AD); rear: ΔS = −ΔN + Fx_r·kx_r.
    const sF = suspensionForce(m.front, ride.w[0]!, 0, new Float64Array(64));
    expect((sF - m.front.staticForce) / (dN * (1 - adF))).toBeCloseTo(1, 2);
    const qR = -dN + input.fx[1]! * rr[KX]!;
    const wF = travelFor(m.front, m.front.staticForce + dN * (1 - adF));
    const wR = travelFor(m.rear, m.rear.staticForce + qR);
    // θ = [(zu_r − w_r) − (zu_f − w_f)] / L with zu = −ΔN/k_t (tyre deflection).
    const zuF = -dN / v.front.tyre.verticalStiffness;
    const zuR = dN / v.rear.tyre.verticalStiffness;
    const predicted = (zuR - wR - (zuF - wF)) / L;
    expect(ride.q[TH]! / predicted).toBeGreaterThan(0.95);
    expect(ride.q[TH]! / predicted).toBeLessThan(1.05);
    expect(ride.q[ZF]!).toBeCloseTo(zuF, 4);
    expect(ride.q[ZR]!).toBeCloseTo(zuR, 4);
  });
});

describe('lean and steer (research 08 §5.1–5.2)', () => {
  const crown = ((v.front.tyre.crownRadius ?? 0) + (v.rear.tyre.crownRadius ?? 0)) / 2;
  const lean = () => createLean({ wheelbase: L, cgHeight: h, crown, rake: motoClassic.front.rake });

  it('frame lean at a steady 0.8 g is within 1° of φ = γ + asin((ρ/H) sin γ), γ = atan(0.8), leaning into the turn', () => {
    const l = lean();
    const vel = 20;
    const ay = 0.8 * G;
    l.reset(0, G, 0, vel, 0);
    for (let k = 0; k < 240 * 4; k++) l.step(1 / 240, ay, G, 0, vel, ay / (vel * vel));
    const closed = frameLean(Math.atan(0.8), h, crown);
    expect(Math.abs(l.state[PHI]! - closed) * RAD_TO_DEG).toBeLessThan(1);
    expect(closed).toBeGreaterThan(Math.atan(0.8)); // the crown makes the frame lean further than the CG line
    // Left turn: lean left (model roll = −φ < 0); steady steer δ = L·κ / cos ε, to the left.
    expect(l.state[PHI]!).toBeGreaterThan(0);
    expect(l.state[STEER]!).toBeCloseTo((L * (ay / (vel * vel))) / Math.cos(motoClassic.front.rake), 4);
  });

  it('turn-in countersteers: steering briefly opposes the turn', () => {
    const l = lean();
    l.reset(0, G, 0, 20, 0);
    l.step(1 / 240, 4, G, 0, 20, 0.01);
    expect(l.state[STEER]!).toBeLessThan(0);
    for (let k = 0; k < 240; k++) l.step(1 / 240, 4, G, 0, 20, 0.01);
    expect(l.state[STEER]!).toBeGreaterThan(0);
  });

  it('steer is clamped and blends to the kinematic angle at walking pace', () => {
    const l = lean();
    l.reset(0, G, 0, 1, 0.5);
    expect(l.state[STEER]!).toBeCloseTo(Math.min(STEER_MAX, (L * 0.5) / Math.cos(motoClassic.front.rake)), 9);
  });
});
