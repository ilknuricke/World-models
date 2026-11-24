/**
 * Coach rules (pure; research m2/13: sparse, terminal feedback that fades with competence). One plain line explains a
 * moment the sim-core detectors found (drive/events.ts) or the M1 simulation events reported, shown shortly AFTER it,
 * never more than one line per GAP_S, at most MAX_PER_KIND times per kind with growing spacing.
 * Honesty (ARCHITECTURE-M2 §13): templates contain NO digits; `{placeholders}` are filled from TRUE values captured at
 * the moment through src/ui/format.ts; a line only names what a detector detected; suspension types are never ranked,
 * and a swap between types the 09-04 honesty report measured as below notice says so instead of promising a difference.
 */
import type { DriveEvent } from '../../contracts/drive';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { StationDefinition } from '../../contracts/world';
import { deg, fmt, kmh, kN, mm } from '../../ui/format';

/** Everything the coach can explain. 'wheel-lift' and 'bump-stop' are the M1 SimEvents seen while driving. */
export type CoachMoment =
  | DriveEvent
  | { readonly kind: 'wheel-lift' | 'bump-stop'; readonly corner: number }
  | { readonly kind: 'swap'; readonly previous: string; readonly next: string };

export interface Template {
  readonly id: string;
  readonly text: string;
  readonly chip?: string;
  /** Amber chip: the moment was past a limit. */
  readonly warn?: boolean;
  /** A later moment replaces a waiting one only with a priority at least as high. */
  readonly priority: number;
}

const SPEED = 'Hız {speed}';
export const TEMPLATES: Readonly<Record<string, Template>> = {
  'slide-rear-lift': {
    id: 'slide-rear-lift',
    text: 'Virajda gazı bırakınca yük ön lastiklere geçti; hafifleyen arka taraf tutuşunu kaybetti ve araç döndü.',
    chip: SPEED,
    warn: true,
    priority: 5,
  },
  'slide-rear': { id: 'slide-rear', text: 'Arka lastikler tutuş sınırını aştı ve arka taraf kaydı. Gazı azaltın ve direksiyonu gitmek istediğiniz yöne çevirin.', chip: SPEED, warn: true, priority: 4 },
  'slide-front': { id: 'slide-front', text: 'Ön lastikler tutuş sınırını aştığı için araç dönmek yerine virajın dışına açıldı. Hızı ve direksiyon açısını azaltmak tutuşu geri kazandırır.', chip: SPEED, warn: true, priority: 4 },
  lockup: { id: 'lockup', text: '{wheel} tekerlek frenlemede kilitlendi; kayan lastik yönlendirme yapamaz. Yeniden dönene kadar freni azaltın.', chip: SPEED, warn: true, priority: 4 },
  wheelspin: { id: 'wheelspin', text: '{wheel} tekerlek patinaja düştü: çekiş kuvveti tutuşunu aştı. Gaza kademeli basın.', chip: SPEED, warn: true, priority: 3 },
  'hard-stop': { id: 'hard-stop', text: 'Sert frenlemede yük ön lastiklere geçti ve burun öne daldı.', chip: 'Başlangıç hızı {from}', priority: 3 },
  'strike-kerb': { id: 'strike-kerb', text: '{wheel} tekerlek bordüre çarptı: yay darbeyi karşıladı, amortisör salınımı söndürdü.', chip: 'Hareket {corner} {travel}', priority: 3 },
  'strike-bump': { id: 'strike-bump', text: '{wheel} tekerlek tümseğe çıktı: tek köşe hareket ederken gövde daha sakin kalır.', chip: 'Hareket {corner} {travel}', priority: 2 },
  'wheel-lift': { id: 'wheel-lift', text: '{wheel} tekerleğin yükü azaldı: yük neredeyse sıfırken tutuş da neredeyse sıfırdır.', chip: 'Yük {corner} {load}', warn: true, priority: 2 },
  'bump-stop': { id: 'bump-stop', text: '{wheel} tekerlek hareket mesafesini tüketti ve darbe takozuna dayandı.', chip: 'Hareket {corner} {travel}', warn: true, priority: 2 },
  'aid-abs': { id: 'aid-abs', text: 'ABS desteği fren kuvvetini azalttı; böylece tekerlekler dönmeye devam etti ve araç yönlendirilebildi.', chip: 'Sürüş desteği · basitleştirilmiş model', priority: 2 },
  'aid-traction': { id: 'aid-traction', text: 'Çekiş desteği, tahrik tekerlekleri patinaja başlayınca motor gücünü azalttı.', chip: 'Sürüş desteği · basitleştirilmiş model', priority: 2 },
  'aid-stability': { id: 'aid-stability', text: 'Denge desteği, aracı direksiyonla gösterdiğiniz yönde tutmak için tek tekerleğe fren uyguladı.', chip: 'Sürüş desteği · basitleştirilmiş model', priority: 2 },
  swap: { id: 'swap', text: 'Şimdi {suspension} kullanılıyor. Aynı virajı aynı şekilde dönün: gereken direksiyon açısını ve arka tarafın nasıl oturduğunu gözlemleyin.', priority: 1 },
  'swap-same': { id: 'swap-same', text: 'Şimdi {suspension} kullanılıyor. Bu modelde sürüşü {previous} ile neredeyse aynı: bağlantılar farklı hareket etse de sürüş hissi pek değişmez.', priority: 1 },
};

