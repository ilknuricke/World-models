/**
 * Race Engineer while driving (12-03): drive payloads built from REAL plant runs through the browser's payload builder
 * (src/features/engineer/snapshot.ts) at the moment a sim-core detector fired, checked by the worker's schema, prompt,
 * unit-aware number check and rule-based answers; plus one recorded real model answer for a lift-off event.
 * The scenarios are also the live-evaluation inputs (tests/fixtures/12-03-drive-scenarios.json, regenerated and
 * compared here; `UPDATE_FIXTURES=1` rewrites it).
 */
import { describe, expect, it } from 'vitest';
import type { DriveEvent } from '../../src/contracts/drive';
import type { EngineerRequest, EngineerTelemetry } from '../../src/contracts/engineer';
import { SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { driveKey, driveLabel as clientLabel } from '../../src/features/engineer/rules';
import { buildTelemetry, EVENT_CHIPS, placeOf, SnapshotRing, type DriveContext } from '../../src/features/engineer/snapshot';
import { driveLabel, ruleAnswer, type DriveMoment } from '../../worker/engineer/fallback';
import { factsFor } from '../../worker/engineer/facts';
import { normaliseReply } from '../../worker/engineer/model';
import { numbersInText, ungroundedNumbers } from '../../worker/engineer/numbers';
import { buildMessages } from '../../worker/engineer/prompt';
import { answer } from '../../worker/routes/engineer';
import { engineerRequestSchema } from '../../worker/schemas/engineer';
import { rig, type Rig } from '../fixtures/09-04-handling';

const OFF = { abs: false, traction: false, stability: false, steering: false };
const IDS = ['fl', 'fr', 'rl', 'rr'];
const L = gtCoupe.wheelbase;
const summary = { camberGain: -0.0227, rollCamber: 0.82, bumpSteer: 0, rollCentreHeight: 0.107, rollCentreMigration: 0.3, kingpinInclination: 0.22, caster: 0.12, scrubRadius: 0.02, trail: 0.017, antiPitch: 0.301, motionRatio: 0.94 };

interface Scenario {
  readonly suspension: 'macpherson' | 'double-wishbone' | 'multilink';
  readonly aids?: Partial<typeof OFF>;
  readonly start: (r: Rig) => void;
  readonly drive: (t: number, r: Rig) => void;
  readonly seconds: number;
  /** Which detector event to capture (first matching). */
  readonly want: (e: DriveEvent) => boolean;
  readonly station: string;
}

const SCENARIOS: Readonly<Record<'liftoff' | 'understeer' | 'abs' | 'traction' | 'lockup' | 'steady', Scenario>> = {
  // R 40 m at 18 m/s, 0.7 throttle, released at 1.2 s (tests/sim-core/drive-events.test.ts)
  liftoff: {
    suspension: 'macpherson',
    aids: OFF,
    start: (r) => r.launch(18, 1 / 40),
    drive: (t, r) => {
      r.cmd.steer = Math.atan(L / 40) * 1.6;
      r.cmd.throttle = t < 1.2 ? 0.7 : 0;
    },
    seconds: 3,
    want: (e) => e.kind === 'slide' && e.axle === 'rear',
    station: 'steering-pad',
  },
  understeer: {
    suspension: 'multilink',
    aids: OFF,
    start: (r) => r.launch(25),
    drive: (t, r) => {
      r.cmd.steer = t > 0.5 ? 0.25 : 0;
      r.cmd.throttle = 0.2;
    },
    seconds: 3,
    want: (e) => e.kind === 'slide' && e.axle === 'front',
    station: 'lane-change',
  },
  abs: {
    suspension: 'double-wishbone',
    start: (r) => r.launch(25),
    drive: (_t, r) => {
      r.cmd.throttle = 0;
      r.cmd.brake = 1;
    },
    seconds: 3,
    want: (e) => e.kind === 'aid' && e.aid === 'abs',
    station: 'braking-platform',
  },
  traction: {
    suspension: 'double-wishbone',
    start: (r) => r.place(),
    drive: (_t, r) => {
      r.cmd.throttle = 1;
    },
    seconds: 3,
    want: (e) => e.kind === 'aid' && e.aid === 'traction',
    station: 'slalom',
  },
  lockup: {
    suspension: 'macpherson',
    aids: OFF,
    start: (r) => r.launch(25),
    drive: (_t, r) => {
      r.cmd.throttle = 0;
      r.cmd.brake = 1;
    },
    seconds: 3,
    want: (e) => e.kind === 'lockup',
    station: 'braking-platform',
  },
  // steady on the circle, nothing detected (also used for the swap question)
  steady: {
    suspension: 'multilink',
    start: (r) => r.launch(15, 1 / 40),
    drive: (_t, r) => {
      r.cmd.steer = Math.atan(L / 40) * 1.2;
      r.cmd.throttle = 0.2;
    },
    seconds: 2,
    want: () => false,
    station: 'steering-pad',
  },
};

/** Runs a scenario; returns the payload built at the captured event (or at the end), as the browser would. */
function generate(name: keyof typeof SCENARIOS): EngineerTelemetry & { readonly drive: NonNullable<EngineerTelemetry['drive']> } {
  const sc = SCENARIOS[name]!;
  const r = rig({ suspension: sc.suspension, ...(sc.aids ? { aids: sc.aids } : {}) });
  sc.start(r);
  r.driveEvents.length = 0;
  const ring = new SnapshotRing(20, IDS);
  let captured: { moment: DriveMoment; time: number } | undefined;
  const snap = new SnapshotRing(1, IDS);
  let lastSample = -Infinity;
  for (let k = 0; k < Math.round(sc.seconds / SIM_DT); k++) {
    const t = k * SIM_DT;
    sc.drive(t, r);
    const f = r.step();
    f.drive.mode = 'manual'; // the bare rig has no Simulation mode; the browser reads 'manual' here
    if (t - lastSample >= 0.1 - 1e-9) {
      ring.push(f, t);
      lastSample = t;
    }
    const e = r.driveEvents.find(sc.want);
    if (e && !captured) {
      captured = { moment: e as DriveMoment, time: t };
      snap.push(f, t);
      break;
    }
  }
  if (!captured) snap.push(r.frame, r.t);
  const s = snap.latest()!;
  const station = provingGround.stations.find((x) => x.id === sc.station)!;
  const place = placeOf(provingGround, station.zone, station.spawn.x, station.spawn.y)!;
  const drive: DriveContext = captured
    ? { detected: clientLabel(captured.moment), before: ring.inputs(captured.time - 0.65, captured.time - 0.05)!, eventAge: 1.5, aidsOff: sc.aids ? ['anti-lock', 'traction', 'stability', 'steering help'] : [] }
    : { detected: 'none', aidsOff: [] };
  return buildTelemetry(s, IDS, { vehicleClass: 'car', vehicleId: 'gt-coupe', suspensionId: sc.suspension, sectionId: place.id, sectionName: place.name, summaries: { front: summary, rear: summary } }, drive) as ReturnType<typeof generate>;
}

// No Node typings in this tsconfig: fs and the env through untyped lookups (as engineer-live.test.ts does for env).
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { existsSync(p: string): boolean; readFileSync(p: string, e: 'utf8'): string; writeFileSync(p: string, d: string): void };
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const { existsSync, readFileSync, writeFileSync } = fs;
const fixture = (name: string): string => decodeURIComponent(new URL(`../fixtures/${name}`, (import.meta as unknown as { url: string }).url).pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
const FIXTURE = fixture('12-03-drive-scenarios.json');
type Name = 'liftoff' | 'understeer' | 'abs' | 'traction' | 'lockup' | 'steady';
const generated = Object.fromEntries((Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((n) => [n, generate(n)])) as Record<Name, ReturnType<typeof generate>>;
if (env.UPDATE_FIXTURES === '1' || !existsSync(FIXTURE)) writeFileSync(FIXTURE, `${JSON.stringify(generated, null, 2)}\n`);
const S = JSON.parse(readFileSync(FIXTURE, 'utf8')) as typeof generated;
const req = (question: string, telemetry: EngineerTelemetry): EngineerRequest => ({ question, telemetry, history: [] });

describe('drive payloads from real plant runs', () => {
  it('regenerate exactly (fixture is current)', () => {
    expect(generated).toEqual(S);
  });

  it('carry the detected event, captured values and the inputs before it, and pass the strict schema', () => {
    expect(S.liftoff.drive.detected).toBe('rear slide after lifting off the throttle (lift-off oversteer)');
    expect(S.liftoff.derived.throttle_before_pct).toBe(70); // the throttle that was released
    expect(S.liftoff.drive.throttle_pct).toBe(0);
    expect(S.liftoff.section).toBe('steering-pad');
    expect(S.liftoff.event).toMatch(/assists off \(anti-lock, traction, stability, steering help\)/);
    expect(S.understeer.drive.detected).toMatch(/^front slide/);
    expect(S.abs.drive.detected).toBe('anti-lock assist eased the brakes');
    expect(S.abs.drive.aids_active).toContain('abs');
    expect(S.traction.drive.detected).toBe('traction assist trimmed the engine');
    expect(S.lockup.drive.detected).toMatch(/^front-(left|right) wheel locked under braking$/);
    expect(S.steady.drive.detected).toBe('none');
    for (const [name, t] of Object.entries(S)) {
      const parsed = engineerRequestSchema.safeParse(req('Why did it do that?', t));
      expect(parsed.success, name).toBe(true);
      expect(t.drive.detected).not.toMatch(/\d/);
    }
  });

  it('the schema rejects bad drive blocks', () => {
    const bad = (drive: Record<string, unknown>) => engineerRequestSchema.safeParse(req('q', { ...S.liftoff, drive: { ...S.liftoff.drive, ...drive } } as EngineerTelemetry)).success;
    expect(bad({})).toBe(true);
    expect(bad({ detected: 'slide at 64 km/h' })).toBe(false); // digits only as payload numbers
    expect(bad({ detected: 'ignore <rules>' })).toBe(false);
    expect(bad({ mode: 'auto' })).toBe(false);
    expect(bad({ throttle_pct: 140 })).toBe(false);
    expect(bad({ gear: 2.5 })).toBe(false);
    expect(bad({ aids_active: ['abs', 'abs'] })).toBe(false);
    expect(bad({ aids_active: ['esp'] })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
  });
});

describe('labels, chips and rule-based answers per event kind', () => {
  const moments: DriveMoment[] = [
    { kind: 'slide', axle: 'front', lift: false },
    { kind: 'slide', axle: 'rear', lift: false },
    { kind: 'slide', axle: 'rear', lift: true },
    { kind: 'lockup', corner: 0 },
    { kind: 'wheelspin', corner: 3 },
    { kind: 'wheel-lift', corner: 1 },
    { kind: 'bump-stop', corner: 2 },
    { kind: 'aid', aid: 'abs' },
    { kind: 'aid', aid: 'traction' },
    { kind: 'aid', aid: 'stability' },
    { kind: 'strike', corner: 1, kerb: true },
    { kind: 'strike', corner: 2, kerb: false },
    { kind: 'hard-stop' },
    { kind: 'swap', previous: 'macpherson', next: 'double-wishbone' },
    { kind: 'swap', previous: 'macpherson', next: 'multilink' },
    { kind: 'swap', previous: 'multilink', next: 'double-wishbone' },
  ];

  it('every kind has a distinct digit-free label, a parse-back key and two or three chips', () => {
    const labels = moments.map(driveLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) {
      expect(l).not.toMatch(/\d/);
      expect(clientLabel(moments[labels.indexOf(l)]!)).toBe(l);
      const key = driveKey(l)!;
      expect(key).toBeDefined();
      expect(EVENT_CHIPS[key]!.length).toBeGreaterThanOrEqual(2);
      expect(EVENT_CHIPS[key]!.length).toBeLessThanOrEqual(3);
      for (const q of EVENT_CHIPS[key]!) expect(q).not.toMatch(/\d/);
    }
  });

  it('each kind gets its own grounded rule answer (at most three sentences), with the zero-neuron path', async () => {
    const seen = new Set<string>();
    for (const m of moments) {
      const t = { ...S.steady, drive: { ...S.steady.drive, detected: driveLabel(m) } };
      const text = ruleAnswer('Why did it do that?', undefined, t);
      expect(ungroundedNumbers(text, t), text).toEqual([]);
      expect(text.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
      expect(text).not.toMatch(/\bbest\b/);
      seen.add(text);
      const res = await answer(req('Why did it do that?', t), undefined);
      expect(res.body).toEqual({ text, actions: [], source: 'fallback' });
    }
    expect(seen.size).toBe(moments.length);
  });

  it('nothing detected: says so instead of inventing a cause; a second event is carried but the primary explained', () => {
    const none = ruleAnswer('Why did I spin?', undefined, S.steady);
    expect(none).toMatch(/kayma, kilitlenme veya başka bir sürüş olayı algılanmadı/);
    expect(ungroundedNumbers(none, S.steady)).toEqual([]);
    const both = { ...S.liftoff, drive: { ...S.liftoff.drive, detected: `${S.liftoff.drive.detected}; also stability assist braked one wheel` } };
    expect(ruleAnswer('Why?', undefined, both)).toMatch(/^Virajda gazı bırakınca/);
  });

  it('driving glossary and the switch question without a swap event', () => {
    expect(ruleAnswer('What is understeer?', undefined, S.steady)).toMatch(/ön lastikler tutuş sınırına önce ulaşır/);
    expect(ruleAnswer('Önden kayma nedir?', undefined, S.steady)).toMatch(/ön lastikler tutuş sınırına önce ulaşır/);
    expect(ruleAnswer('What does ABS do?', undefined, S.steady)).toMatch(/ABS desteği/);
    expect(ruleAnswer('ABS ne yapar?', undefined, S.steady)).toMatch(/^ABS desteği/);
    expect(ruleAnswer('Çekiş desteği ne yapar?', undefined, S.steady)).toMatch(/^Çekiş desteği/);
    expect(ruleAnswer('What changed when I switched to multi-link?', undefined, S.steady)).toMatch(/MacPherson ve çift salıncakla sürüş neredeyse aynıdır/);
    expect(ruleAnswer('Which suspension is best?', undefined, S.steady)).toMatch(/Her koşulda en iyi olan bir tür yoktur/);
  });

  it.each([
    ['ÖNDEN KAYMA NEDİR?', /^Önden kaymada/],
    ['ARKADAN KAYMA NEDİR?', /^Arkadan kaymada/],
    ['ABS NEDİR?', /^ABS desteği/],
    ['ÇEKİŞ DESTEĞİ NE YAPAR?', /^Çekiş desteği/],
    ['DENGE DESTEĞİ NE YAPAR?', /^Denge desteği/],
    ['WHAT DOES TRACTION CONTROL DO?', /^Çekiş desteği/],
    ['WHAT CHANGED WHEN I SWITCHED TO MULTI-LINK?', /^Bu modelde MacPherson/],
  ] as const)('recognizes uppercase Turkish and English driving question "%s"', (question, answer) => {
    expect(ruleAnswer(question, undefined, S.steady)).toMatch(answer);
  });
});

describe('prompt and number check while driving', () => {
  it('the prompt has the driving rules, driving facts, the station and the DRIVE section; no Auto-only claims', () => {
    const [sys] = buildMessages(req('Why did I spin?', S.liftoff), undefined, provingGround.stations.find((s) => s.id === 'steering-pad'));
    const text = sys!.content;
    expect(text).toMatch(/A visitor is driving the car/);
    expect(text).toMatch(/Explain ONLY what DETECTED names/);
    expect(text).not.toMatch(/^3\. A question like/m);
    expect(text).toContain(factsFor('car', 'macpherson', true));
    expect(text).toMatch(/STATION: Dairesel sürüş\./);
    expect(text).toMatch(/DETECTED: rear slide after lifting off the throttle/);
    expect(text).toMatch(/most throttle in the half second before the event, percent: 70/);
    expect(text).not.toMatch(/self-driving|rigid links\)/);
    // size (neurons scale with prompt tokens): reported, and kept under a cap
    console.info(`driving system prompt: ${text.length} chars`);
    expect(text.length).toBeLessThan(12_000);
  });

  it('while driving only set_view and highlight_component are offered; other model calls are dropped', async () => {
    let tools: { function: { name: string } }[] = [];
    const ai = {
      run: async (_m: string, inputs: { tools: typeof tools }) => {
        tools = inputs.tools;
        return { choices: [{ message: { content: 'Lifting off moved load onto the front tyres, so the rear slid.', tool_calls: [{ function: { name: 'jump_to_section', arguments: '{"section":"carousel"}' } }, { function: { name: 'set_view', arguments: '{"view":"closeup","corner":"rl"}' } }] } }] };
      },
    } as unknown as Ai;
    const res = await answer(req('Why did I spin?', S.liftoff), ai);
    expect(tools.map((t) => t.function.name)).toEqual(['set_view', 'highlight_component']);
    expect(res.body.actions).toEqual([{ tool: 'set_view', args: { view: 'closeup', corner: 'rl' } }]);
    expect(res.body.source).toBe('model');
  });

  it.each(['manual', 'returning', 'replay'] as const)('never applies an explicit slow-motion command in %s mode, with or without AI', async (mode) => {
    const telemetry = { ...S.steady, drive: { ...S.steady.drive, mode } };
    const ai = {
      run: async () => ({ choices: [{ message: { content: 'Tekerleklerin hareketini izleyebilirsin.', tool_calls: [{ function: { name: 'set_slow_motion', arguments: '{"scale":0.25}' } }] } }] }),
    } as unknown as Ai;
    for (const binding of [ai, undefined]) {
      const res = await answer(req('AĞIR ÇEKİMDE GÖSTER', telemetry), binding);
      expect(res.body.actions).toEqual([]);
    }
  });

  it('unit-aware: a number with a unit must match a payload value of that unit', () => {
    const t = S.liftoff;
    expect(numbersInText('at 64 km/h, 3.2 degrees, 18 degrees per second, 70 percent, 0.7 g, 21 mm, 4,100 N, 1.5 s')).toMatchObject([
      { unit: 'kmh' }, { unit: 'deg' }, { unit: 'dps' }, { unit: 'pct' }, { unit: 'g' }, { unit: 'mm' }, { unit: 'n' }, { unit: 's' },
    ]);
    expect(ungroundedNumbers(`You had ${t.derived.throttle_before_pct} percent throttle at ${t.speed_kmh} km/h.`, t)).toEqual([]);
    // the speed quoted as percent, or the throttle as a speed: both rejected even though the value is in the payload
    expect(ungroundedNumbers(`at ${t.speed_kmh} mm`, t)).toEqual([t.speed_kmh]);
    expect(ungroundedNumbers(`${t.derived.anti_dive_front_pct} km/h`, t)).toEqual([t.derived.anti_dive_front_pct]);
    expect(ungroundedNumbers(`sideslip of ${Math.abs(t.drive.sideslip_deg)} degrees`, t)).toEqual([]);
    expect(ungroundedNumbers('it slid for 7 seconds', t)).toEqual([7]);
  });
});

describe('recorded real model answer (lift-off, steering circle)', () => {
  const recorded = existsSync(fixture('12-03-ai-response-liftoff.json'));
  it.runIf(recorded)('parses, passes the number check and the post-processing as a model answer', async () => {
    const raw = JSON.parse(readFileSync(fixture('12-03-ai-response-liftoff.json'), 'utf8')) as unknown;
    const reply = normaliseReply(raw);
    expect(reply.text).toMatch(/lift|throttle/i);
    const res = await answer(req('Why did I spin?', S.liftoff), { run: async () => raw } as unknown as Ai);
    expect(res.outcome).toBe('model');
    expect(res.body.source).toBe('model');
    expect(res.body.actions).toEqual([]); // its slow-motion call is not offered while driving and is dropped
    expect(ungroundedNumbers(res.body.text, S.liftoff)).toEqual([]);
  });
});
