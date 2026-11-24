/**
 * 10-04 Drive UX v2: gamepad mapping and conditioning, hot-plug and command edges, rumble levels and pacing, touch
 * slider and pedal ramps, hand-back decision, out-of-bounds respawn choice, fade curve, stations copy in the UI.
 * (A real controller was not available: the Gamepad API is exercised through structural fakes here and a mocked
 * `navigator.getGamepads` in the e2e.)
 */
import { describe, expect, it } from 'vitest';
import { neutralIntent } from '../../src/contracts/drive';
import type { CornerFrame } from '../../src/contracts/telemetry';
import { BUTTON, canRumble, createGamepadSource, curve, deadZone, PAD, padIntent, pickPad, type PadLike } from '../../src/features/drive/gamepad';
import { FADE, fadeOpacity, handBackKind, LOOP_NEAR, nearestSpawn, returningLabel } from '../../src/features/drive/handback';
import { createRumble, createRumbleState, RUMBLE, rumbleLevels } from '../../src/features/drive/rumble';
import { approach, sliderSteer, TOUCH } from '../../src/features/drive/touch';
import { provingGround } from '../../src/sim-core/content/proving-ground';

const btn = (value = 0) => ({ value, pressed: value > 0.5 });
function fakePad(over: Partial<{ x: number; rt: number; lt: number; a: number; y: number; xBtn: number; index: number; mapping: string; effects: string[] | undefined; noActuator: boolean }> = {}) {
  const buttons = Array.from({ length: 17 }, () => btn());
  buttons[BUTTON.rt] = btn(over.rt ?? 0);
  buttons[BUTTON.lt] = btn(over.lt ?? 0);
  buttons[BUTTON.a] = btn(over.a ?? 0);
  buttons[BUTTON.y] = btn(over.y ?? 0);
  buttons[BUTTON.x] = btn(over.xBtn ?? 0);
  const played: Record<string, number>[] = [];
  const pad: PadLike & { played: typeof played } = {
    id: 'Fake pad (STANDARD GAMEPAD)',
    index: over.index ?? 0,
    connected: true,
    mapping: over.mapping ?? 'standard',
    timestamp: 1,
    axes: [over.x ?? 0, 0, 0, 0],
    buttons,
    vibrationActuator: over.noActuator
      ? null
      : {
          effects: 'effects' in over ? over.effects : ['dual-rumble'],
          playEffect: (_t: string, p: Record<string, number>) => {
            played.push(p);
            return Promise.resolve('complete');
          },
          reset: () => Promise.resolve('complete'),
        },
    played,
  };
  return pad;
}

describe('gamepad conditioning (ARCH-M2 §10.4)', () => {
  it('axial dead zone: 0 inside, continuous at the edge, ±1 at full, monotonic, NaN-safe', () => {
    expect(deadZone(0.11, 0.12)).toBe(0);
    expect(deadZone(-0.12, 0.12)).toBe(0);
    expect(deadZone(0.1201, 0.12)).toBeCloseTo(0, 3);
    expect(deadZone(1, 0.12)).toBe(1);
    expect(deadZone(-1, 0.12)).toBe(-1);
    expect(deadZone(1.3, 0.12)).toBe(1); // over-range pads clamp
    expect(deadZone(Number.NaN, 0.12)).toBe(0);
    let prev = -Infinity;
    for (let x = -1; x <= 1; x += 0.01) {
      const y = curve(deadZone(x, PAD.stickDeadZone), PAD.stickExponent);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
      prev = y;
    }
    // exponent > 1: finer near the centre (half stick = less than half lock), full stick = full lock
    expect(curve(0.5, 1.6)).toBeLessThan(0.5);
    expect(curve(-0.5, 1.6)).toBeCloseTo(-curve(0.5, 1.6), 12);
  });

  it('mapping: stick right = steer right (negative), RT throttle, LT brake (analog), X handbrake; rest = not deliberate', () => {
    const out = neutralIntent();
    expect(padIntent(fakePad({ x: 0.08, rt: 0.02, lt: 0.03 }), out)).toBe(false); // rest noise
    expect(out).toMatchObject({ steer: -0, throttle: 0, brake: 0, handbrake: 0, digital: false, source: 'gamepad' });
    expect(padIntent(fakePad({ x: 1 }), out)).toBe(true);
    expect(out.steer).toBe(-1);
    padIntent(fakePad({ x: -0.6 }), out);
    expect(out.steer).toBeGreaterThan(0);
    expect(out.steer).toBeLessThan(0.6);
    padIntent(fakePad({ rt: 0.5, lt: 1 }), out);
    expect(out.throttle).toBeCloseTo((0.5 - PAD.triggerDeadZone) / (1 - PAD.triggerDeadZone), 12);
    expect(out.brake).toBe(1);
    expect(padIntent(fakePad({ xBtn: 1 }), out)).toBe(true);
    expect(out.handbrake).toBe(1);
  });

  it('only standard-mapping pads; the last one used stays preferred', () => {
    const a = fakePad({ index: 0 });
    const b = fakePad({ index: 1 });
    const odd = fakePad({ index: 2, mapping: '' });
    expect(pickPad([null, odd], -1)).toBeNull();
    expect(pickPad([a, b], -1)).toBe(a);
    expect(pickPad([a, b], 1)).toBe(b);
    expect(pickPad([null, b], 0)).toBe(b);
  });

  it('source: A / Y act on the press edge only, a button held while plugging in is not a press; hot-plug reported once each way', () => {
    let pads: (PadLike | null)[] = [];
    const commands: string[] = [];
    const presence: (string | null)[] = [];
    const src = createGamepadSource(
      (c) => commands.push(c),
      (p) => presence.push(p ? p.id : null),
      () => pads,
    );
    const out = neutralIntent();
    expect(src.read(out)).toBe(false);
    expect(presence).toEqual([]);
    pads = [fakePad({ a: 1 })]; // plugged in with A held
    src.read(out);
    expect(presence).toEqual(['Fake pad (STANDARD GAMEPAD)']);
    expect(commands).toEqual([]);
    pads = [fakePad()];
    src.read(out);
    pads = [fakePad({ a: 1 })];
    src.read(out);
    src.read(out); // still held
    pads = [fakePad({ y: 1 })];
    src.read(out);
    expect(commands).toEqual(['toggle', 'reset']);
    pads = [fakePad({ rt: 1 })];
    expect(src.read(out)).toBe(true);
    expect(commands.at(-1)).toBe('input');
    pads = [null];
    expect(src.read(out)).toBe(false);
    expect(presence).toEqual(['Fake pad (STANDARD GAMEPAD)', null]);
    // a throwing getGamepads (permissions policy) is no pad
    const quiet = createGamepadSource(() => {}, () => {}, () => {
      throw new Error('blocked');
    });
    expect(quiet.read(out)).toBe(false);
  });
});