/**
 * Suspension pairs whose handling differences the 09-04 honesty report measured as below notice (MacPherson vs double
 * wishbone: every row within 0.07 deg/g, 0.05 deg yaw, 0.1 m braking). Other pairs differ noticeably in steering
 * needed and rear calmness — without a winner.
 */
const BELOW_NOTICE: readonly (readonly [string, string])[] = [['macpherson', 'double-wishbone']];
export const belowNotice = (a: string, b: string): boolean => BELOW_NOTICE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Template for a moment, or null when the coach has nothing to say about it. */
export function templateFor(m: CoachMoment): Template | null {
  switch (m.kind) {
    case 'slide':
      return TEMPLATES[m.axle === 'front' ? 'slide-front' : m.lift ? 'slide-rear-lift' : 'slide-rear']!;
    case 'lockup':
    case 'wheelspin':
    case 'hard-stop':
    case 'wheel-lift':
    case 'bump-stop':
      return TEMPLATES[m.kind]!;
    case 'strike':
      return TEMPLATES[m.kerb ? 'strike-kerb' : 'strike-bump']!;
    case 'aid':
      return TEMPLATES[`aid-${m.aid}`]!;
    case 'swap':
      return TEMPLATES[belowNotice(m.previous, m.next) ? 'swap-same' : 'swap']!;
    default:
      return null;
  }
}

const CORNER_NAME: readonly string[] = ['sol ön', 'sağ ön', 'sol arka', 'sağ arka'];
const CORNER_SHORT: readonly string[] = ['SÖ', 'SĞÖ', 'SA', 'SĞA'];
const signed = (v: number, d: number, unit: string) => (v > 0 && fmt(v, d) !== fmt(0, d) ? '+' : '') + fmt(v, d) + unit;
const speedText = (mps: number) => fmt(kmh(Math.abs(mps)), 0) + ' km/h';

export interface Line {
  readonly id: string;
  readonly text: string;
  readonly chip: string;
  readonly warn: boolean;
  readonly priority: number;
}

/** Fills a template from the frame at the moment (TRUE values). `label` maps a suspension id to its display name. */
export function compose(tpl: Template, m: CoachMoment, t: TelemetryFrame, label: (id: string) => string = (id) => id): Line {
  const corner = 'corner' in m ? m.corner : 0;
  const c = t.corners[corner] ?? t.corners[0];
  const values: Readonly<Record<string, () => string>> = {
    wheel: () => CORNER_NAME[corner] ?? 'front',
    corner: () => CORNER_SHORT[corner] ?? '',
    speed: () => speedText(Math.sqrt(t.drive.u * t.drive.u + t.drive.v * t.drive.v)),
    from: () => speedText(m.kind === 'hard-stop' ? m.from : t.drive.u),
    travel: () => signed(mm(c?.travel ?? 0), 0, ' mm'),
    load: () => fmt(kN(c?.load ?? 0), 1) + ' kN',
    pitch: () => fmt(Math.abs(deg(t.pitch)), 1) + '°',
    suspension: () => label(m.kind === 'swap' ? m.next : t.suspensionId),
    previous: () => label(m.kind === 'swap' ? m.previous : ''),
  };
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (k, key: string) => values[key]?.() ?? k);
  return { id: tpl.id, text: fill(tpl.text), chip: tpl.chip ? fill(tpl.chip) : '', warn: tpl.warn ?? false, priority: tpl.priority };
}

