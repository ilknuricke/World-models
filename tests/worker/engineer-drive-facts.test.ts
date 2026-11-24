/**
 * The Race Engineer's DRIVING fact cards and rule-based driving answers (12-03) make comparative claims about the
 * Manual Drive model ("the multi-link needs more steering", "strut and wishbone drive almost the same", "the outside
 * rear toes in", "lifting off moves load forward" ...). As 02-06 did for the Auto cards, each claim is pinned to its
 * wording AND to what sim-core computes here: the same car, the same scripted inputs per type (09-04 fixtures). If the
 * model changes and an ordering flips, this fails instead of leaving the engineer quietly wrong. Nothing is typed in.
 */
import { describe, expect, it } from 'vitest';
import type { GroundHit, GroundWorld, SurfaceKind } from '../../src/contracts/world';
import { G } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { peakMu } from '../../src/sim-core/ride/tyre';
import { DRIVE_COMMON, DRIVE_COMPARE, factsFor } from '../../worker/engineer/facts';
import { driveLabel, ruleAnswer, type RuleTelemetry } from '../../worker/engineer/fallback';
import { SUSPENSION_IDS, type SuspensionId } from '../fixtures/08-02-drive';
import { circleKeeper, flatWorld, kAt, ramp, rig, speedHold, stepSteer, steerFor, turnEvent } from '../fixtures/09-04-handling';

const OFF: { abs: boolean; traction: boolean; stability: boolean; steering: boolean } = { abs: false, traction: false, stability: false, steering: false };
const KMH100 = 100 / 3.6;
const deg = (r: number): number => (r * 180) / Math.PI;

/** ISO 3888-2-style lane change, the same input for every type (as the 09-04 honesty report). */
function laneBeta(id: SuspensionId): number {
  const r = rig({ suspension: id, aids: OFF });
  const u = 80 / 3.6;
  const amp = (2.2 * Math.PI) / 180;
  r.launch(u);
  const hold = speedHold(u);
  let beta = 0;
  for (let k = 0; k < Math.round(5 / r.dt); k++) {
    const t = k * r.dt;
    r.cmd.steer = t < 1.6 ? amp * Math.sin((2 * Math.PI * t) / 1.6) : t < 2.8 ? -0.35 * amp * Math.sin((2 * Math.PI * (t - 1.6)) / 1.2) : 0;
    hold(r);
    r.step();
    beta = Math.max(beta, Math.abs(r.plant.view.beta));
  }
  return deg(beta);
}

/** 100-0 km/h from exactly 100 km/h (m), and whether wheels locked. */
function stop(id: SuspensionId, abs: boolean): { dist: number; locked: number } {
  const r = rig({ suspension: id, aids: { abs } });
  r.launch(KMH100 + 0.5);
  r.cmd.throttle = 0;
  while (r.plant.view.u > KMH100) r.step();
  const v0 = r.plant.view.u;
  const x0 = r.plant.view.x;
  r.cmd.brake = 1;
  let locked = 0;
  while (r.plant.view.u > 0.01 && r.t < 20) {
    const f = r.step();
    if (r.plant.view.u > 3) for (const c of f.corners) if (Math.abs(c.omega) < 0.5) locked++;
  }
  return { dist: (r.plant.view.x - x0) * (KMH100 / v0) ** 2, locked };
}

/** 0-100 km/h at full throttle with the default assists (s). */
function launch(id: SuspensionId): number {
  const r = rig({ suspension: id });
  r.place();
  r.cmd.throttle = 1;
  while (r.plant.view.u < KMH100 && r.t < 10) r.step();
  return r.t;
}

const axleLoads = (f: { corners: readonly { load: number }[] }) => ({ front: f.corners[0]!.load + f.corners[1]!.load, rear: f.corners[2]!.load + f.corners[3]!.load });

/** Straight at 20 m/s: axle loads cruising, then 0.5 s into a firm brake (pedal 0.6). */
function brakeTransfer() {
  const r = rig({ aids: OFF });
  r.launch(20);
  const hold = speedHold(20);
  for (let k = 0; k < 480; k++) (hold(r), r.step());
  const cruise = axleLoads(r.frame);
  r.cmd.throttle = 0;
  r.cmd.brake = 0.6;
  for (let k = 0; k < 120; k++) r.step();
  return { cruise, braking: axleLoads(r.frame) };
}

