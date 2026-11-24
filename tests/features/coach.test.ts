/** Coach (11-02): templates, honesty rules, rate limiting, fading, station cards, and lines from real detections. */
import { describe, expect, it } from 'vitest';
import type { DriveEvent } from '../../src/contracts/drive';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { createDetectorInput, createDriveDetectors, frameDetectorInput, type DriveMoment } from '../../src/sim-core/drive/events';
import {
  AFTER_S,
  belowNotice,
  CARD_REPEAT_S,
  CoachEngine,
  compose,
  GAP_S,
  KIND_SPACING_S,
  MAX_PER_KIND,
  RESET_QUIET_S,
  STALE_S,
  stationIn,
  stationLine,
  TEMPLATES,
  templateFor,
  type CoachMoment,
  type Line,
} from '../../src/features/coach/rules';
import { rig } from '../fixtures/09-04-handling';

const CAR = [
  { id: 'fl', axle: 'front', side: 1 },
  { id: 'fr', axle: 'front', side: -1 },
  { id: 'rl', axle: 'rear', side: 1 },
  { id: 'rr', axle: 'rear', side: -1 },
] as const;

function frame(): TelemetryFrame {
  const t = createTelemetryFrame('car', [...CAR]);
  t.drive.mode = 'manual';
  t.drive.u = 20;
  t.suspensionId = 'multilink';
  t.corners.forEach((c, i) => {
    c.travel = 0.012 * (i + 1);
    c.load = 2500 + 300 * i;
  });
  return t;
}

const ALL: CoachMoment[] = [
  { kind: 'slide', axle: 'front', lift: false, simTime: 0 },
  { kind: 'slide', axle: 'rear', lift: true, simTime: 0 },
  { kind: 'slide', axle: 'rear', lift: false, simTime: 0 },
  { kind: 'lockup', corner: 1, simTime: 0 },
  { kind: 'wheelspin', corner: 3, simTime: 0 },
  { kind: 'aid', aid: 'abs', simTime: 0 },
  { kind: 'aid', aid: 'traction', simTime: 0 },
  { kind: 'aid', aid: 'stability', simTime: 0 },
  { kind: 'strike', corner: 2, kerb: true, simTime: 0 },
  { kind: 'strike', corner: 0, kerb: false, simTime: 0 },
  { kind: 'hard-stop', from: 27.5, simTime: 0 },
  { kind: 'wheel-lift', corner: 1 },
  { kind: 'bump-stop', corner: 0 },
  { kind: 'swap', previous: 'macpherson', next: 'multilink' },
  { kind: 'swap', previous: 'macpherson', next: 'double-wishbone' },
];

