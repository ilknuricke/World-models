/** 08-03 take the wheel: key table, takeover edges, neutral-before-retake, keyboard plumbing, idle timing; 09-05 HUD. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDriveFrame, DEFAULT_AIDS, neutralIntent, type DriveFrame, type DriveIntent, type DriveMode } from '../../src/contracts/drive';
import type { DriveIntentSource } from '../../src/contracts/services';
import { createArbiter, HYSTERESIS_S } from '../../src/features/drive/arbiter';
import { handBackAfter, idleState, noteFault, promptVisible, TIMING } from '../../src/features/drive/idle';
import { AID_COPY, AID_KEYS, aidsSummary, LAMP_HOLD_S, LAMP_TEXT, LAMP_TITLE, LAMPS, updateLamps, withAid } from '../../src/features/drive/hud';
import { capturesCode, gearLabel, isDriving, keyIntent } from '../../src/features/drive/keys';

const intentOf = (...codes: string[]) => {
  const out = neutralIntent('touch');
  const deliberate = keyIntent(new Set(codes), out);
  return { deliberate, steer: out.steer, throttle: out.throttle, brake: out.brake, handbrake: out.handbrake, digital: out.digital, source: out.source };
};

describe('keyboard map (ARCH-M2 §10.1)', () => {
  it('maps codes to a digital keyboard intent; + steer = left; opposite keys cancel', () => {
    expect(intentOf()).toEqual({ deliberate: false, steer: 0, throttle: 0, brake: 0, handbrake: 0, digital: true, source: 'keyboard' });
    expect(intentOf('KeyW')).toMatchObject({ deliberate: true, throttle: 1 });
    expect(intentOf('ArrowUp')).toMatchObject({ throttle: 1, brake: 0 });
    expect(intentOf('KeyS')).toMatchObject({ brake: 1, throttle: 0 });
    expect(intentOf('ArrowDown')).toMatchObject({ brake: 1 });
    expect(intentOf('KeyA')).toMatchObject({ steer: 1 });
    expect(intentOf('ArrowLeft')).toMatchObject({ steer: 1 });
    expect(intentOf('KeyD')).toMatchObject({ steer: -1 });
    expect(intentOf('ArrowRight')).toMatchObject({ steer: -1 });
    expect(intentOf('ShiftLeft')).toMatchObject({ handbrake: 1 });
    expect(intentOf('ArrowUp', 'ArrowLeft')).toMatchObject({ throttle: 1, steer: 1 });
    // A + D cancel to straight, but the visitor is still deliberately pressing keys
    expect(intentOf('KeyA', 'KeyD')).toMatchObject({ deliberate: true, steer: 0 });
  });

  it('in Auto only W and the arrows are captured (A and S keep their M1 meanings); in Manual all driving keys', () => {
    for (const code of ['KeyW', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) expect(capturesCode(code, 'auto')).toBe(true);
    for (const code of ['KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyR', 'Space', 'Digit1']) expect(capturesCode(code, 'auto')).toBe(false);
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])
      expect(capturesCode(code, 'manual')).toBe(true);
    for (const code of ['KeyR', 'Enter', 'Space', 'KeyV', 'Digit2']) expect(capturesCode(code, 'manual')).toBe(false);
    expect(capturesCode('KeyA', 'returning')).toBe(false);
  });

  it('gear label', () => {
    expect([-1, 0, 1, 6].map(gearLabel)).toEqual(['R', 'N', '1', '6']);
  });
});

/** A scripted source: `on` = deliberate, writes throttle 1 while on. */
function fakeSource(id: DriveIntentSource['id']) {
  const s: { on: boolean; steer: number; source: DriveIntentSource } = {
    on: false,
    steer: 0,
    source: {
      id,
      read(out: DriveIntent) {
        out.throttle = s.on ? 1 : 0;
        out.steer = s.steer;
        out.source = id;
        return s.on;
      },
    },
  };
  return s;
}