/** Steady left turn R 60 m at 0.6 g on part throttle; then a full lift for 0.4 s: axle loads before / after. */
function liftTransfer() {
  const r = rig({ aids: OFF });
  const R = 60;
  const u = Math.sqrt(0.6 * G * R);
  r.launch(u, 1 / R);
  const keep = circleKeeper(R, 0, R, 1, gtCoupe.wheelbase);
  const hold = speedHold(u);
  for (let k = 0; k < 2400; k++) (keep(r), hold(r), r.step());
  const before = axleLoads(r.frame);
  const yaw0 = r.plant.view.r;
  const steer = r.cmd.steer;
  r.cmd.throttle = 0;
  r.cmd.brake = 0;
  for (let k = 0; k < 96; k++) (r.cmd.steer = steer, r.step());
  return { before, after: axleLoads(r.frame), yawRatio: r.plant.view.r / r.plant.view.u / (yaw0 / u) };
}

/** Steady left turn, then full throttle for 1 s: peak sideslip with the assists off / on (power oversteer). */
function powerOn(aidsOn: boolean): { beta: number; stability: boolean } {
  const res = turnEvent('double-wishbone', 'power', 1, 100, 0.4 * G, aidsOn ? {} : OFF);
  return { beta: deg(res.betaMax), stability: aidsOn };
}

/** Braking from 20 m/s, steer held straight, left wheels (y > 0.3) on very slippery tiles: heading change (rad, + left). */
function splitMu(aids: Partial<typeof OFF>) {
  const base = flatWorld();
  const world: GroundWorld = {
    ...base,
    sample(x: number, y: number, hint: number, out: GroundHit): GroundHit {
      base.sample(x, y, hint, out);
      out.surface = (y > 0 ? 'ceramic-wet' : 'asphalt') satisfies SurfaceKind;
      return out;
    },
  };
  const r = rig({ aids: { ...OFF, ...aids }, world });
  r.launch(20);
  r.cmd.throttle = 0;
  r.cmd.brake = 1;
  while (r.plant.view.u > 1 && r.t < 8) (r.cmd.steer = 0, r.step());
  return Math.atan2(r.plant.view.sinYaw, r.plant.view.cosYaw);
}

const M = (() => {
  const delta = steerFor('double-wishbone', 27.78, 4);
  const per = Object.fromEntries(
    SUSPENSION_IDS.map((id) => {
      const left = ramp(id, 50, 1);
      const step = stepSteer(id, 27.78, delta);
      const brake = turnEvent(id, 'brake', 0.3);
      return [
        id,
        {
          k03: kAt(left, 0.3),
          limit: left.peak / G,
          tYaw: step.tYaw,
          overshoot: step.overshoot,
          aySameSteer: step.aySteady,
          laneBeta: laneBeta(id),
          brakeYaw: deg(brake.yawDeviation),
          toeOuter: deg(brake.rearToeSteady[0]),
          toeInner: deg(brake.rearToeSteady[1]),
          rearSteerSteady: deg(brake.rearSteerSteady),
          rearSteerBrake: deg(brake.rearSteerEvent),
          stopAbs: stop(id, true).dist,
          launch: launch(id),
        },
      ];
    }),
  ) as unknown as Record<SuspensionId, Record<string, number>>;
  const locked = stop('double-wishbone', false);
  const tyre = gtCoupe.front.tyre;
  return {
    per,
    stopLocked: locked.dist,
    lockedSteps: locked.locked,
    grip: { at: (n: number) => peakMu(n, 0, tyre) * n, nominal: tyre.nominalLoad },
    brake: brakeTransfer(),
    lift: liftTransfer(),
    power: { off: powerOn(false), on: powerOn(true) },
    split: { abs: splitMu({ abs: true }), all: splitMu({ abs: true, stability: true, traction: true }) },
  };
})();

const [MP, DW, ML] = ['macpherson', 'double-wishbone', 'multilink'] as const;
const v = (id: SuspensionId, k: string) => M.per[id]![k]!;
const spread = (k: string) => Math.max(...SUSPENSION_IDS.map((id) => v(id, k))) - Math.min(...SUSPENSION_IDS.map((id) => v(id, k)));
const DRIVING = factsFor('car', 'multilink', true);

describe('measured values behind the driving claims', () => {
  it('prints them', () => {
    const r = (x: number) => Number(x.toFixed(4));
    console.info(JSON.stringify(M, (_k, x: unknown) => (typeof x === 'number' ? r(x) : x), 1));
    for (const id of SUSPENSION_IDS) for (const x of Object.values(M.per[id]!)) expect(Number.isFinite(x)).toBe(true);
  });
});

