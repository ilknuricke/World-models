/**
 * 11-04 ghost-lab feature (pure parts): honest copy (no digits in templates, no ranking, every verdict worded,
 * values from the comparison), the span trimming and default target, and the ghost shell preparation (draw budget).
 */
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { DecodedReplay } from '../../src/contracts/drive';
import type { VehicleVisual } from '../../src/contracts/services';
import type { ChannelStat, Comparison } from '../../src/sim-core/ghost/compare';
import { CHANNELS, type Channel } from '../../src/sim-core/ghost/ghost';
import { disclosure, formatValue, sentence, TEMPLATE_STRINGS } from '../../src/features/ghost-lab/copy';
import { CONTROL, defaultTarget, lastBreak } from '../../src/features/ghost-lab/index';
import { DRAW_BUDGET, drawCalls, prepareGhost } from '../../src/features/ghost-lab/visual';

const D = Math.PI / 180;
const stat = (o: Partial<ChannelStat> = {}): ChannelStat => ({
  floor: 0,
  peakDiff: 0,
  threshold: 0.01,
  aPeak: 0,
  bPeak: 0,
  significant: false,
  ...o,
});
function comparison(o: Partial<Comparison> = {}, ch: Partial<Record<Channel, Partial<ChannelStat>>> = {}): Comparison {
  const channels = Object.fromEntries(CHANNELS.map((c) => [c, stat(ch[c])])) as Record<Channel, ChannelStat>;
  return {
    verdict: 'same',
    n: 100,
    aaOffset: 0.026,
    bOffset: 0.044,
    steerEffort: 0,
    channels,
    order: [],
    ...o,
  };
}
const RANKING = /\b(better|worse|best|worst|superior|inferior|wins?|loses?)\b|daha iyi|daha kötü|en iyi|en kötü|üstün|kazanır|kaybeder/iu;

describe('ghost-lab copy', () => {
  it('templates carry no digits and no ranking words', () => {
    for (const t of TEMPLATE_STRINGS) {
      expect(t, t).not.toMatch(/\d/);
      expect(t, t).not.toMatch(RANKING);
    }
  });

  it('words every verdict with values from the comparison', () => {
    const refused = sentence(comparison({ verdict: 'refused', aaOffset: 0.31 }), 'MacPherson strut', 'Multi-link', false);
    expect(refused).toContain('sonuç çıkarılamaz');
    expect(refused).toContain('31 cm');
    expect(sentence(comparison({ verdict: 'lost', bOffset: 1.24 }), 'A', 'Multi-link', false)).toContain('çizginizi koruyamadı (1.2 m');
    expect(sentence(comparison({ verdict: 'same' }), 'MacPherson strut', 'Double wishbone', false)).toBe(
      'Bu bölümde Double wishbone, MacPherson strut gibi davrandı: tüm farklar otomatik sürücünün kendi tekrarlama hata payı içinde kaldı.',
    );
    const diff = sentence(
      comparison(
        {
          verdict: 'different',
          steerEffort: 0.058,
          order: ['sideslip', 'roll', 'steer'],
        },
        {
          steer: { significant: true, threshold: 0.25 * D, peakDiff: 0.31 * D },
          sideslip: {
            significant: true,
            threshold: 0.15 * D,
            peakDiff: 0.24 * D,
            aPeak: 2.17 * D,
            bPeak: 2.17 * D,
          },
          roll: {
            significant: true,
            threshold: 0.1 * D,
            peakDiff: 0.13 * D,
            aPeak: 1.22 * D,
            bPeak: 1.31 * D,
          },
        },
      ),
      'MacPherson strut',
      'Multi-link',
      false,
    );
    // steering effort first, then the strongest other difference; peaks equal -> "differed by up to"
    expect(diff).toBe('Multi-link ile otomatik sürücü çizginizi izlemek için 6 % daha fazla direksiyon açısına ihtiyaç duydu ve yanal kayma bölüm boyunca 0.2° kadar farklılık gösterdi.');
    const roll = sentence(
      comparison(
        { verdict: 'different', order: ['roll'] },
        {
          roll: {
            significant: true,
            threshold: 0.1 * D,
            peakDiff: 0.3 * D,
            aPeak: 1.2 * D,
            bPeak: 1.5 * D,
          },
        },
      ),
      'A',
      'B',
      false,
    );
    expect(roll).toBe('B ile gövde yalpası için tepe değer daha yüksek oldu (1.2° yerine 1.5°).');
    const strayed = sentence(
      comparison({ verdict: 'different', order: ['offset'] }, { offset: { significant: true, threshold: 0.1, peakDiff: 0.15, aPeak: 0.01, bPeak: 0.15 } }),
      'A',
      'MacPherson strut',
      false,
    );
    expect(strayed).toBe('MacPherson strut ile otomatik sürücü çizginizden 15 cm kadar saptı.');
    expect(sentence(comparison(), 'MacPherson strut', 'MacPherson strut', true)).toBe(
      'Kontrol denemesi: otomatik sürücü MacPherson strut ile sürüşünüzü, çizginizden en fazla 3 cm saparak tekrarlar.',
    );
    expect(disclosure(0.026)).toContain('aynı otomatik sürücü');
    expect(disclosure(0.026)).toContain('3 cm hata payıyla');
    for (const s of [refused, diff, roll]) expect(s).not.toMatch(RANKING);
  });

  it('formats angles in degrees and offsets in cm / m', () => {
    expect(formatValue('roll', 1.234 * D)).toBe('1.2°');
    expect(formatValue('steer', -12.6 * D)).toBe('13°');
    expect(formatValue('offset', 0.004)).toBe('1 cm');
    expect(formatValue('offset', 0.26)).toBe('26 cm');
    expect(formatValue('offset', 1.26)).toBe('1.3 m');
  });
});