describe('arbiter: takeover edges', () => {
  it('a fresh press is reported once; holding never re-triggers (no mode flicker)', () => {
    const a = createArbiter();
    const k = fakeSource('keyboard');
    a.add(k.source);
    const out = neutralIntent();
    expect(a.update(0, out)).toEqual({ fresh: false, deliberate: false });
    k.on = true;
    expect(a.update(0.016, out).fresh).toBe(true);
    expect(out.throttle).toBe(1);
    for (let i = 2; i < 120; i++) expect(a.update(i * 0.016, out)).toEqual({ fresh: false, deliberate: true });
    k.on = false;
    a.update(2, out);
    expect(out.throttle).toBe(0);
    k.on = true;
    expect(a.update(2.016, out).fresh).toBe(true);
  });

  it('after a hand-back the input must return to neutral before it can take over again', () => {
    const a = createArbiter();
    const k = fakeSource('keyboard');
    const g = fakeSource('gamepad');
    a.add(k.source);
    a.add(g.source);
    const out = neutralIntent();
    k.on = true;
    expect(a.update(0, out).fresh).toBe(true);
    a.disarm(); // Enter while still holding ↑
    expect(a.armed).toBe(false);
    for (let i = 1; i < 30; i++) expect(a.update(i * 0.016, out).fresh).toBe(false);
    // another source pressing while the first is still held: still not armed
    g.on = true;
    expect(a.update(0.5, out).fresh).toBe(false);
    g.on = false;
    k.on = false;
    expect(a.update(0.6, out)).toEqual({ fresh: false, deliberate: false });
    expect(a.armed).toBe(true);
    g.on = true;
    expect(a.update(0.7, out).fresh).toBe(true);
  });

  it('most recent deliberate source wins after 1 s of hysteresis; the output is neutral when the active one is idle', () => {
    const a = createArbiter();
    const k = fakeSource('keyboard');
    const g = fakeSource('gamepad');
    a.add(k.source);
    a.add(g.source);
    const out = neutralIntent();
    k.on = true;
    a.update(0, out);
    expect(a.active).toBe('keyboard');
    k.on = false;
    a.update(0.1, out);
    expect(out).toMatchObject({ throttle: 0, source: 'keyboard' });
    g.on = true;
    g.steer = 0.5;
    a.update(0.1 + HYSTERESIS_S / 2, out);
    expect(a.active).toBe('keyboard'); // within the hysteresis window
    expect(out.steer).toBe(0);
    a.update(1.2, out);
    expect(a.active).toBe('gamepad');
    expect(out).toMatchObject({ steer: 0.5, throttle: 1, source: 'gamepad' });
  });

  it('a removed source stops counting', () => {
    const a = createArbiter();
    const k = fakeSource('keyboard');
    const remove = a.add(k.source);
    k.on = true;
    a.update(0, neutralIntent());
    remove();
    expect(a.active).toBeNull();
    expect(a.update(1, neutralIntent()).deliberate).toBe(false);
  });
});

describe('hint and idle timing (§10.2, decision 5)', () => {
  const st = { countdown: 0, handBack: false };
  it('cue counts 3-2-1 before a 12 s hand-back; 30 s on the presenter screen', () => {
    expect(handBackAfter(false)).toBe(12);
    expect(handBackAfter(true)).toBe(30);
    expect(idleState(0, false, st)).toEqual({ countdown: 0, handBack: false });
    expect(idleState(8.99, false, st)).toEqual({ countdown: 0, handBack: false });
    expect(idleState(9.01, false, st)).toEqual({ countdown: 3, handBack: false });
    expect(idleState(10.5, false, st)).toEqual({ countdown: 2, handBack: false });
    expect(idleState(11.99, false, st)).toEqual({ countdown: 1, handBack: false });
    expect(idleState(12, false, st)).toEqual({ countdown: 0, handBack: true });
    expect(idleState(26.9, true, st)).toEqual({ countdown: 0, handBack: false });
    expect(idleState(27.1, true, st)).toEqual({ countdown: 3, handBack: false });
    expect(idleState(30, true, st).handBack).toBe(true);
  });

  it('the Auto prompt shows from 4 s for 8 s', () => {
    expect(promptVisible(TIMING.promptAfter - 0.01)).toBe(false);
    expect(promptVisible(4)).toBe(true);
    expect(promptVisible(11.9)).toBe(true);
    expect(promptVisible(12)).toBe(false);
  });
});

// ---------------------------------------------------------------- keyboard source with a minimal DOM shim

class FakeElement extends EventTarget {
  constructor(private readonly sel: string) {
    super();
  }
  isContentEditable = false;
  matches(selector: string) {
    return selector.split(',').some((s) => s.trim() === this.sel);
  }
}

