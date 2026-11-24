/**
 * Ghost-lab copy (ARCHITECTURE-M2 §13.3, §13.7): templates carry no digits; every number comes from the simulation and
 * is formatted here. The sentence never ranks suspension types: it says what differed (or that nothing did beyond the
 * autopilot's own repeat error), or that no conclusion can be drawn.
 */
import type { Comparison } from '../../sim-core/ghost/compare';
import type { Channel } from '../../sim-core/ghost/ghost';

export const COPY = {
  chip: 'Karşılaştır',
  chipTitle: 'Aynı çizgi, farklı süspansiyon: otomatik sürücü son bölümünüzü başka bir süspansiyonla yeniden sürer (G)',
  computing: 'Karşılaştırılıyor…',
  title: 'Aynı çizgi, farklı süspansiyon',
  you: 'siz',
  yours: 'sizin',
  ghost: 'hayalet',
  control: 'Aynısı (kontrol)',
  controlTitle: 'Kontrol denemesi: otomatik sürücü kendi süspansiyonunuzla sürüşünüzü ne kadar yakından tekrarlayabildiğini gösterir',
  against: 'Hayalet aracın süspansiyonu',
  again: 'Yeniden izle',
  close: 'Karşılaştırmayı kapat',
  playing: 'Hayalet pistte',
  /** Always visible while a ghost or its traces are shown (§13.3). */
  disclosure:
    'Sürücü modeli: iki denemede de aynı otomatik sürücü çizginizi ve hızınızı izler. Direksiyon ve pedal girdilerinize, çizgide kalmak için küçük düzeltmeler eklenir. Model, sürüşünüzü {floor} hata payıyla tekrarlar; daha küçük farklar yok sayılır.',
  short: 'Aynı çizgide birkaç saniye ileri sürün, ardından karşılaştırın.',
  unfit: 'Bu sürüş burada karşılaştırılamıyor.',
  axis: 'sürüş çizginiz boyunca',
} as const;

/** Row labels of the strip chart (and the sentence's nouns). */
export const ROWS: readonly {
  readonly channel: Channel;
  readonly label: string;
  readonly noun: string;
}[] = [
  { channel: 'steer', label: 'Direksiyon', noun: 'direksiyon açısı' },
  { channel: 'frontSlip', label: 'Ön kayma', noun: 'ön kayma açısı' },
  { channel: 'rearSlip', label: 'Arka kayma', noun: 'arka kayma açısı' },
  { channel: 'sideslip', label: 'Yanal kayma', noun: 'yanal kayma' },
  { channel: 'roll', label: 'Yalpa', noun: 'gövde yalpası' },
  { channel: 'offset', label: 'Çizgiden sapma', noun: 'sürüş çizginizden uzaklık' },
];

const TEMPLATES = {
  refused: 'Otomatik sürücü burada sürüşünüzü yeterince yakından tekrarlayamadı ({A} ile çizginizden {a} kadar saptı); bu nedenle bu karşılaştırmadan sonuç çıkarılamaz.',
  lost: 'Otomatik sürücü {B} ile çizginizi koruyamadı ({b} kadar saptı). İki otomobil farklı yollar izlediğinden grafikler doğrudan karşılaştırılamaz.',
  same: 'Bu bölümde {B}, {A} gibi davrandı: tüm farklar otomatik sürücünün kendi tekrarlama hata payı içinde kaldı.',
  different: '{B} ile {clauses}.',
  control: 'Kontrol denemesi: otomatik sürücü {A} ile sürüşünüzü, çizginizden en fazla {a} saparak tekrarlar.',
  steer: 'otomatik sürücü çizginizi izlemek için {pct} {dir} direksiyon açısına ihtiyaç duydu',
  peak: '{noun} için tepe değer {dir} oldu ({a} yerine {b})',
  apart: '{noun} bölüm boyunca {d} kadar farklılık gösterdi',
  offset: 'otomatik sürücü çizginizden {b} kadar saptı',
  join: '{first} ve {second}',
} as const;

const fill = (t: string, v: Readonly<Record<string, string>>): string => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

const DEG = 180 / Math.PI;
/** Angles (rad) as degrees with one decimal below 10 deg; offsets (m) in cm (whole) or m above a metre. */
export function formatValue(channel: Channel, value: number): string {
  if (channel === 'offset') {
    const m = Math.abs(value);
    return m < 1 ? `${Math.max(1, Math.round(m * 100))} cm` : `${m.toFixed(1)} m`;
  }
  const d = Math.abs(value) * DEG;
  return `${d < 10 ? d.toFixed(1) : d.toFixed(0)}°`;
}
export const formatOffset = (m: number): string => formatValue('offset', m);
export const formatDelta = (channel: Channel, value: number): string => formatValue(channel, value);

/** One clause per significant channel. */
function clause(cmp: Comparison, channel: Channel): string {
  const st = cmp.channels[channel];
  const noun = ROWS.find((r) => r.channel === channel)!.noun;
  if (channel === 'steer' && Number.isFinite(cmp.steerEffort) && Math.abs(cmp.steerEffort) >= 0.02) {
    const pct = Math.round(Math.abs(cmp.steerEffort) * 100);
    return fill(TEMPLATES.steer, {
      pct: `${pct} %`,
      dir: cmp.steerEffort > 0 ? 'daha fazla' : 'daha az',
    });
  }
  if (channel === 'offset') return fill(TEMPLATES.offset, { b: formatValue(channel, st.bPeak) });
  if (Math.abs(st.bPeak - st.aPeak) > st.threshold)
    return fill(TEMPLATES.peak, {
      noun,
      dir: st.bPeak > st.aPeak ? 'daha yüksek' : 'daha düşük',
      b: formatValue(channel, st.bPeak),
      a: formatValue(channel, st.aPeak),
    });
  return fill(TEMPLATES.apart, { noun, d: formatValue(channel, st.peakDiff) });
}

const capital = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);

/**
 * The one honest sentence. `a` / `b` are suspension labels; `control` = the B run used the visitor's own suspension.
 * Steering first (the autopilot's effort is the headline), then the strongest other difference; at most two.
 */
export function sentence(cmp: Comparison, a: string, b: string, control: boolean): string {
  if (cmp.verdict === 'refused') return fill(TEMPLATES.refused, { a: formatOffset(cmp.aaOffset), A: a });
  if (control) return fill(TEMPLATES.control, { A: a, a: formatOffset(cmp.aaOffset) });
  if (cmp.verdict === 'lost') return fill(TEMPLATES.lost, { B: b, b: formatOffset(cmp.bOffset) });
  if (cmp.verdict === 'same') return fill(TEMPLATES.same, { A: a, B: b });
  const order = cmp.order.includes('steer') ? ['steer' as Channel, ...cmp.order.filter((c) => c !== 'steer')] : cmp.order;
  const parts = order.slice(0, 2).map((c) => clause(cmp, c));
  const clauses = parts.length === 2 ? fill(TEMPLATES.join, { first: parts[0]!, second: parts[1]! }) : parts[0]!;
  return capital(fill(TEMPLATES.different, { B: b, clauses }));
}

export const disclosure = (aaOffset: number): string => fill(COPY.disclosure, { floor: formatOffset(aaOffset) });

/** Every template string (tests: no digits in copy). */
export const TEMPLATE_STRINGS: readonly string[] = [...Object.values(COPY), ...Object.values(TEMPLATES), ...ROWS.flatMap((r) => [r.label, r.noun])];