describe('driving physics cards agree with the plant', () => {
  it('tyre grip grows with load but less than in proportion', () => {
    expect(DRIVE_COMMON).toMatch(/twice the load gives less than twice the grip/);
    const n = M.grip.nominal;
    expect(M.grip.at(2 * n)).toBeGreaterThan(M.grip.at(n));
    expect(M.grip.at(2 * n)).toBeLessThan(2 * M.grip.at(n));
  });

  it('braking moves load onto the front tyres and off the rear', () => {
    expect(DRIVE_COMMON).toMatch(/Braking moves load onto the front tyres and off the rear/);
    expect(M.brake.braking.front).toBeGreaterThan(M.brake.cruise.front);
    expect(M.brake.braking.rear).toBeLessThan(M.brake.cruise.rear);
  });

  it('lifting off mid-corner moves load forward and the car turns in a little more', () => {
    expect(DRIVE_COMMON).toMatch(/Lifting off the throttle mid-corner moves load forward/);
    expect(DRIVE_COMMON).toMatch(/turns in a little more/);
    expect(M.lift.after.front).toBeGreaterThan(M.lift.before.front);
    expect(M.lift.after.rear).toBeLessThan(M.lift.before.rear);
    expect(M.lift.yawRatio).toBeGreaterThan(1);
  });

  it('ABS keeps the wheels turning and stops shorter than locked wheels', () => {
    expect(DRIVE_COMMON).toMatch(/stops a little shorter than with locked wheels/);
    expect(M.lockedSteps).toBeGreaterThan(100);
    for (const id of SUSPENSION_IDS) expect(v(id, 'stopAbs')).toBeLessThan(M.stopLocked);
  });

  it('full throttle in a corner without assists swings the tail out; the assists keep it in check', () => {
    expect(DRIVE_COMMON).toMatch(/without the assists, full throttle in a corner can swing the tail out/);
    expect(M.power.off.beta).toBeGreaterThan(5);
    expect(M.power.on.beta).toBeLessThan(0.3 * M.power.off.beta);
  });

  it('braking with one side on slippery tiles turns the car toward the grippier side', () => {
    expect(DRIVE_COMMON).toMatch(/turns the car toward the side with more grip/);
    // left wheels on tiles, right on asphalt: the heading turns right (negative)
    expect(M.split.abs).toBeLessThan(0);
    expect(DRIVE_COMMON).toMatch(/without steering against it, the assists alone cannot hold the car straight/);
    expect(M.split.all).toBeLessThan(-0.5);
  });

  it('compliance: outer rear toes in, inner toes out, rear axle steers into the turn, more under braking; multi-link most', () => {
    expect(DRIVE_COMMON).toMatch(/outside rear wheel toes in and the inside rear wheel toes out/);
    expect(DRIVE_COMMON).toMatch(/braking in a corner adds a little more/);
    expect(DRIVE_COMMON).toMatch(/The multi-link rear does this most, about three times as much as the strut or the double wishbone/);
    for (const id of SUSPENSION_IDS) {
      expect(v(id, 'toeOuter')).toBeGreaterThan(0);
      expect(v(id, 'toeInner')).toBeLessThan(0);
      expect(v(id, 'rearSteerSteady')).toBeGreaterThan(0);
      expect(v(id, 'rearSteerBrake')).toBeGreaterThan(v(id, 'rearSteerSteady'));
    }
    for (const other of [MP, DW]) {
      const ratio = v(ML, 'rearSteerSteady') / v(other, 'rearSteerSteady');
      expect(ratio).toBeGreaterThan(2);
      expect(ratio).toBeLessThan(4);
    }
  });

  it('the driving cards do not repeat the Auto claim that compliance is not modelled', () => {
    expect(DRIVING).not.toMatch(/rigid links|not modelled and does not show|self-driving/);
    expect(DRIVING).toMatch(/In Auto the links are rigid/);
  });
});

