/**
 * Rule-based Race Engineer answer (no model): used when the model fails, times out, is over quota or quotes a
 * number that is not in the telemetry, and by the browser when the endpoint is unreachable or busy.
 * DUPLICATED VERBATIM in src/features/engineer/rules.ts (layering forbids a shared import between worker/ and
 * features/); tests/worker/engineer-fallback.test.ts asserts the two files are identical. Import-free on purpose.
 * Every number it prints is a telemetry value; every claim agrees with the measured simulation (02-02, 02-04).
 */

export interface RuleCorner {
  readonly camber_deg: number;
  readonly travel_mm: number;
}

export interface RuleTelemetry {
  readonly vehicle_class: string;
  readonly suspension: string;
  readonly section_name: string;
  readonly speed_kmh: number;
  readonly lat_g: number;
  readonly long_g: number;
  readonly roll_deg: number;
  readonly pitch_deg: number;
  readonly corners: { readonly [corner: string]: RuleCorner | undefined };
  /** Present while the visitor drives (EngineerDrive). */
  readonly drive?: RuleDrive;
}

export interface RuleDrive {
  readonly mode: string;
  readonly detected: string;
  readonly steer_deg: number;
  readonly throttle_pct: number;
  readonly brake_pct: number;
  readonly sideslip_deg: number;
  readonly yaw_rate_dps: number;
  readonly gear: number;
  readonly surface: string;
  readonly aids_active: readonly string[];
}

const n = (v: number, d = 2): string => String(Number(Math.abs(v).toFixed(d)));
/** roll > 0 lifts the left side, i.e. the body leans to the right. */
const side = (roll: number): string => (roll > 0 ? 'sağa' : 'sola');
const CORNER_NAMES: Readonly<Record<string, string>> = { fl: 'sol ön', fr: 'sağ ön', rl: 'sol arka', rr: 'sağ arka', f: 'ön', r: 'arka' };

/** How each car suspension type answers body roll (agrees with the 02-04 difference report). */
const ROLL_CLAUSE: Readonly<Record<string, string>> = {
  macpherson: 'MacPherson sıkışırken az miktarda negatif kamber kazandırır; bu nedenle dış tekerlekler gövdeyle birlikte yatar; arka aksta üç tür arasında en fazla kamber kaybı bundadır.',
  'double-wishbone': 'Kısa üst salıncak, sıkışma sırasında dış tekerleğin üstünü içeri çeker; böylece lastik üç tür arasında yola en düz basan konumda kalır.',
  multilink: 'Bağlantıları sıkışmada orta düzeyde negatif kamber kazandırır; bu değer MacPherson ile çift salıncak arasındadır.',
};

const GENERIC_ROLL = 'Dış tekerleğin gövdeyle ne kadar yatacağı, bağlantıların sıkışmada kazandırdığı kambere bağlıdır.';

/** Outside front corner in a turn: lat_g < 0 is a right-hander, so the left side is outside. */
function outsideFront(t: RuleTelemetry): string | undefined {
  const id = t.lat_g < 0 ? 'fl' : 'fr';
  return t.corners[id] ? id : undefined;
}

function mostTravel(t: RuleTelemetry): string | undefined {
  let best: string | undefined;
  for (const [id, c] of Object.entries(t.corners)) if (c && (!best || Math.abs(c.travel_mm) > Math.abs(t.corners[best]!.travel_mm))) best = id;
  return best;
}

function corner(t: RuleTelemetry): string {
  const id = outsideFront(t);
  const c = id ? t.corners[id] : undefined;
  if (!id || !c || t.vehicle_class !== 'car') return '';
  return ` Dıştaki ${CORNER_NAMES[id]} tekerleğin yola göre kamberi ${c.camber_deg > 0 ? 'artı ' : 'eksi '}${n(c.camber_deg)} derece.`;
}

function rollAnswer(t: RuleTelemetry, lead: string): string {
  if (t.vehicle_class !== 'car') return `${lead} motosiklet ${n(t.roll_deg)} derece yatar; böylece yerçekimi viraj kuvvetini dengeler.`;
  return `${lead} gövde dışa doğru ${n(t.roll_deg)} derece yatar ve ek yükü dış lastikler taşır.${corner(t)} ${ROLL_CLAUSE[t.suspension] ?? GENERIC_ROLL}`;
}