describe('keyboard source', () => {
  const g = globalThis as Record<string, unknown>;
  let win: EventTarget;
  let doc: EventTarget & { visibilityState: string };
  let createKeyboardSource: typeof import('../../src/features/drive/keyboard').createKeyboardSource;

  beforeAll(async () => {
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    g.window = win;
    g.document = doc;
    g.HTMLElement = FakeElement;
    g.Element = FakeElement;
    ({ createKeyboardSource } = await import('../../src/features/drive/keyboard'));
  });
  afterEach(() => {
    doc.visibilityState = 'visible';
  });

  const key = (type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}) => {
    const { target = null, ...rest } = extra;
    const e = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...rest });
    Object.defineProperty(e, 'target', { value: target });
    win.dispatchEvent(e);
    return e;
  };

  function setup(start: DriveMode = 'auto') {
    const st = { mode: start, commands: [] as string[] };
    const src = createKeyboardSource(
      () => st.mode,
      (c) => st.commands.push(c),
    );
    const out = neutralIntent();
    return { st, src, out, read: () => src.read(out) };
  }

  it('holds keys until keyup, ignores repeats, and clears on blur, hidden tab and context menu', () => {
    const { st, src, out, read } = setup('manual');
    key('keydown', 'KeyW');
    key('keydown', 'KeyW', { repeat: true });
    key('keydown', 'KeyA');
    expect(read()).toBe(true);
    expect(out).toMatchObject({ throttle: 1, steer: 1 });
    key('keyup', 'KeyA');
    read();
    expect(out).toMatchObject({ throttle: 1, steer: 0 });
    win.dispatchEvent(new Event('blur'));
    expect(read()).toBe(false);
    expect(out.throttle).toBe(0);
    key('keydown', 'ArrowUp');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(read()).toBe(false);
    key('keydown', 'ArrowUp');
    win.dispatchEvent(new Event('contextmenu'));
    expect(read()).toBe(false);
    expect(st.commands.filter((c) => c === 'input')).toHaveLength(4);
    src.dispose();
  });

  it('Auto: A and S are not captured, W and arrows are; a tap shorter than a frame still counts once', () => {
    const { st, src, read } = setup('auto');
    key('keydown', 'KeyS');
    key('keydown', 'KeyA');
    expect(read()).toBe(false);
    key('keyup', 'KeyS');
    key('keyup', 'KeyA');
    key('keydown', 'ArrowLeft');
    key('keyup', 'ArrowLeft');
    expect(read()).toBe(true); // the tap
    expect(read()).toBe(false);
    expect(st.commands).toEqual(['input']);
    src.dispose();
  });

  it('preventDefault only while driving; text inputs are never read', () => {
    const { st, src, read } = setup('auto');
    expect(key('keydown', 'ArrowUp').defaultPrevented).toBe(false);
    key('keyup', 'ArrowUp');
    read();
    st.mode = 'manual';
    expect(key('keydown', 'ArrowUp').defaultPrevented).toBe(true);
    expect(key('keyup', 'ArrowUp').defaultPrevented).toBe(true);
    read();
    const input = new FakeElement('input');
    expect(key('keydown', 'KeyW', { target: input }).defaultPrevented).toBe(false);
    expect(read()).toBe(false);
    expect(key('keydown', 'Enter', { target: input }).defaultPrevented).toBe(false);
    expect(st.commands).toEqual(['input', 'input']);
    src.dispose();
  });

  it('Enter toggles (not on a focused button, not on repeat); R resets only while driving; modifiers are ignored', () => {
    const { st, src } = setup('auto');
    key('keydown', 'KeyR');
    key('keydown', 'Enter');
    key('keydown', 'Enter', { repeat: true });
    key('keydown', 'Enter', { target: new FakeElement('button') });
    expect(st.commands).toEqual(['toggle']);
    st.mode = 'manual';
    key('keydown', 'KeyR');
    key('keydown', 'KeyR', { repeat: true });
    key('keydown', 'KeyW', { ctrlKey: true });
    key('keydown', 'NumpadEnter');
    expect(st.commands).toEqual(['toggle', 'reset', 'toggle']);
    src.dispose();
  });
});

