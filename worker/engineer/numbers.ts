/**
 * Number grounding (ARCHITECTURE §12.5 step 6, extended in 12-03): every number in the answer must come from the
 * telemetry payload, equal after rounding to 0, 1 or 2 decimals or within 5 %. An explicit sign must match; an unsigned
 * number may match the magnitude ("rolls 1.26 degrees" for roll_deg -1.26).
 * Unit-aware: a number written with a unit (km/h, g, degrees, degrees per second, mm, N, percent, seconds) must match a
 * payload value of THAT unit (read from the key suffix: _kmh, _g, _deg, _dps, _mm, _n, _pct, _s), so a speed cannot be
 * "grounded" by a tyre load that happens to be close. Numbers without a unit may match any payload value.
 */

// Thousands separators ("6,100") or plain decimals; an optional leading sign (ASCII or U+2212 minus).
const NUMBER = /([-+−]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;

export type Unit = 'kmh' | 'dps' | 'deg' | 'g' | 'mm' | 'n' | 'pct' | 's';

/** Unit written right after a number (order matters: "degrees per second" before "degrees"). */
const TEXT_UNITS: readonly (readonly [Unit, RegExp])[] = [
  ['kmh', /^[\s-]*(km\/h|km\/sa|kph|kilomet(re|er)s? (per|an) hour)/i],
  ['dps', /^[\s-]*(°\/s|deg\/s|degrees? (per|a) second|derece\/s|derece\/saniye)/i],
  ['deg', /^[\s-]*(°|deg\b|degrees?\b|derece\b)/i],
  ['g', /^[\s-]*g\b/],
  ['mm', /^[\s-]*(mm\b|millimet(re|er)s?\b|milimetre\b)/i],
  ['n', /^[\s-]*(N\b|newtons?\b|newton\b)/],
  ['pct', /^[\s-]*(%|percent\b|per cent\b|yüzde\b)/i],
  ['s', /^[\s-]*(s\b|seconds?\b|saniye\b)/],
];

/** Unit of a payload key, from its suffix. */
const KEY_UNITS: readonly (readonly [Unit, RegExp])[] = [
  ['kmh', /_kmh$/],
  ['dps', /_dps$/],
  ['deg', /_deg($|_)/],
  ['g', /_g$/],
  ['mm', /_mm$/],
  ['n', /_n$/],
  ['pct', /_pct$/],
  ['s', /_s$/],
];

export interface QuotedNumber {
  readonly value: number;
  readonly signed: boolean;
  readonly decimals: number;
  readonly unit?: Unit;
}

export function numbersInText(text: string): QuotedNumber[] {
  const out: QuotedNumber[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const [whole, sign = '', digits = ''] = m;
    const clean = digits.replace(/,/g, '');
    const v = Number(clean);
    const rest = text.slice((m.index ?? 0) + whole.length);
    const unit = TEXT_UNITS.find(([, re]) => re.test(rest))?.[0];
    out.push({ value: sign === '' || sign === '+' ? v : -v, signed: sign !== '', decimals: (clean.split('.')[1] ?? '').length, ...(unit ? { unit } : {}) });
  }
  return out;
}

/** Payload values by unit ('any' = every value; key digits such as "..._per_10mm" are allowed for every unit). */
export type PayloadNumbers = { readonly any: number[]; readonly keys: number[] } & { [U in Unit]: number[] };

const emptyPayload = (): PayloadNumbers => ({ any: [], keys: [], kmh: [], dps: [], deg: [], g: [], mm: [], n: [], pct: [], s: [] });

export function payloadNumbersByUnit(payload: unknown, out: PayloadNumbers = emptyPayload(), unit?: Unit): PayloadNumbers {
  if (typeof payload === 'number' && Number.isFinite(payload)) {
    out.any.push(payload);
    if (unit) out[unit].push(payload);
  } else if (Array.isArray(payload)) for (const v of payload) payloadNumbersByUnit(v, out, unit);
  else if (typeof payload === 'object' && payload !== null) {
    for (const [k, v] of Object.entries(payload)) {
      for (const q of numbersInText(k)) out.keys.push(q.value);
      payloadNumbersByUnit(v, out, KEY_UNITS.find(([, re]) => re.test(k))?.[0] ?? unit);
    }
  }
  return out;
}

/** Every number in the payload, plus digits in its keys (e.g. a derived key "..._per_10mm"). */
export function payloadNumbers(payload: unknown): number[] {
  const p = payloadNumbersByUnit(payload);
  return [...p.any, ...p.keys];
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function matches(q: QuotedNumber, v: number): boolean {
  const target = q.signed ? v : Math.abs(v);
  const x = q.signed ? q.value : Math.abs(q.value);
  if (x === target) return true;
  if (q.decimals <= 2 && round(target, q.decimals) === x) return true;
  return target !== 0 && Math.abs(x - target) <= 0.05 * Math.abs(target);
}

/** Numbers quoted in `text` that no payload value (of the same unit, when one is written) supports (empty = grounded). */
export function ungroundedNumbers(text: string, payload: unknown): number[] {
  const p = payloadNumbersByUnit(payload);
  return numbersInText(text)
    .filter((q) => ![...(q.unit ? p[q.unit] : p.any), ...p.keys].some((v) => matches(q, v)))
    .map((q) => q.value);
}