describe('ghost-lab span and target', () => {
  const span = (events: DecodedReplay['events']) => ({ events }) as DecodedReplay;
  it('finds the last reset or suspension swap inside a span (aids changes and tick 0 do not count)', () => {
    expect(lastBreak(span([{ tick: 0, kind: 'aids', value: 'abs' }]))).toBe(0);
    expect(
      lastBreak(
        span([
          { tick: 0, kind: 'aids', value: '' },
          { tick: 500, kind: 'reset', value: '' },
          { tick: 900, kind: 'aids', value: '' },
          { tick: 1200, kind: 'suspension', value: 'multilink' },
        ]),
      ),
    ).toBe(1200);
  });
  it('offers the next suspension in the vehicle list, the control run when there is no other', () => {
    expect(defaultTarget(['macpherson', 'double-wishbone', 'multilink'], 'double-wishbone')).toBe('multilink');
    expect(defaultTarget(['macpherson', 'double-wishbone', 'multilink'], 'multilink')).toBe('macpherson');
    expect(defaultTarget(['only'], 'only')).toBe(CONTROL);
  });
});

describe('ghost-lab visual', () => {
  /** A vehicle visual shaped like db11's: body meshes + a hidden x-ray shell in the body group, wheels per hub. */
  function fakeVisual(): { visual: VehicleVisual; shell: Mesh } {
    const root = new Group();
    const body = new Group();
    root.add(body);
    const g = new BoxGeometry();
    for (let i = 0; i < 6; i++) body.add(new Mesh(g, new MeshStandardMaterial()));
    const shellMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(0x7fd8ff) }, uXray: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    const shell = new Mesh(g, shellMat);
    shell.visible = false;
    body.add(shell);
    for (let i = 0; i < 4; i++) {
      const hub = new Group();
      root.add(hub);
      hub.add(new Mesh(g, new MeshStandardMaterial()));
      const disc = new Mesh(g, new MeshStandardMaterial());
      disc.userData.replacedBySuspension = true;
      hub.add(disc);
    }
    const visual: VehicleVisual = {
      root,
      update: () => {},
      setXray(a) {
        shellMat.uniforms.uXray!.value = a;
        shell.visible = a > 0.001;
      },
      dispose: () => {},
    };
    return { visual, shell };
  }

  it('shows the x-ray shell and the wheels in its material, hides the body and brake parts, tints it, within the budget', () => {
    const { visual, shell } = fakeVisual();
    expect(prepareGhost(visual, '#ffb454')).toBe(true);
    expect(shell.visible).toBe(true);
    expect(((shell.material as ShaderMaterial).uniforms.uColor!.value as Color).getHexString()).toBe('ffb454');
    expect(drawCalls(visual.root)).toBe(5); // shell + 4 wheels
    expect(drawCalls(visual.root)).toBeLessThanOrEqual(DRAW_BUDGET);
    visual.root.traverse((o) => {
      if ((o as Mesh).isMesh && o.visible && o !== shell) expect((o as Mesh).material).toBe(shell.material);
      if ((o as Mesh).isMesh) expect((o as Mesh).castShadow).toBe(false);
    });
  });

  it('falls back (traces only) when the visual has no shell', () => {
    const { visual } = fakeVisual();
    visual.setXray = () => {};
    expect(prepareGhost(visual, '#ffb454')).toBe(false);
    expect(visual.root.visible).toBe(false);
  });
});