describe('rumble (research m2/18 §3)', () => {
  const corner = (over: Partial<CornerFrame> = {}) => ({ travelRate: 0, gripUse: 0.3, stop: 0, surface: 'asphalt' as const, load: 4000, ...over });
  const run = (corners: ReturnType<typeof corner>[], seconds: number, abs = false, driving = true) => {
    const st = createRumbleState();
    const out = { weak: 0, strong: 0 };
    let maxWeak = 0;
    let maxStrong = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      rumbleLevels(corners, { absActive: abs }, driving, 1 / 60, st, out);
      maxWeak = Math.max(maxWeak, out.weak);
      maxStrong = Math.max(maxStrong, out.strong);
    }
    return { st, out, maxWeak, maxStrong };
  };

  it('smooth road: nothing; washboard: weak only; limit adds a little; everything capped and zero outside Manual', () => {
    expect(run([corner(), corner(), corner(), corner()], 1).maxWeak).toBe(0);
    const rough = run([0.4, -0.4, 0.4, -0.4].map((v) => corner({ travelRate: v })), 1);
    expect(rough.out.weak).toBeGreaterThan(0.2);
    expect(rough.maxStrong).toBe(0);
    const limit = run([corner({ gripUse: 1.2 }), corner(), corner(), corner()], 1);
    expect(limit.out.weak).toBeCloseTo(0.2, 6);
    const all = run([corner({ travelRate: 3, gripUse: 2 }), corner({ travelRate: 3 }), corner(), corner()], 1);
    expect(all.maxWeak).toBeLessThanOrEqual(RUMBLE.max);
    const off = run([corner({ travelRate: 3, stop: 1 })], 1, true, false);
    expect(off.maxWeak + off.maxStrong).toBe(0);
  });

  it('strong = a short pulse on the edge of a bump stop, a kerb strike or ABS starting (not while it stays)', () => {
    const st = createRumbleState();
    const out = { weak: 0, strong: 0 };
    const dt = 1 / 60;
    let frames = 0;
    for (let i = 0; i < 60; i++) {
      rumbleLevels([corner({ stop: 1 })], { absActive: false }, true, dt, st, out);
      if (out.strong > 0) frames++;
    }
    expect(frames).toBeGreaterThan(0);
    expect(frames * dt).toBeLessThanOrEqual(RUMBLE.pulseS + 2 * dt);
    rumbleLevels([corner({ surface: 'kerb' })], { absActive: false }, true, dt, st, out);
    expect(out.strong).toBeCloseTo(0.4, 6);
    const st2 = createRumbleState();
    rumbleLevels([corner()], { absActive: true }, true, dt, st2, out);
    expect(out.strong).toBeCloseTo(0.25, 6);
  });

  it('effects: dual-rumble only when the actuator offers it, at most every period, a reset when it goes quiet', () => {
    expect(canRumble(fakePad({ noActuator: true }))).toBe(false);
    expect(canRumble(fakePad({ effects: ['trigger-rumble'] }))).toBe(false);
    expect(canRumble(fakePad({ effects: undefined }))).toBe(true); // older engines: playEffect without the list
    expect(canRumble(null)).toBe(false);
    const pad = fakePad();
    const r = createRumble();
    for (let t = 0; t < 1; t += 1 / 120) r.update(pad, 0.2, 0, t);
    expect(pad.played.length).toBeGreaterThan(15);
    expect(pad.played.length).toBeLessThanOrEqual(21); // <= 20 Hz
    expect(pad.played[0]).toMatchObject({ duration: RUMBLE.durationMs, weakMagnitude: 0.2, strongMagnitude: 0 });
    const none = fakePad({ noActuator: true });
    expect(() => r.update(none, 1, 1, 2)).not.toThrow();
  });
});