const PHENOMENON: Readonly<Record<string, (t: RuleTelemetry) => string>> = {
  'ride-resonance': (t) =>
    `Düzlük boyunca zemin dalgalarının aralığı kısalır; ${n(t.speed_kmh, 0)} km/h hızda önce gövde sallanır, sonra tekerlekler lastikler üzerinde seker. Burada tüm süspansiyon türlerinin yayları ve amortisörleri aynı olduğundan tepkileri de neredeyse aynıdır.`,
  'brake-dive': (t) =>
    `${n(t.long_g)} g ile frenleme yükü ön lastiklere aktarır ve burun ${n(t.pitch_deg)} derece öne dalar. Bağlantıların yandan görünüş geometrisi bu dalmanın bir kısmına karşı koyar; ancak bu simülasyonda türler arasındaki fark çok küçüktür.`,
  'steering-lock': (t) =>
    `Direksiyon tam kırıldığında eksenin eğimi dış ön tekerleğe negatif kamber kazandırır; burada direksiyon geometrisi de bağlantılar kadar önemlidir.${corner(t)}`,
  'single-wheel-bump': (t) => {
    const id = mostTravel(t);
    const c = id ? t.corners[id] : undefined;
    const lead = id && c ? `Gövde sakin kalırken ${CORNER_NAMES[id] ?? id} tekerlek ${n(c.travel_mm, 0)} mm ${c.travel_mm >= 0 ? 'yükseldi' : 'alçaldı'}.` : 'Gövde sakin kalırken her tekerlek tümseği bağımsız karşılar.';
    return `${lead} Bağımsız süspansiyon, diğerlerini sürüklemeden tek tekerleğin hareket etmesini sağlar; süspansiyon hareketinden kaynaklanan yönlenme de neredeyse sıfıra ayarlandığından tekerlek düz kalır.`;
  },
  'sustained-roll': (t) => rollAnswer(t, `Bu uzun ve hızlı virajda ${n(t.lat_g)} g yanal ivmeyle`),
  'steady-state-roll': (t) => rollAnswer(t, `Çember virajda ${n(t.lat_g)} g yanal ivmeyle`),
  'off-camber': (t) => rollAnswer(t, `Yol bu virajın dışına doğru eğildiğinden ${n(t.lat_g)} g yanal ivmeyle`),
  harshness: (t) =>
    `Arnavut kaldırımı ve kasisler ${n(t.speed_kmh, 0)} km/h hızda tekerlekleri hızla yukarı iter; gövdeye ne kadarının ulaşacağını amortisörler belirler. MacPherson yan yük nedeniyle biraz daha fazla sürtünme üretir ve küçük darbeleri daha sert hissettirir; ancak bu simülasyonda fark küçüktür.`,
  'roll-reversal': (t) =>
    `Şikanda yük bir taraftan diğerine geçer; gövde de önce bir yana, sonra diğer yana yatar. Şu anda ${side(t.roll_deg)} ${n(t.roll_deg)} derece yatıyor; yön değişiminin hızını amortisörler belirler.`,
  heave: (t) =>
    `Tepede araç hafifler ve yaylar uzar; çukurda araç aşağı bastırıldıkça yaylar sıkışır. Şu anda burun ${n(t.pitch_deg)} derece ${t.pitch_deg >= 0 ? 'aşağıda' : 'yukarıda'}.`,
  'lane-change': (t) =>
    `${n(t.speed_kmh, 0)} km/h hızda çift şerit değiştirme yükü iki yana aktarır; gövde önce bir yana, sonra tersine yatar. Şu anda ${side(t.roll_deg)} ${n(t.roll_deg)} derece yatıyor.`,
  settle: (t) => `Giriş düzlüğünde araç ${n(t.speed_kmh, 0)} km/h hızda neredeyse düz ve dengeli ilerler; süspansiyon statik sürüş yüksekliğine döner.`,
};

