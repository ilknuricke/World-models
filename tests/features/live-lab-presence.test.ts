import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { isFinalClose, segments, socketUrl, watchingText } from '../../src/features/live-lab/presence';

const labels: Record<string, string> = { macpherson: 'MacPherson', 'double-wishbone': 'Wishbone', multilink: 'Multi-link' };
const labelOf = (id: string) => labels[id] ?? id;

describe('segments', () => {
  it('sorts by count, computes shares and marks my pick', () => {
    const segs = segments({ 'gt-coupe:macpherson': 2, 'gt-coupe:double-wishbone': 5, 'gt-coupe:multilink': 3 }, 'gt-coupe:multilink', labelOf);
    expect(segs.map((s) => [s.label, s.count, s.mine])).toEqual([
      ['Wishbone', 5, false],
      ['Multi-link', 3, true],
      ['MacPherson', 2, false],
    ]);
    expect(segs.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 12);
  });

  it('is stable for ties, skips empty entries, falls back to the id for unknown suspensions', () => {
    const segs = segments({ 'cafe-racer:moto-classic': 1, 'gt-coupe:macpherson': 1, 'gt-coupe:multilink': 0 }, 'x:y', labelOf);
    expect(segs.map((s) => s.label)).toEqual(['MacPherson', 'moto-classic']);
    expect(segments({}, 'a:b', labelOf)).toEqual([]);
  });
});

describe('socketUrl', () => {
  it('builds the contract upgrade URL with ws/wss', () => {
    const base = { code: 'LIVE', id: 'abc', role: 'viewer' as const, vehicleId: 'gt-coupe', suspensionId: 'multilink' };
    const live = new URL(socketUrl({ ...base, origin: 'https://suspension-lab.example' }));
    expect(live.protocol).toBe('wss:');
    expect(live.pathname).toBe('/ws/LIVE');
    expect(Object.fromEntries(live.searchParams)).toEqual({ id: 'abc', role: 'viewer', v: 'gt-coupe', s: 'multilink', pv: String(PROTOCOL_VERSION) });
    const local = new URL(socketUrl({ ...base, origin: 'http://localhost:4173', code: 'AB2CD', role: 'screen' }));
    expect(local.protocol).toBe('ws:');
    expect(local.searchParams.has('k')).toBe(false); // keys never travel in a URL (protocol 2)
  });
});

describe('misc', () => {
  it('formats the head count and classifies final close codes', () => {
    expect(watchingText(1)).toBe('Laboratuvarda 1 kişi');
    expect(watchingText(27)).toBe('Laboratuvarda 27 kişi');
    expect([4400, 4401, 4404, 4503].every(isFinalClose)).toBe(true);
    expect([1000, 1006, 1008, 1009, 1011].some(isFinalClose)).toBe(false);
  });
});
