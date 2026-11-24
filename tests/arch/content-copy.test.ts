/**
 * Content copy carries no digits: every number shown comes from the simulation (ARCHITECTURE §14 rule 1).
 * 13-01 extends it to all M2 copy (ARCHITECTURE-M2 §13, MD-60/MD-61): world and station copy, coach templates, the
 * engineer's fact cards, rule answers, labels and chips, HUD strings (drive pill, aids, lamps, replay, ghost lab, phone
 * driver) — no digits; no ranking of suspension types (a sentence with a ranking word must be a negation, or is one of
 * the listed non-ranking uses); assists, approximate states and the vehicle are labelled as models.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATES as COACH } from '../../src/features/coach/rules';
import { AID_COPY, aidsSummary, LAMP_TEXT, LAMP_TITLE } from '../../src/features/drive/hud';
import { CHIPS, DRIVE_CHIPS, EVENT_CHIPS } from '../../src/features/engineer/snapshot';
import { TEMPLATE_STRINGS as GHOST } from '../../src/features/ghost-lab/copy';
import { COPY as REPLAY, FALLBACK, LINK_ERROR, REFUSAL, SAVE_ERROR } from '../../src/features/replay/copy';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { COMMON_CAR, COMMON_MOTORCYCLE, DRIVE_COMMON, DRIVE_COMPARE, SUSPENSION_FACTS } from '../../worker/engineer/facts';
import { driveLabel, type DriveMoment } from '../../worker/engineer/fallback';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';

const strings = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];

describe('content copy has no digits (§14)', () => {
  const copy: [string, string[]][] = [
    ...[macpherson, doubleWishbone, multilink].map((s): [string, string[]] => [s.id, strings(s.copy)]),
    [gtCoupe.id, [gtCoupe.name, gtCoupe.subtitle]],
    [provingLoop.id, [provingLoop.name, ...provingLoop.segments.flatMap((g) => [g.name, g.caption])]],
  ];
  it.each(copy)('%s', (_id, texts) => {
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t) => /\d/.test(t))).toEqual([]);
  });

  it('the vehicle is generic: representative parameters, no manufacturer name', () => {
    expect(gtCoupe.subtitle).toBe('Temsili parametreler');
    expect(`${gtCoupe.name} ${gtCoupe.subtitle}`).not.toMatch(/aston|martin|db11/i);
  });
});

// ---- 13-01: M2 copy ----------------------------------------------------------------------------------------------
// Unicode boundaries keep Turkish dotted/dotless letters inside words; suffixes preserve Turkish ranking claims.
const RANKING = /(?<!\p{L})(best|better|worse|worst|superior|inferior|winner|wins?|beats?|outperforms?|fastest|safest|ideal|cheapest|(?:en|daha) iyi\p{L}*|(?:en|daha) kötü\p{L}*|üstün(?:dür|lük)?|kazanan|kazanır|yener|en hızlı\p{L}*|en güvenli\p{L}*|en ucuz\p{L}*)(?!\p{L})/iu;
const NEGATION = /(?<!\p{L})(no|none|not|never|neither|nor|değil(?:dir)?|yok(?:tur)?|hiçbir(?:i)?|asla)(?!\p{L})/iu;
const matches = (pattern: RegExp, text: string): boolean => pattern.test(text) || pattern.test(text.toLocaleLowerCase('tr-TR'));
/** Ranking words that do not rank suspension types (each with its reason). */
const NOT_A_RANKING: readonly RegExp[] = [
  /near their best slip/, // the tyre's own slip at peak grip (driving card)
  /shows the geometry difference better than the driving does/, // compares two views, not two suspensions
  /^Which suspension is best\?$/, // a visitor's question chip; its answer says none is
  /^Hangi süspansiyon (daha iyi|en iyi)\?$/, // the same visitor question in Turkish
  /One phone drives at a time and the newest one wins/, // phone pairing rule, not a suspension
];
const sentences = (t: string): string[] => t.split(/(?<=[.!?])\s+|\n+/).filter((x) => x.trim());
const rankings = (texts: readonly string[]): string[] =>
  texts.flatMap(sentences).filter((x) => matches(RANKING, x) && !matches(NEGATION, x) && !NOT_A_RANKING.some((r) => r.test(x)));
const digits = (texts: readonly string[]): string[] => texts.filter((t) => /\d/.test(t.replace(/\{\w+\}/g, '')));