/** Short glossary answers for common questions, matched by keyword (checked before the section rule). */
const GLOSSARY: readonly (readonly [RegExp, string])[] = [
  [/^(?=.*(what|explain|mean|nedir|ne demek|açıkla))(?=.*(roll cent(re|er)|yalpa merkezi))/i, 'Yalpa merkezi, gövdenin virajda etrafında yattığı varsayımsal noktadır; yükseldikçe viraj yükünün daha büyük kısmı yaylar yerine bağlantılardan geçer ve gövde biraz daha az yatar.'],
  [/\bbest\b|\bbetter\b|which (one|suspension)|daha iyi|en iyi|hangi süspansiyon/i, 'Her koşulda en iyi olan bir tür yoktur; maliyet, yerleşim ve tekerlek kontrolü arasında denge kurulur. MacPherson basit ve kompakttır, çift salıncak kamberi doğrudan kontrol eder, çok bağlantılı düzen ise daha fazla karmaşıklık karşılığında ayar özgürlüğü sağlar.'],
  [/^(?=.*(what|explain|mean|nedir|ne demek|açıkla))(?=.*(camber|kamber))/i, 'Kamber, tekerleğin üst kısmının içe veya dışa eğimidir. Negatif kamberde üst kısım araca doğru eğilir; bu, virajda dış lastiğin yola daha düz basmasını sağlar.'],
];

/** Preserve English case matching while also folding Turkish dotted and dotless I correctly. */
const matchesQuestion = (pattern: RegExp, question: string): boolean =>
  pattern.test(question) || pattern.test(question.toLocaleLowerCase('tr-TR'));

// ---------------------------------------------------------------- Manual Drive (12-03)

/** A detected drive moment (the DriveEvent kinds plus the M1 wheel-lift / bump-stop and a swap while driving). */
export type DriveMoment =
  | { readonly kind: 'slide'; readonly axle: 'front' | 'rear'; readonly lift: boolean }
  | { readonly kind: 'lockup' | 'wheelspin' | 'wheel-lift' | 'bump-stop'; readonly corner: number }
  | { readonly kind: 'aid'; readonly aid: 'abs' | 'traction' | 'stability' }
  | { readonly kind: 'strike'; readonly corner: number; readonly kerb: boolean }
  | { readonly kind: 'hard-stop' }
  | { readonly kind: 'swap'; readonly previous: string; readonly next: string };

const WHEEL = ['front-left', 'front-right', 'rear-left', 'rear-right'];
const WHEEL_RE = '(front-left|front-right|rear-left|rear-right)';
export const SUSPENSION_NAMES: Readonly<Record<string, string>> = { macpherson: 'MacPherson strut', 'double-wishbone': 'double wishbone', multilink: 'multi-link' };
const NAME_RE = '(MacPherson strut|double wishbone|multi-link)';
const idOfName = (name: string): string => Object.keys(SUSPENSION_NAMES).find((k) => SUSPENSION_NAMES[k] === name) ?? name;

/** Plain-language label of a moment (EngineerDrive.detected): no digits, words and light punctuation only. */
export function driveLabel(m: DriveMoment): string {
  const w = 'corner' in m ? (WHEEL[m.corner] ?? 'one') : '';
  switch (m.kind) {
    case 'slide':
      return m.axle === 'front' ? 'front slide, the car ran wide (understeer)' : m.lift ? 'rear slide after lifting off the throttle (lift-off oversteer)' : 'rear slide, the tail stepped out (oversteer)';
    case 'lockup':
      return `${w} wheel locked under braking`;
    case 'wheelspin':
      return `${w} wheel spun under power`;
    case 'wheel-lift':
      return `${w} wheel went light`;
    case 'bump-stop':
      return `${w} wheel reached its bump stop`;
    case 'aid':
      return m.aid === 'abs' ? 'anti-lock assist eased the brakes' : m.aid === 'traction' ? 'traction assist trimmed the engine' : 'stability assist braked one wheel';
    case 'strike':
      return `${w} wheel hit a ${m.kerb ? 'kerb' : 'bump'}`;
    case 'hard-stop':
      return 'hard stop from speed';
    case 'swap':
      return `suspension switched from ${SUSPENSION_NAMES[m.previous] ?? m.previous} to ${SUSPENSION_NAMES[m.next] ?? m.next}`;
  }
}