/** Station card shown on entering a zone with stations: what to try there (copy from the world, no digits). */
export function stationLine(st: StationDefinition): Line {
  return { id: `station:${st.id}`, text: `${st.name}: ${st.experiment}`, chip: st.suspension ? '' : 'Lastik tutuşu; süspansiyon etkisi değil', warn: false, priority: 6 };
}

/** The station of `zone` whose spawn is nearest to (x, y), or undefined. */
export function stationIn(stations: readonly StationDefinition[], zone: string, x: number, y: number): StationDefinition | undefined {
  let best: StationDefinition | undefined;
  let d = Infinity;
  for (const st of stations) {
    if (st.zone !== zone) continue;
    const dd = (st.spawn.x - x) ** 2 + (st.spawn.y - y) ** 2;
    if (dd < d) {
      d = dd;
      best = st;
    }
  }
  return best;
}

/** Simulation seconds: a line waits this long after its moment (terminal feedback, after the moment). */
export const AFTER_S = 0.8;
/** A waiting line older than this is dropped (the moment has passed). */
export const STALE_S = 4;
/** Minimum time between two lines (station cards included). */
export const GAP_S = 12;
/** Each kind speaks at most this often per vehicle... */
export const MAX_PER_KIND = 3;
/** ...and waits this long times the number of times it has spoken before speaking again. */
export const KIND_SPACING_S = 30;
/** The same station's card again only after this long. */
export const CARD_REPEAT_S = 90;
/** After a reset to a station the drive hint already names it: no card for this long. */
export const RESET_QUIET_S = 2;

interface Pending {
  line: Line;
  at: number;
}

/** Rate-limited, fading line selection. Times are simulation seconds. Allocates only when a moment is offered. */
export class CoachEngine {
  private lastShown = Number.NEGATIVE_INFINITY;
  private quietUntil = Number.NEGATIVE_INFINITY;
  private lastReset = Number.NEGATIVE_INFINITY;
  private pending: Pending | null = null;
  private readonly count = new Map<string, number>();
  private readonly lastByKind = new Map<string, number>();
  private readonly lastCard = new Map<string, number>();

  /** Forget the waiting line; moments until `until` are ignored (the takeover transient). */
  clear(until = Number.NEGATIVE_INFINITY): void {
    this.pending = null;
    this.quietUntil = until;
  }

  /** New vehicle: the competence fading starts again. */
  forget(): void {
    this.clear();
    this.count.clear();
    this.lastByKind.clear();
    this.lastCard.clear();
    this.lastShown = Number.NEGATIVE_INFINITY;
  }

  noteReset(now: number): void {
    this.lastReset = now;
    this.pending = null;
  }

  /** How many more times `id` may speak (0 = faded out). */
  remaining(id: string): number {
    return MAX_PER_KIND - (this.count.get(id) ?? 0);
  }

  private kindReady(id: string, now: number): boolean {
    const n = this.count.get(id) ?? 0;
    return n < MAX_PER_KIND && now - (this.lastByKind.get(id) ?? Number.NEGATIVE_INFINITY) >= KIND_SPACING_S * n;
  }

  /** A detected moment: it waits AFTER_S, then speaks if the rate limits allow. */
  offer(line: Line, now: number): void {
    if (now < this.quietUntil || !this.kindReady(line.id, now)) return;
    const p = this.pending;
    if (p && now - p.at < STALE_S && p.line.priority > line.priority) return;
    if (p && p.line.id === line.id && now - p.at < STALE_S) return; // the same moment continuing: keep its first values
    this.pending = { line, at: now };
  }

  /** A station card: immediately (it is about where the car is now), once per CARD_REPEAT_S per station. */
  card(line: Line, now: number): Line | null {
    if (now - this.lastReset < RESET_QUIET_S || now - (this.lastCard.get(line.id) ?? Number.NEGATIVE_INFINITY) < CARD_REPEAT_S) return null;
    this.lastCard.set(line.id, now);
    this.lastShown = now;
    this.pending = null;
    return line;
  }

  /** The line to show now, if any. */
  tick(now: number): Line | null {
    const p = this.pending;
    if (!p) return null;
    if (now - p.at >= STALE_S) {
      this.pending = null;
      return null;
    }
    if (now - p.at < AFTER_S || now - this.lastShown < GAP_S) return null;
    this.pending = null;
    if (!this.kindReady(p.line.id, now)) return null;
    this.count.set(p.line.id, (this.count.get(p.line.id) ?? 0) + 1);
    this.lastByKind.set(p.line.id, now);
    this.lastShown = now;
    return p.line;
  }
}