describe('templates', () => {
  it('no digits in any template; every template is used; placeholders all fill', () => {
    for (const tpl of Object.values(TEMPLATES)) {
      expect(tpl.text, tpl.id).not.toMatch(/\d/);
      expect(tpl.chip ?? '', tpl.id).not.toMatch(/\d/);
    }
    const used = new Set(ALL.map((m) => templateFor(m)!.id));
    expect([...used].sort()).toEqual(Object.keys(TEMPLATES).sort());
    for (const m of ALL) {
      const line = compose(templateFor(m)!, m, frame(), (id) => `<${id}>`);
      expect(line.text + line.chip, line.id).not.toMatch(/[{}]/);
    }
  });

  it('values are live and captured at the moment: speed, wheel, travel, the hard stop start speed', () => {
    const t = frame();
    expect(compose(TEMPLATES.lockup!, ALL[3]!, t).text).toContain('sağ ön tekerlek');
    expect(compose(TEMPLATES['slide-front']!, ALL[0]!, t).chip).toBe('Hız 72 km/h');
    expect(compose(TEMPLATES['strike-kerb']!, ALL[8]!, t).chip).toBe('Hareket SA +36 mm');
    expect(compose(TEMPLATES['hard-stop']!, ALL[10]!, t).chip).toBe('Başlangıç hızı 99 km/h');
    expect(compose(TEMPLATES['wheel-lift']!, ALL[11]!, t).chip).toBe('Yük SĞÖ 2.8 kN');
  });

  it('a slide picks its line by axle and lift; the coach has nothing to say about mode, zone or reset events', () => {
    expect(ALL.slice(0, 3).map((m) => templateFor(m)!.id)).toEqual(['slide-front', 'slide-rear-lift', 'slide-rear']);
    for (const e of [
      { kind: 'mode', mode: 'manual', previous: 'auto', cut: false, simTime: 0 },
      { kind: 'zone', zone: 'ride-street', entered: true, simTime: 0 },
      { kind: 'reset', spawn: null, simTime: 0 },
      { kind: 'converged', simTime: 0 },
    ] as DriveEvent[])
      expect(templateFor(e)).toBeNull();
  });

  it('never ranks suspension types; MacPherson vs double wishbone is described as below notice (09-04 honesty report)', () => {
    const words = /\b(better|worse|best|worst|superior|inferior|faster|slower|more grip|less grip|wins?)\b/i;
    for (const tpl of Object.values(TEMPLATES)) expect(tpl.text, tpl.id).not.toMatch(words);
    expect(belowNotice('macpherson', 'double-wishbone')).toBe(true);
    expect(belowNotice('double-wishbone', 'macpherson')).toBe(true);
    expect(belowNotice('macpherson', 'multilink')).toBe(false);
    const t = frame();
    const label = (id: string) => ({ macpherson: 'MacPherson strut', 'double-wishbone': 'Double wishbone', multilink: 'Multi-link' })[id] ?? id;
    expect(compose(templateFor(ALL[14]!)!, ALL[14]!, t, label).text).toBe(
      'Şimdi Double wishbone kullanılıyor. Bu modelde sürüşü MacPherson strut ile neredeyse aynı: bağlantılar farklı hareket etse de sürüş hissi pek değişmez.',
    );
    expect(compose(templateFor(ALL[13]!)!, ALL[13]!, t, label).text).toMatch(/^Şimdi Multi-link kullanılıyor\. /);
  });

  it('the coach only states detected causes: lift-off rotation only for a rear slide flagged lift', () => {
    const liftWords = /gazı bırak/i;
    for (const m of ALL) {
      const id = templateFor(m)!.id;
      if (liftWords.test(TEMPLATES[id]!.text)) expect(m).toMatchObject({ kind: 'slide', axle: 'rear', lift: true });
    }
  });
});