/** Sources that hold no visitor copy: the model's instructions and the model/number plumbing. */
const NOT_COPY = new Set(['worker/engineer/prompt.ts', 'worker/engineer/model.ts', 'worker/engineer/numbers.ts']);
/** Sentence-like string literals (and template literals with their ${} parts removed) of user-facing sources. */
function literals(dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const d of dirs)
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.ts') || NOT_COPY.has(`${d}/${f}`)) continue;
      const src = readFileSync(`${d}/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
        const t = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, '');
        if (/^\p{Lu}/u.test(t) && /\p{L}{2,}\s+\p{L}{2,}/u.test(t)) out.push(t);
      }
    }
  return out;
}
const HUD_SOURCES = ['src/features/audio', 'src/features/drive', 'src/features/coach', 'src/features/replay', 'src/features/ghost-lab', 'src/features/phone-drive', 'src/features/tyre-vfx', 'src/features/proving-ground', 'src/features/engineer', 'src/remote', 'worker/engineer'];

const MOMENTS: DriveMoment[] = [
  { kind: 'slide', axle: 'front', lift: false },
  { kind: 'slide', axle: 'rear', lift: false },
  { kind: 'slide', axle: 'rear', lift: true },
  ...(['lockup', 'wheelspin', 'wheel-lift', 'bump-stop'] as const).map((kind) => ({ kind, corner: 1 })),
  ...(['abs', 'traction', 'stability'] as const).map((aid) => ({ kind: 'aid' as const, aid })),
  { kind: 'strike', corner: 2, kerb: true },
  { kind: 'strike', corner: 0, kerb: false },
  { kind: 'hard-stop' },
  { kind: 'swap', previous: 'macpherson', next: 'multilink' },
];

describe('M2 copy (13-01): no digits, no rankings, models labelled', () => {
  const groups: [string, string[]][] = [
    ['world and station copy', [provingGround.name, ...provingGround.zones.map((z) => z.name), ...provingGround.stations.flatMap((st) => [st.name, st.caption, st.experiment])]],
    ['coach templates', Object.values(COACH).flatMap((t) => [t.text, t.chip ?? ''].filter(Boolean))],
    ['engineer fact cards', [COMMON_CAR, COMMON_MOTORCYCLE, DRIVE_COMMON, DRIVE_COMPARE, ...Object.values(SUSPENSION_FACTS)]],
    ['engineer labels and chips', [...MOMENTS.map(driveLabel), ...Object.values(CHIPS).flat(), ...Object.values(EVENT_CHIPS).flat(), ...DRIVE_CHIPS]],
    ['HUD: aids and lamps', [...Object.values(AID_COPY).flatMap((a) => [a.name, a.hint]), ...Object.values(LAMP_TEXT), ...Object.values(LAMP_TITLE)]],
    ['HUD: replay', [...Object.values(REPLAY).map(String), ...Object.values(SAVE_ERROR).map((e) => e.text), ...Object.values(FALLBACK), ...Object.values(LINK_ERROR), ...Object.values(REFUSAL)]],
    ['HUD: ghost lab', [...GHOST]],
    ['inline HUD, coach, engineer and phone strings (source scan)', literals(HUD_SOURCES)],
  ];
  it.each(groups)('%s', (_name, texts) => {
    expect(texts.length).toBeGreaterThan(3);
    expect(digits(texts)).toEqual([]);
    expect(rankings(texts)).toEqual([]);
  });

  it('the matchers catch digits and rankings, and pass negations', () => {
    expect(digits(['Brake from 50 km/h'])).toHaveLength(1);
    expect(digits(['50 km/h hızdan fren yapın'])).toHaveLength(1);
    expect(digits(['Speed {speed}'])).toEqual([]);
    expect(digits(['Hız {speed}'])).toEqual([]);
    expect(rankings(['The multi-link is the best here.'])).toHaveLength(1);
    expect(rankings(['A strut is the cheapest.'])).toHaveLength(1);
    expect(rankings(['None is best overall.', 'No type is best.'])).toEqual([]);
    expect(rankings(['Çok bağlantılı süspansiyon burada en iyidir.'])).toHaveLength(1);
    expect(rankings(['Bu süspansiyon daha iyi.', 'Bu tür en ucuz.', 'ÇİFT SALINCAK EN İYİ SEÇİM.'])).toHaveLength(3);
    expect(rankings(['Her koşulda en iyi olan bir tür yoktur.', 'Hiçbiri en iyi değildir.', 'Hangi süspansiyon daha iyi?'])).toEqual([]);
    expect(literals(['src/features/drive']).length).toBeGreaterThan(20);
    expect(literals(['src/features/drive']).some((text) => text.startsWith('Sürüş modu:'))).toBe(true);
  });

  it('models are labelled: representative vehicle, simplified assists, approximate states, model cues', () => {
    expect(DRIVE_COMMON).toMatch(/representative vehicle model \(not the data of any real car\)/);
    expect(DRIVE_COMMON).toMatch(/not predictions for any real car/);
    expect(COMMON_CAR).toMatch(/representative parameters, not the data of any real car/);
    expect(aidsSummary({ abs: true, traction: true, stability: true, steering: true }).label).toMatch(/Destek: basitleştirilmiş model$/);
    expect(aidsSummary({ abs: false, traction: true, stability: true, steering: true }).label).toMatch(/Destek: basitleştirilmiş model$/);
    for (const id of ['abs', 'traction', 'stability'] as const) expect(LAMP_TITLE[id]).toMatch(/Destek: basitleştirilmiş model/);
    expect(LAMP_TITLE.approximate).toMatch(/sonuçlar yaklaşıktır/);
    for (const k of ['aid-abs', 'aid-traction', 'aid-stability']) expect(COACH[k]!.chip).toBe('Sürüş desteği · basitleştirilmiş model');
    expect(GHOST.join(' ')).toMatch(/Sürücü modeli:/);
    for (const st of provingGround.stations.filter((x) => !x.suspension)) expect(st.caption).toMatch(/Tutunma değerleri yaklaşık/);
    const sources = literals(['src/features/tyre-vfx']).join(' ') + readFileSync('src/features/tyre-vfx/index.ts', 'utf8');
    expect(sources).toMatch(/'model'/); // the grip-rings chip carries the "model" tag
    expect(literals(['src/features/audio']).join(' ')).toMatch(/Lastik sesi bir model göstergesidir/); // MD-45
  });
});

