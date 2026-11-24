import { describe, expect, it } from 'vitest';
import { PUBLIC_ROOM, type PresenterState } from '../../src/contracts/net';
import { pollBars } from '../../src/features/poll/bars';
import { ctlStep, cueAction, remoteLinks } from '../../src/features/presenter/apply';
import { qrPath } from '../../src/features/presenter/qr';
import { SECTIONS, VEHICLES, suspensionForOption, suspensionPoll } from '../../src/remote/catalogue';
import { hostKeyFromHash, normaliseCode, readRemoteTarget, statusForClose } from '../../src/remote/connection';
import { shares } from '../../src/remote/widgets';
import { provingLoop } from '../../src/sim-core/content/proving-loop';

const offered = (id: string) =>
  ({ 'gt-coupe': ['macpherson', 'double-wishbone', 'multilink'], 'cafe-racer': ['moto-classic', 'moto-modern'] })[id];

describe('presenter ctl application', () => {
  it('applies every set field on the first state, but never seeks on a (re)load', () => {
    const step = ctlStep(null, { seq: 4, suspensionId: 'multilink', view: 'closeup', xray: true, section: 'hairpin' }, 'gt-coupe', offered);
    expect(step).toEqual({
      patch: [
        ['suspensionId', 'multilink'],
        ['view', 'closeup'],
        ['xray', true],
      ],
      section: null,
    });
  });

  it('ignores stale and duplicate seq, applies only what changed', () => {
    const prev: PresenterState = { seq: 5, view: 'follow', xray: false, timeScale: 1 };
    expect(ctlStep(prev, { ...prev, seq: 5, xray: true }, 'gt-coupe', offered)).toBeNull();
    expect(ctlStep(prev, { ...prev, seq: 4, xray: true }, 'gt-coupe', offered)).toBeNull();
    expect(ctlStep(prev, { ...prev, seq: 6, timeScale: 0.25 }, 'gt-coupe', offered)).toEqual({ patch: [['timeScale', 0.25]], section: null });
  });

  it('seeks when the section changes', () => {
    const prev: PresenterState = { seq: 1, section: 'launch' };
    expect(ctlStep(prev, { seq: 2, section: 'hairpin' }, 'gt-coupe', offered)?.section).toBe('hairpin');
    expect(ctlStep(prev, { seq: 2, section: 'launch', xray: true }, 'gt-coupe', offered)?.section).toBeNull();
  });

  it('writes the vehicle before its suspension and re-asserts the suspension after a vehicle swap', () => {
    const prev: PresenterState = { seq: 1, vehicleId: 'gt-coupe', suspensionId: 'moto-modern' };
    const step = ctlStep(prev, { seq: 2, suspensionId: 'moto-modern', vehicleId: 'cafe-racer' }, 'gt-coupe', offered);
    expect(step?.patch).toEqual([
      ['vehicleId', 'cafe-racer'],
      ['suspensionId', 'moto-modern'],
    ]);
  });

  it('drops a suspension the running vehicle does not offer and an unknown vehicle', () => {
    expect(ctlStep({ seq: 1 }, { seq: 2, suspensionId: 'moto-classic' }, 'gt-coupe', offered)?.patch).toEqual([]);
    expect(ctlStep({ seq: 1 }, { seq: 2, vehicleId: 'hovercraft', suspensionId: 'multilink' }, 'gt-coupe', offered)?.patch).toEqual([['suspensionId', 'multilink']]);
  });

  it('maps cues to camera focus or a section replay', () => {
    expect(cueAction('focus-front-left', 'car')).toEqual({ kind: 'focus', corner: 'fl' });
    expect(cueAction('focus-front-left', 'motorcycle')).toEqual({ kind: 'focus', corner: 'f' });
    expect(cueAction('focus-car', 'car')).toEqual({ kind: 'focus', corner: null });
    expect(cueAction('replay-section', 'car')).toEqual({ kind: 'replay' });
  });
});

describe('room links and QR', () => {
  it('keeps the host key in the fragment only', () => {
    const links = remoteLinks('https://lab.example', 'K7QXM', 'abcdefghijklmnop_-12');
    expect(links.audience).toBe('https://lab.example/r/K7QXM');
    expect(links.host).toBe('https://lab.example/remote.html?room=K7QXM#k=abcdefghijklmnop_-12');
    expect(new URL(links.host!).search).not.toContain('abcdefghijklmnop');
    expect(remoteLinks('https://lab.example', 'K7QXM', null).host).toBeNull();
  });

  it('encodes a QR path with a quiet zone', () => {
    const { d, size } = qrPath('https://lab.example/r/K7QXM');
    expect(size).toBeGreaterThanOrEqual(25);
    expect(d.startsWith('M2 2h7')).toBe(true); // finder pattern top-left, after the 2-module border
  });

  it('parses the remote URL and moves the key out of the fragment', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
    const key = 'A'.repeat(32);
    expect(readRemoteTarget({ search: '?room=k7qxm', hash: `#k=${key}`, pathname: '/remote' }, storage)).toEqual({ code: 'K7QXM', hostKey: key });
    expect(readRemoteTarget({ search: '?room=K7QXM', hash: '', pathname: '/remote' }, storage)).toEqual({ code: 'K7QXM', hostKey: key });
    expect(readRemoteTarget({ search: '?room=OTHER', hash: '', pathname: '/remote' }, storage)).toEqual({ code: null, hostKey: null });
    expect(readRemoteTarget({ search: '?room=ABCDE', hash: '', pathname: '/remote' }, storage).hostKey).toBeNull();
    expect(normaliseCode(PUBLIC_ROOM)).toBeNull();
    expect(normaliseCode('ab0de')).toBeNull(); // 0 is not in the alphabet
    expect(hostKeyFromHash('#k=short')).toBeNull();
    expect(statusForClose(4401)).toBe('denied');
    expect(statusForClose(4404)).toBe('gone');
    expect(statusForClose(1006)).toBeNull();
  });
});

describe('poll maths and catalogue', () => {
  it('percentages add up to 100 with a single leader; ties have none', () => {
    expect(pollBars([1, 1, 1])).toEqual({ total: 3, percent: [34, 33, 33], leader: null });
    expect(pollBars([0, 0])).toEqual({ total: 0, percent: [0, 0], leader: null });
    expect(pollBars([2, 5, 1]).leader).toBe(1);
    for (const counts of [[1, 1, 1], [7, 2, 0, 3], [0, 0], [5]]) expect(shares(counts)).toEqual(pollBars(counts));
  });

  it('the ready-made poll maps its options back to suspensions', () => {
    const poll = suspensionPoll('gt-coupe');
    expect(poll.options).toEqual(['Dikme', 'Çift salıncak', 'Çok bağlantılı']);
    expect(poll.options.map((o) => suspensionForOption('gt-coupe', o))).toEqual(['macpherson', 'double-wishbone', 'multilink']);
    expect(suspensionForOption('gt-coupe', 'Pizza')).toBeNull();
    for (const v of VEHICLES) expect(v.suspensions.every((s) => s.label.length <= 40)).toBe(true);
  });

  it('offers every track section of the proving loop', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(provingLoop.segments.map((s) => s.id));
  });
});