/** Label -> moment kind key and its wheel / suspension names (inverse of driveLabel for the primary event). */
function parseLabel(label: string): { key: string; wheel: string; previous: string; next: string } | undefined {
  const primary = label.split('; also ')[0] ?? '';
  const table: readonly (readonly [string, RegExp])[] = [
    ['slide-front', /^front slide/],
    ['slide-rear-lift', /^rear slide after lifting off/],
    ['slide-rear', /^rear slide/],
    ['lockup', new RegExp(`^${WHEEL_RE} wheel locked`)],
    ['wheelspin', new RegExp(`^${WHEEL_RE} wheel spun`)],
    ['wheel-lift', new RegExp(`^${WHEEL_RE} wheel went light`)],
    ['bump-stop', new RegExp(`^${WHEEL_RE} wheel reached its bump stop`)],
    ['strike-kerb', new RegExp(`^${WHEEL_RE} wheel hit a kerb`)],
    ['strike-bump', new RegExp(`^${WHEEL_RE} wheel hit a bump`)],
    ['aid-abs', /^anti-lock assist/],
    ['aid-traction', /^traction assist/],
    ['aid-stability', /^stability assist/],
    ['hard-stop', /^hard stop/],
    ['swap', new RegExp(`^suspension switched from ${NAME_RE} to ${NAME_RE}`)],
  ];
  for (const [key, re] of table) {
    const m = re.exec(primary);
    if (!m) continue;
    const swap = key === 'swap';
    return { key, wheel: swap ? '' : (m[1] ?? ''), previous: swap ? idOfName(m[1] ?? '') : '', next: swap ? idOfName(m[2] ?? '') : '' };
  }
  return undefined;
}

/** Kind key of a label's primary event ('slide-rear-lift', 'aid-abs', 'swap', ...), or undefined for 'none'. */
export const driveKey = (label: string): string | undefined => parseLabel(label)?.key;

const WHEEL_ID: Readonly<Record<string, string>> = { 'front-left': 'fl', 'front-right': 'fr', 'rear-left': 'rl', 'rear-right': 'rr' };
/**
 * Rear compliance steer per type while driving (09-04: the multi-link rear steers about three times as much; strut and
 * wishbone differ below notice). Data, not branching on ids (ARCHITECTURE §2 rule 8); pinned in engineer-drive-facts.
 */
const REAR_COMPLIANCE: Readonly<Record<string, 'small' | 'large'>> = { macpherson: 'small', 'double-wishbone': 'small', multilink: 'large' };

/** What changes between two types while driving (09-04 honesty report; pinned in engineer-drive-facts.test.ts). */
function swapAnswer(previous: string, next: string): string {
  const names: Readonly<Record<string, string>> = { macpherson: 'MacPherson', 'double-wishbone': 'çift salıncak', multilink: 'çok bağlantılı süspansiyon' };
  const p = names[previous] ?? previous;
  const q = names[next] ?? next;
  const from = REAR_COMPLIANCE[previous];
  const to = REAR_COMPLIANCE[next];
  if (from === undefined || to === undefined || from === to)
    return `Bu modelde ${p} ve ${q} ile sürüş neredeyse aynıdır: bağlantılar farklı hareket etse de gereken direksiyon açısı, tepki ve tutuş sınırı pek değişmez. Geometri farkı yakın görünümde daha kolay anlaşılır.`;
  if (to === 'large')
    return 'Çok bağlantılı düzende arka burçlar arka tekerlekleri hafifçe virajın içine yönlendirir; aynı virajda biraz daha fazla direksiyon gerekir, dönüş tepkisi biraz hızlanır ve arka taraf daha dengeli hissedilir. Tutuş sınırı ve durma mesafesi neredeyse aynı kalır.';
  return `Çok bağlantılı düzenden ${q} düzenine geçince arka burçların ek yönlendirme etkisi kaybolur; aynı virajda biraz daha az direksiyon gerekir ve arka taraf biraz daha hareketli olur. Tutuş sınırı ve durma mesafesi neredeyse aynı kalır.`;
}

const COMPARE_ANSWER = 'Bu modelde MacPherson ve çift salıncakla sürüş neredeyse aynıdır; çok bağlantılı düzen aynı virajda biraz daha fazla direksiyon ister ve arka tarafı daha dengeli hissedilir. Üçünün tutuş sınırı ve durma mesafesi neredeyse aynıdır; her koşulda en iyi olan bir tür yoktur.';