describe('engine: after the moment, sparse, fading', () => {
  const line = (id: string, priority = 2): Line => ({ id, text: id, chip: '', warn: false, priority });

  it('waits AFTER_S after the moment, then speaks once; a stale moment is dropped', () => {
    const e = new CoachEngine();
    e.offer(line('a'), 10);
    expect(e.tick(10)).toBeNull();
    expect(e.tick(10 + AFTER_S - 0.01)).toBeNull();
    expect(e.tick(10 + AFTER_S)?.id).toBe('a');
    expect(e.tick(10 + AFTER_S + 0.1)).toBeNull();
    const f = new CoachEngine();
    f.offer(line('b'), 0);
    expect(f.tick(STALE_S + 0.01)).toBeNull();
  });

  it('at most one line per GAP_S; a moment during the gap is dropped when stale, not queued', () => {
    const e = new CoachEngine();
    e.offer(line('a'), 0);
    expect(e.tick(1)?.id).toBe('a');
    e.offer(line('b'), 2);
    for (let t = 2; t < 2 + STALE_S + 1; t += 0.1) expect(e.tick(t)).toBeNull();
    e.offer(line('b'), 1 + GAP_S);
    expect(e.tick(1 + GAP_S + AFTER_S)?.id).toBe('b');
  });

  it('a higher-priority moment replaces a waiting one; a lower one does not', () => {
    const e = new CoachEngine();
    e.offer(line('low', 1), 0);
    e.offer(line('high', 5), 0.2);
    e.offer(line('mid', 3), 0.3);
    expect(e.tick(1.2)?.id).toBe('high');
  });

  it('fades with repetition: each kind at most MAX_PER_KIND times, spaced further apart each time', () => {
    const e = new CoachEngine();
    const shown: number[] = [];
    for (let t = 0; t < 600; t += 0.5) {
      e.offer(line('slide'), t);
      if (e.tick(t)) shown.push(t);
    }
    expect(shown).toHaveLength(MAX_PER_KIND);
    expect(e.remaining('slide')).toBe(0);
    for (let i = 1; i < shown.length; i++) expect(shown[i]! - shown[i - 1]!).toBeGreaterThanOrEqual(Math.max(GAP_S, KIND_SPACING_S * i));
    // another kind still speaks
    e.offer(line('lockup'), 700);
    expect(e.tick(701)?.id).toBe('lockup');
    e.forget(); // new vehicle
    expect(e.remaining('slide')).toBe(MAX_PER_KIND);
  });

  it('moments in the takeover transient are ignored', () => {
    const e = new CoachEngine();
    e.clear(1);
    e.offer(line('a'), 0.5);
    expect(e.tick(1.5)).toBeNull();
  });

  it('station cards: immediately, once per CARD_REPEAT_S per station, not right after a station reset', () => {
    const e = new CoachEngine();
    const st = provingGround.stations[0]!;
    expect(e.card(stationLine(st), 0)?.text).toBe(`${st.name}: ${st.experiment}`);
    expect(e.card(stationLine(st), 10)).toBeNull();
    expect(e.card(stationLine(st), CARD_REPEAT_S + 1)).not.toBeNull();
    e.noteReset(200);
    expect(e.card(stationLine(provingGround.stations[1]!), 200 + RESET_QUIET_S / 2)).toBeNull();
    // a card holds the slot like a line
    e.offer(line('a'), 300 - AFTER_S);
    e.card(stationLine(provingGround.stations[2]!), 300 - AFTER_S);
    expect(e.tick(300)).toBeNull();
  });

  it('station copy has no digits; a tyre-grip station says so; the nearest station of a shared zone is chosen', () => {
    for (const st of provingGround.stations) {
      const l = stationLine(st);
      expect(l.text + l.chip).not.toMatch(/\d/);
      expect(l.chip === '').toBe(st.suspension);
    }
    const pad = provingGround.stations.filter((s) => s.zone === 'dynamics-pad');
    expect(pad.length).toBeGreaterThan(1);
    for (const st of pad) expect(stationIn(provingGround.stations, 'dynamics-pad', st.spawn.x, st.spawn.y)?.id).toBe(st.id);
    expect(stationIn(provingGround.stations, 'apron', 0, 0)).toBeUndefined();
  });
});

describe('from a real detection to a line', () => {
  it('a lift-off rotation on the plant yields the lift-off line after the moment, with its speed', () => {
    const r = rig({ aids: { abs: false, traction: false, stability: false, steering: false } });
    r.launch(18, 1 / 40);
    const det = createDriveDetectors(gtCoupe);
    const input = createDetectorInput();
    const ev: DriveEvent[] = [];
    const mo: DriveMoment[] = [];
    const engine = new CoachEngine();
    const lines: { t: number; line: Line }[] = [];
    for (let k = 0; k < Math.round(3 / r.dt); k++) {
      const t = k * r.dt;
      r.cmd.steer = Math.atan(gtCoupe.wheelbase / 40) * 1.6;
      r.cmd.throttle = t < 1.2 ? 0.7 : 0;
      const f = r.step();
      f.drive.mode = 'manual';
      det.step(r.dt, r.plant.view, frameDetectorInput(f, input), ev, mo);
      for (const m of [...ev.splice(0), ...mo.splice(0)]) engine.offer(compose(templateFor(m)!, m, f), t);
      const l = engine.tick(t);
      if (l) lines.push({ t, line: l });
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line.id).toBe('slide-rear-lift');
    expect(lines[0]!.t).toBeGreaterThan(1.2 + AFTER_S);
    expect(lines[0]!.line.chip).toMatch(/^Hız \d+ km\/h$/);
  });
});