describe('touch (ARCH-M2 §10.4)', () => {
  it('slider: relative drag, dead band, drag right = steer right (negative), clamped', () => {
    expect(sliderSteer(0, 100)).toBe(0);
    expect(sliderSteer(TOUCH.deadPx, 100)).toBe(0);
    expect(sliderSteer(40, 100)).toBeLessThan(0);
    expect(sliderSteer(-40, 100)).toBeCloseTo(-sliderSteer(40, 100), 12);
    expect(sliderSteer(500, 100)).toBe(-1);
    expect(sliderSteer(100 * TOUCH.fullLock, 100)).toBeCloseTo(-1, 12);
    expect(sliderSteer(10, 0)).toBe(0);
  });

  it('pedal ramp: rises and falls at its rates without overshoot', () => {
    let x = 0;
    for (let i = 0; i < 6; i++) x = approach(x, 1, TOUCH.pedalRise, TOUCH.pedalFall, 1 / 60);
    expect(x).toBeCloseTo((6 * TOUCH.pedalRise) / 60, 12);
    for (let i = 0; i < 60; i++) x = approach(x, 1, TOUCH.pedalRise, TOUCH.pedalFall, 1 / 60);
    expect(x).toBe(1);
    x = approach(x, 0, TOUCH.pedalRise, TOUCH.pedalFall, 1 / 60);
    expect(x).toBeCloseTo(1 - TOUCH.pedalFall / 60, 12);
    for (let i = 0; i < 60; i++) x = approach(x, 0, TOUCH.pedalRise, TOUCH.pedalFall, 1 / 60);
    expect(x).toBe(0);
  });
});

describe('hand-back and recovery (orchestrator decisions 2 and 5)', () => {
  const annex = new Set([...provingGround.zones.map((z) => z.id), 'field']);

  it('Returning on or beside the loop; a release from the annex or far from the line', () => {
    expect(handBackKind('loop', 0.5, annex)).toBe('return');
    expect(handBackKind('loop', -LOOP_NEAR, annex)).toBe('return');
    expect(handBackKind('terrain', 12, annex)).toBe('return'); // spun into the runoff beside the loop
    expect(handBackKind('loop', LOOP_NEAR + 1, annex)).toBe('release');
    expect(handBackKind('terrain', Number.NaN, annex)).toBe('release'); // off the loop corridor
    for (const zone of ['ride-street', 'dynamics-pad', 'braking-platform', 'apron', 'spur-east', 'field']) expect(handBackKind(zone, 3, annex)).toBe('release');
  });

  it('out of bounds: the nearest station spawn when it is closer than the loop, else the driving line', () => {
    const st = provingGround.stations;
    expect(nearestSpawn(0, -400, 300, st)).toBeUndefined();
    expect(nearestSpawn(-120, 340, 400, st)).toBe('steering-pad');
    expect(nearestSpawn(150, 300, 450, st)).toBe('braking-platform');
    expect(nearestSpawn(-300, 124, Number.NaN, st)).toBe('ride-street');
  });

  it('fade: out then in over FADE, or in only after a cut; starts and ends clear', () => {
    expect(fadeOpacity(0, true)).toBe(0);
    expect(fadeOpacity(FADE.out, true)).toBe(1);
    expect(fadeOpacity(0, false)).toBe(1);
    expect(fadeOpacity(FADE.in / 2, false)).toBeCloseTo(0.5, 6);
    expect(fadeOpacity(FADE.in, false)).toBe(0);
    expect(fadeOpacity(FADE.out + FADE.in, true)).toBe(0);
    for (let t = 0; t < 1; t += 0.01) {
      expect(fadeOpacity(t, true)).toBeGreaterThanOrEqual(0);
      expect(fadeOpacity(t, true)).toBeLessThanOrEqual(1);
    }
    expect(FADE.in).toBeCloseTo(0.35, 12);
  });

  it('Returning chip words; stations copy shown in the UI has no digits and no rankings', () => {
    expect(returningLabel('recover')).toBe('Sürüş çizgisi aranıyor…');
    expect(returningLabel('track')).toBe('Tura dönülüyor…');
    expect(returningLabel(undefined)).toBe('Sürüş çizgisi aranıyor…');
    for (const s of provingGround.stations) {
      for (const text of [s.name, s.caption, s.experiment]) {
        expect(text).not.toMatch(/\d/);
        expect(text).not.toMatch(/\b(score|best|fastest|rank|record|lap time|beat)\b/i);
      }
    }
  });
});