describe('handling HUD (09-05; ARCH-M2 §10.2, §10.5, §13)', () => {
  const flags = (o: Partial<Pick<DriveFrame, 'absActive' | 'tractionActive' | 'stabilityActive' | 'approximate'>> = {}) => ({
    absActive: false,
    tractionActive: false,
    stabilityActive: false,
    approximate: false,
    ...o,
  });
  const bit = (id: (typeof LAMPS)[number]) => 1 << LAMPS.indexOf(id);

  it('four switches, labelled as a simplified model, never a brand; copy has no digits', () => {
    expect([...AID_KEYS]).toEqual(['abs', 'traction', 'stability', 'steering']);
    const copy = [...Object.values(AID_COPY).flatMap((c) => [c.name, c.hint]), ...Object.values(LAMP_TEXT), ...Object.values(LAMP_TITLE)];
    for (const s of copy) expect(s).not.toMatch(/\d|ESP|ASR|DSC|VSC|StabiliTrak/);
    expect(aidsSummary(DEFAULT_AIDS)).toEqual({ tag: '', label: 'Sürüş destekleri: tümü açık. Destek: basitleştirilmiş model' });
    for (const key of AID_KEYS) expect(LAMP_TITLE.abs + aidsSummary(withAid(DEFAULT_AIDS, key, false)).label).toMatch(/basitleştirilmiş model/);
  });

  it('withAid flips one aid and leaves the rest; the summary names what is off', () => {
    const noAbs = withAid(DEFAULT_AIDS, 'abs', false);
    expect(noAbs).toEqual({ abs: false, traction: true, stability: true, steering: true });
    expect(DEFAULT_AIDS.abs).toBe(true); // not mutated
    expect(aidsSummary(noAbs)).toEqual({ tag: 'Bazıları kapalı', label: 'Sürüş destekleri: Kilitlenme önleyici frenler kapalı. Destek: basitleştirilmiş model' });
    const none = AID_KEYS.reduce((a, k) => withAid(a, k, false), DEFAULT_AIDS);
    expect(aidsSummary(none).tag).toBe('Kapalı');
    expect(aidsSummary(withAid(none, 'steering', true)).label).toBe('Sürüş destekleri: Kilitlenme önleyici frenler, Çekiş kontrolü, Denge kontrolü kapalı. Destek: basitleştirilmiş model');
  });

  it('lamps follow the frame.drive flags, hold briefly after an intervention, and are dark outside Manual', () => {
    const hold = new Float64Array(LAMPS.length);
    expect(updateLamps(flags(), true, 1 / 60, hold)).toBe(0);
    expect(updateLamps(flags({ absActive: true }), true, 1 / 60, hold)).toBe(bit('abs'));
    expect(updateLamps(flags({ tractionActive: true, approximate: true }), true, 1 / 60, hold)).toBe(bit('abs') | bit('traction') | bit('approximate'));
    // a pulsing ABS reads as one lamp: still lit until LAMP_HOLD_S after the last active frame
    let t = 0;
    let mask = bit('abs');
    while (mask & bit('abs')) {
      mask = updateLamps(flags({ stabilityActive: true }), true, 0.05, hold);
      t += 0.05;
    }
    expect(t).toBeGreaterThan(LAMP_HOLD_S - 1e-9);
    expect(t).toBeLessThan(LAMP_HOLD_S + 0.05 + 1e-9);
    expect(mask).toBe(bit('stability') | bit('traction') | bit('approximate')); // those two were lit one frame later
    // hand-back: everything off at once, even with a flag set
    expect(updateLamps(flags({ stabilityActive: true, approximate: true }), false, 0.01, hold)).toBe(0);
    expect([...hold]).toEqual([0, 0, 0, 0]);
  });

  it('a synthetic stop with ABS from a fake drive frame lights only the ABS lamp', () => {
    const d = createDriveFrame();
    d.mode = 'manual';
    d.absActive = true;
    expect(updateLamps(d, isDriving(d.mode), 1 / 60, new Float64Array(LAMPS.length))).toBe(bit('abs'));
  });
});

describe('Reset to road (MD-18, 13-01)', () => {
  it('fires on the third automatic restore within two seconds of sim time, then starts over', () => {
    expect(TIMING.faultResets).toBe(3);
    expect(TIMING.faultWindow).toBe(2);
    const t: number[] = [];
    expect([noteFault(t, 10), noteFault(t, 10.5), noteFault(t, 11.9)]).toEqual([false, false, true]);
    expect(t).toEqual([]);
    // spread out: never
    expect([noteFault(t, 20), noteFault(t, 21.5), noteFault(t, 23), noteFault(t, 24.5)]).toEqual([false, false, false, false]);
    // a burst after isolated restores
    expect([noteFault(t, 30), noteFault(t, 30.01), noteFault(t, 30.02)]).toEqual([false, false, true]);
  });
  it('the off-lap idle re-sync waits twenty seconds', () => expect(TIMING.rejoinAfter).toBe(20));
});