const DRIVE_GLOSSARY: readonly (readonly [RegExp, string])[] = [
  [/^(?=.*(what|explain|mean|nedir|ne demek|açıkla))(?=.*(understeer|önden kayma))/i, 'Önden kaymada ön lastikler tutuş sınırına önce ulaşır; araç virajın dışına açılır ve direksiyonu daha fazla çevirmek işe yaramaz. Hızı veya direksiyon açısını azaltmak tutuşu geri kazandırır.'],
  [/^(?=.*(what|explain|mean|nedir|ne demek|açıkla))(?=.*(oversteer|arkadan kayma))/i, 'Arkadan kaymada arka lastikler tutuş sınırına önce ulaşır; arka taraf dışa kayar ve araç direksiyonun istediğinden fazla döner. Gazı yumuşatmak ve gitmek istediğiniz yöne direksiyon vermek toparlamaya yardımcı olur.'],
  [/^(?=.*(what (is|does)|ne yap|nedir))(?=.*\b(abs|anti-lock)\b)/i, 'ABS desteği, basitleştirilmiş bir modelle, kilitlenmek üzere olan tekerleğin frenini azaltır. Böylece lastik dönmeye devam eder ve sert frenlemede de araç yönlendirilebilir.'],
  [/^(?=.*(what (is|does)|ne yap|nedir))(?=.*(traction|çekiş))/i, 'Çekiş desteği, basitleştirilmiş bir modelle, tahrik edilen arka tekerlekler patinaja başlayınca motor gücünü azaltır; böylece arka lastikler tutuşunu korur.'],
  [/^(?=.*(what (is|does)|ne yap|nedir))(?=.*(stability|denge))/i, 'Denge desteği, basitleştirilmiş bir modelle, araç direksiyonun istediğinden fazla veya az döndüğünde tek tekerleğe fren uygular; aracı istenen yöne döndürmeye çalışır.'],
];

const kmh = (t: RuleTelemetry) => `${n(t.speed_kmh, 0)} km/h`;