describe('measured per-type differences (same car, same inputs)', () => {
  it('multi-link: noticeably more steering for the same corner (higher understeer gradient), less cornering force for the same steer', () => {
    expect(DRIVE_COMPARE).toMatch(/multi-link car needs noticeably more steering for the same corner/);
    for (const other of [MP, DW]) {
      expect(v(ML, 'k03')).toBeGreaterThan(1.3 * v(other, 'k03'));
      expect(v(ML, 'aySameSteer')).toBeLessThan(v(other, 'aySameSteer'));
    }
  });

  it('multi-link: turns in a little quicker with a little more yaw overshoot', () => {
    expect(DRIVE_COMPARE).toMatch(/turns in a little quicker with a little more overshoot/);
    for (const other of [MP, DW]) {
      expect(v(ML, 'tYaw')).toBeLessThan(v(other, 'tYaw'));
      expect(v(ML, 'overshoot')).toBeGreaterThan(v(other, 'overshoot'));
    }
  });

  it('multi-link: calmer in a quick lane change and when braking in a corner', () => {
    expect(DRIVE_COMPARE).toMatch(/stays calmer in a quick lane change and when braking in a corner/);
    for (const other of [MP, DW]) {
      expect(v(ML, 'laneBeta')).toBeLessThan(0.7 * v(other, 'laneBeta'));
      expect(v(ML, 'brakeYaw')).toBeLessThan(v(other, 'brakeYaw'));
    }
  });

  it('strut and double wishbone drive almost the same', () => {
    expect(DRIVE_COMPARE).toMatch(/strut and the double wishbone drive almost the same/);
    expect(Math.abs(v(MP, 'k03') - v(DW, 'k03'))).toBeLessThan(0.1);
    expect(Math.abs(v(MP, 'tYaw') - v(DW, 'tYaw'))).toBeLessThan(0.01);
    expect(Math.abs(v(MP, 'laneBeta') - v(DW, 'laneBeta'))).toBeLessThan(0.05);
    expect(Math.abs(v(MP, 'aySameSteer') - v(DW, 'aySameSteer'))).toBeLessThan(0.1);
    expect(Math.abs(v(MP, 'brakeYaw') - v(DW, 'brakeYaw'))).toBeLessThan(0.1);
  });

  it('cornering limit, stopping distance and launch are almost the same for all three', () => {
    expect(DRIVE_COMPARE).toMatch(/cornering grip limit, the stopping distance and the launch are almost the same for all three/);
    expect(spread('limit')).toBeLessThan(0.02);
    expect(spread('stopAbs')).toBeLessThan(0.5);
    expect(spread('launch')).toBeLessThan(0.1);
  });

  it('launch and stopping figures are model outputs, never predictions for a real car; no type is best', () => {
    expect(DRIVE_COMMON).toMatch(/outputs of this representative model[^.]*not predictions for any real car/);
    expect(DRIVE_COMPARE).toMatch(/No type is best/);
    expect(DRIVE_COMPARE).not.toMatch(/\bbest (type|suspension)\b(?! overall)/);
  });
});

describe('rule-based driving answers agree with the plant', () => {
  const tel = (suspension: SuspensionId, detected: string): RuleTelemetry => ({
    vehicle_class: 'car',
    suspension,
    section_name: 'Steering circle',
    speed_kmh: 64,
    lat_g: 0.7,
    long_g: 0,
    roll_deg: 1.2,
    pitch_deg: 0,
    corners: {},
    drive: { mode: 'manual', detected, steer_deg: 4.1, throttle_pct: 0, brake_pct: 0, sideslip_deg: 3.2, yaw_rate_dps: 18, gear: 3, surface: 'Dry asphalt', aids_active: [] },
  });

  it('swap answers: strut and wishbone almost the same; to or from the multi-link more steering', () => {
    const same = ruleAnswer('What changed?', undefined, tel(DW, driveLabel({ kind: 'swap', previous: MP, next: DW })));
    expect(same).toMatch(/Bu modelde .* sürüş neredeyse aynıdır/);
    expect(Math.abs(v(MP, 'k03') - v(DW, 'k03'))).toBeLessThan(0.1);
    const ml = ruleAnswer('What changed when I switched to multi-link?', undefined, tel(ML, driveLabel({ kind: 'swap', previous: MP, next: ML })));
    expect(ml).toMatch(/aynı virajda biraz daha fazla direksiyon gerekir/);
    expect(v(ML, 'k03')).toBeGreaterThan(v(MP, 'k03'));
  });

  it('lift-off answer names the forward load transfer the plant shows', () => {
    const a = ruleAnswer('Why did I spin?', undefined, tel(MP, driveLabel({ kind: 'slide', axle: 'rear', lift: true })));
    expect(a).toMatch(/yük ön lastiklere geçti/);
    expect(M.lift.after.rear).toBeLessThan(M.lift.before.rear);
  });

  it('the ABS answer says the wheels kept turning (no lock with ABS on)', () => {
    const a = ruleAnswer('What did ABS do there?', undefined, tel(MP, driveLabel({ kind: 'aid', aid: 'abs' })));
    expect(a).toMatch(/tekerlekler dönmeye devam etti/);
    expect(v(MP, 'stopAbs')).toBeLessThan(M.stopLocked);
  });
});