/** One answer per detected event kind; every number is a telemetry value captured at the event. */
function driveAnswer(question: string, t: RuleTelemetry, d: RuleDrive): string {
  const ev = parseLabel(d.detected);
  if (!ev) {
    if (matchesQuestion(/\b(switch|switched|swap|swapped|changed?)\b|değiştir|değişti/i, question)) return COMPARE_ANSWER;
    return `Son birkaç saniyede kayma, kilitlenme veya başka bir sürüş olayı algılanmadı; bu nedenle henüz açıklanacak bir neden yok. Şu anda araç ${kmh(t)} hızda, ${n(t.lat_g)} g yanal ivme ve ${n(d.sideslip_deg, 1)} derece yana kayma açısıyla ilerliyor.`;
  }
  const wheel = CORNER_NAMES[WHEEL_ID[ev.wheel] ?? ''] ?? ev.wheel;
  const c = t.corners[WHEEL_ID[ev.wheel] ?? ''];
  switch (ev.key) {
    case 'slide-rear-lift':
      return `Virajda gazı bırakınca yük ön lastiklere geçti; hafifleyen arka lastikler tutuşunu kaybetti ve araç ${kmh(t)} hızda ${n(d.sideslip_deg, 1)} derece yana kayma açısıyla döndü. Bir sonraki denemede gazı kademeli bırakın veya viraj boyunca biraz gazı koruyun.`;
    case 'slide-rear':
      return `Arka lastikler tutuş sınırını aştı ve araç ${kmh(t)} hızda ${n(d.sideslip_deg, 1)} derece yana kayma açısıyla arkadan kaydı. Sınırda gaz vermek, gaz kesmek veya ani direksiyon hareketi arkada tutuş kaybettirir; gazı yumuşatın ve gitmek istediğiniz yöne direksiyon verin.`;
    case 'slide-front':
      return `Ön lastikler tutuş sınırını aştı; araç ${kmh(t)} hızda ve ${n(d.steer_deg, 1)} derece direksiyon açısıyla dönmek yerine dışarı açıldı. Ön lastikler kayarken daha fazla direksiyon işe yaramaz; hızı veya direksiyon açısını azaltmak tutuşu geri kazandırır.`;
    case 'lockup':
      return `${wheel} tekerlek ${kmh(t)} hızda fren kuvveti lastiğin tutuşunu aştığı için kilitlendi; kayan lastik yönlendirme yapamaz. Tekerlek yeniden dönene kadar pedalı gevşetin; ABS açıkken bunu sizin yerinize yapar.`;
    case 'wheelspin':
      return `${wheel} tekerlek ${n(d.throttle_pct, 0)}% gaz konumunda patinaja düştü; motorun ilettiği çekiş lastiğin tutuşunu aştı. Gaza kademeli basın; çekiş desteği açıkken motor gücünü sizin yerinize azaltır.`;
    case 'aid-abs':
      return `ABS desteği, basitleştirilmiş bir modelle, kilitlenmek üzere olan tekerleğin frenini azalttı; tekerlekler dönmeye devam etti ve araç yönlendirilebildi. ${kmh(t)} hızda fren pedalı ${n(d.brake_pct, 0)}% konumundaydı.`;
    case 'aid-traction':
      return `Çekiş desteği, basitleştirilmiş bir modelle, arka tekerlekler ${n(d.throttle_pct, 0)}% gaz konumunda patinaja başlayınca motor gücünü azalttı. Böylece arka lastikler tutuşunu korur ve arka taraf çizgisinde kalır.`;
    case 'aid-stability':
      return `Denge desteği, basitleştirilmiş bir modelle, araç ${n(d.sideslip_deg, 1)} derece yana kayma açısıyla direksiyonun istediğinden farklı döndüğü için tek tekerleğe fren uyguladı. Bu, aracı direksiyonla gösterdiğiniz yöne döndürmeye çalışır.`;
    case 'strike-kerb':
    case 'strike-bump': {
      const what = ev.key === 'strike-kerb' ? 'bordüre' : 'tümseğe';
      const travel = c ? ` ve ${n(c.travel_mm, 0)} mm hareket etti` : '';
      return `${wheel} tekerlek ${what} çarptı: yay hızla sıkıştı${travel}; gövde daha sakin kalırken amortisör salınımı söndürdü. Bağımsız süspansiyon diğerlerini sürüklemeden tek tekerleğin hareket etmesini sağlar.`;
    }
    case 'hard-stop':
      return 'Sert frenlemede yük ön lastiklere geçti; burun öne daldı ve işin çoğunu ön lastikler yaptı. Durma mesafesi bu örnek modelin çıktısıdır; gerçek bir araç için tahmin değildir.';
    case 'wheel-lift':
      return `${wheel} tekerleğin yükü azaldı; yük neredeyse sıfırken lastiğin tutuşu da neredeyse sıfırdır. Tepeler, bordürler ve sert virajda iç tekerlekler bu duruma yol açabilir.`;
    case 'bump-stop':
      return `${wheel} tekerlek süspansiyon hareket mesafesini tüketip darbe takozuna dayandı; o köşenin sertliği aniden arttı. Büyük tümsekler veya hızlı geçilen bordürler buna yol açabilir.`;
    case 'swap':
      return swapAnswer(ev.previous, ev.next);
    default:
      return COMPARE_ANSWER;
  }
}

export function ruleAnswer(question: string, phenomenon: string | undefined, t: RuleTelemetry): string {
  for (const [re, text] of GLOSSARY) if (matchesQuestion(re, question)) return text;
  if (t.drive && t.vehicle_class === 'car') {
    for (const [re, text] of DRIVE_GLOSSARY) if (matchesQuestion(re, question)) return text;
    return driveAnswer(question, t, t.drive);
  }
  const rule = phenomenon === undefined ? undefined : PHENOMENON[phenomenon];
  return rule ? rule(t) : `${t.section_name.toLocaleLowerCase('tr-TR')} bölümünde ${n(t.speed_kmh, 0)} km/h hızda süspansiyon lastikleri yolda tutuyor; daha fazla bilgi için gövde yatmasını, kamberi veya bir tekerleği sorun.`;
}
