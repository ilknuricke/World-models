/**
 * Pure helpers for the Race Engineer panel: a preallocated telemetry ring (filled at 10 Hz without allocation),
 * the plain-language event label, the request payload (display units, rounded) and section-dependent chips.
 */
import type { DriveMode } from '../../contracts/drive';
import type { EngineerDrive, EngineerTelemetry } from '../../contracts/engineer';
import type { AxleKinematicsSummary, VehicleClass } from '../../contracts/suspension';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { Phenomenon } from '../../contracts/track';
import { G, RAD_TO_DEG } from '../../contracts/units';
import { SURFACES, type StationDefinition, type SurfaceKind, type WorldDefinition } from '../../contracts/world';

export interface SnapCorner {
  camber: number;
  toe: number;
  travel: number;
  travelRate: number;
  load: number;
  gripUse: number;
  surface: SurfaceKind;
}

export interface Snap {
  time: number;
  sectionIndex: number;
  speed: number;
  ax: number;
  ay: number;
  roll: number;
  pitch: number;
  rcFront: number;
  rcRear: number;
  // ---- Manual Drive (12-03): TRUE values of the frame's DriveFrame
  mode: DriveMode;
  steer: number;
  throttle: number;
  brake: number;
  beta: number;
  yawRate: number;
  gear: number;
  abs: boolean;
  traction: boolean;
  stability: boolean;
  zone: string;
  x: number;
  y: number;
  readonly corners: SnapCorner[];
}

const corner = (): SnapCorner => ({ camber: 0, toe: 0, travel: 0, travelRate: 0, load: 0, gripUse: 0, surface: 'asphalt' });

/** An empty snapshot (ring slots; a detected drive event's own copy). */
export function createSnap(cornerIds: readonly string[]): Snap {
  return {
    time: 0, sectionIndex: 0, speed: 0, ax: 0, ay: 0, roll: 0, pitch: 0, rcFront: Number.NaN, rcRear: Number.NaN,
    mode: 'auto', steer: 0, throttle: 0, brake: 0, beta: 0, yawRate: 0, gear: 0, abs: false, traction: false, stability: false, zone: 'loop', x: 0, y: 0,
    corners: cornerIds.map(corner),
  };
}

/** Copies TRUE fields of a frame into `s` (no allocation). */
export function fillSnap(s: Snap, t: TelemetryFrame, time: number): void {
  s.time = time;
  s.sectionIndex = t.sectionIndex;
  s.speed = t.speed;
  s.ax = t.ax;
  s.ay = t.ay;
  s.roll = t.roll;
  s.pitch = t.pitch;
  s.rcFront = t.axles[0]?.rollCentreHeight ?? Number.NaN;
  s.rcRear = t.axles[1]?.rollCentreHeight ?? Number.NaN;
  const d = t.drive;
  s.mode = d.mode;
  s.steer = t.steer;
  s.throttle = d.throttle;
  s.brake = d.brake;
  s.beta = d.beta;
  s.yawRate = t.yawRate;
  s.gear = d.gear;
  s.abs = d.absActive;
  s.traction = d.tractionActive;
  s.stability = d.stabilityActive;
  s.zone = d.zone;
  s.x = d.x;
  s.y = d.y;
  for (let i = 0; i < s.corners.length; i++) {
    const c = t.corners[i];
    const o = s.corners[i]!;
    if (!c) continue;
    o.camber = c.camber;
    o.toe = c.toe;
    o.travel = c.travel;
    o.travelRate = c.travelRate;
    o.load = c.load;
    o.gripUse = c.gripUse;
    o.surface = c.surface;
  }
}


/** Fixed-size ring of telemetry snapshots. `push` copies TRUE fields only and never allocates. */
export class SnapshotRing {
  private readonly slots: Snap[];
  private next = 0;
  private count = 0;

  constructor(
    size: number,
    readonly cornerIds: readonly string[],
  ) {
    this.slots = Array.from({ length: size }, () => createSnap(cornerIds));
  }

  push(t: TelemetryFrame, time: number): void {
    fillSnap(this.slots[this.next]!, t, time);
    this.next = (this.next + 1) % this.slots.length;
    this.count = Math.min(this.count + 1, this.slots.length);
  }

  latest(): Snap | undefined {
    return this.count === 0 ? undefined : this.slots[(this.next - 1 + this.slots.length) % this.slots.length];
  }

  /** The most eventful snapshot newer than `since` ("Why did it do that?" looks at the last second). */
  peak(since: number): Snap | undefined {
    let best: Snap | undefined;
    let bestScore = -1;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i]!;
      if (s.time < since) continue;
      const score = activity(s);
      if (score > bestScore) [best, bestScore] = [s, score];
    }
    return best ?? this.latest();
  }

  /** Driver inputs over [from, to]: most throttle and brake (0..1), and the steer of the snapshot nearest `from`. */
  inputs(from: number, to: number): { throttle: number; brake: number; steer: number } | undefined {
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let first = Infinity;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i]!;
      if (s.time < from || s.time > to) continue;
      n++;
      throttle = Math.max(throttle, s.throttle);
      brake = Math.max(brake, s.brake);
      if (s.time < first) [first, steer] = [s.time, s.steer];
    }
    return n === 0 ? undefined : { throttle, brake, steer };
  }
}

/** Acceleration in g plus wheel speed (m/s): a bump at half a metre per second weighs like a third of a g. */
function activity(s: Snap): number {
  let rate = 0;
  for (const c of s.corners) rate = Math.max(rate, Math.abs(c.travelRate));
  return Math.hypot(s.ax, s.ay) / G + 0.7 * rate;
}

const CORNER_NAMES: Readonly<Record<string, string>> = { fl: 'front-left', fr: 'front-right', rl: 'rear-left', rr: 'rear-right', f: 'front', r: 'rear' };

/** Plain-language label of what the vehicle is doing in this snapshot. */
export function eventLabel(s: Snap, cornerIds: readonly string[], vehicleClass: VehicleClass): string {
  const parts: string[] = [];
  const latG = s.ay / G;
  const longG = s.ax / G;
  // A single wheel bump twists the body's wheel plane (warp); heave, roll and pitch do not.
  if (vehicleClass === 'car' && s.corners.length === 4) {
    const [fl, fr, rl, rr] = s.corners.map((c) => c.travel) as [number, number, number, number];
    if (Math.abs(fl - fr - rl + rr) > 0.02) {
      const mean = (fl + fr + rl + rr) / 4;
      let lone = 0;
      s.corners.forEach((c, i) => {
        if (Math.abs(c.travel - mean) > Math.abs(s.corners[lone]!.travel - mean)) lone = i;
      });
      const up = s.corners[lone]!.travel > mean;
      parts.push(`${CORNER_NAMES[cornerIds[lone] ?? ''] ?? 'one'} wheel ${up ? 'rising over a bump' : 'dropping into a dip'}`);
    }
  }
  if (longG < -0.3) parts.push('hard braking, nose loaded');
  else if (longG > 0.2) parts.push('accelerating, rear squatting');
  if (Math.abs(latG) > 0.2) {
    const right = latG < 0;
    parts.push(
      vehicleClass === 'car'
        ? `mid-corner, ${right ? 'right' : 'left'}-hander, outside (${right ? 'left' : 'right'}) wheels loaded`
        : `leaning into a ${right ? 'right' : 'left'}-hander`,
    );
  } else parts.push(parts.length === 0 ? 'straight and steady' : 'on a straight');
  return parts.join(', ');
}

const r = (v: number, d: number): number => {
  const p = 10 ** d;
  const x = Math.round(v * p) / p;
  return x === 0 ? 0 : x; // no "-0" in the payload
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface PayloadContext {
  readonly vehicleClass: VehicleClass;
  readonly vehicleId: string;
  readonly suspensionId: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly summaries: { readonly front: AxleKinematicsSummary; readonly rear: AxleKinematicsSummary } | undefined;
}

/** Manual Drive context of a request (ARCH-M2 §12.4). */
export interface DriveContext {
  /** Plain label of the detected event (rules.ts driveLabel), 'none' without one. */
  readonly detected: string;
  /** Driver inputs over the half second before the event (0..1, steer rad); absent without an event. */
  readonly before?: { readonly throttle: number; readonly brake: number; readonly steer: number };
  /** Seconds from the event to the question. */
  readonly eventAge?: number;
  /** Assists the visitor switched off (names), told to the engineer through the situation label. */
  readonly aidsOff: readonly string[];
}

/** Surface label(s) under the four tyres, e.g. "Dry asphalt / Wet ceramic tiles" on a split surface. */
export function surfaceLabel(s: Snap): string {
  const labels: string[] = [];
  for (const c of s.corners) {
    const l = SURFACES[c.surface]?.label;
    if (l && !labels.includes(l)) labels.push(l);
  }
  return labels.join(' / ').slice(0, 60) || 'Kuru asfalt';
}

/** Where the car is off the loop: the nearest station of the zone, else the zone, else the open field. */
export function placeOf(world: WorldDefinition | null | undefined, zone: string, x: number, y: number): { id: string; name: string } | undefined {
  if (zone === 'loop') return undefined;
  let best: StationDefinition | undefined;
  let d = Infinity;
  for (const st of world?.stations ?? []) {
    if (st.zone !== zone) continue;
    const dd = (st.spawn.x - x) ** 2 + (st.spawn.y - y) ** 2;
    if (dd < d) [d, best] = [dd, st];
  }
  if (best) return { id: best.id, name: best.name };
  const z = world?.zones.find((q) => q.id === zone);
  return z ? { id: z.id, name: z.name } : { id: 'field', name: 'Test sahası' };
}

function driveBlock(s: Snap, d: DriveContext): EngineerDrive {
  const aids: ('abs' | 'traction' | 'stability')[] = [];
  if (s.abs) aids.push('abs');
  if (s.traction) aids.push('traction');
  if (s.stability) aids.push('stability');
  return {
    mode: s.mode === 'auto' ? 'manual' : s.mode,
    detected: d.detected,
    steer_deg: r(clamp(s.steer * RAD_TO_DEG, -90, 90), 1),
    throttle_pct: r(clamp(s.throttle * 100, 0, 100), 0),
    brake_pct: r(clamp(s.brake * 100, 0, 100), 0),
    sideslip_deg: r(clamp(s.beta * RAD_TO_DEG, -180, 180), 1),
    yaw_rate_dps: r(clamp(s.yawRate * RAD_TO_DEG, -720, 720), 0),
    gear: Math.round(clamp(s.gear, -1, 12)),
    surface: surfaceLabel(s),
    aids_active: aids,
  };
}

/** Request telemetry in display units. Every number here is a TRUE sim value (honesty rule §14). */
export function buildTelemetry(s: Snap, cornerIds: readonly string[], ctx: PayloadContext, drive?: DriveContext): EngineerTelemetry {
  const corners: Record<string, EngineerTelemetry['corners'][keyof EngineerTelemetry['corners']]> = {};
  s.corners.forEach((c, i) => {
    corners[cornerIds[i] ?? `c${i}`] = {
      camber_deg: r(clamp(c.camber * RAD_TO_DEG, -30, 30), 2),
      toe_deg: r(clamp(c.toe * RAD_TO_DEG, -30, 30), 2),
      travel_mm: r(clamp(c.travel * 1000, -500, 500), 0),
      load_n: r(clamp(c.load, 0, 60000), 0),
      grip_use: r(clamp(c.gripUse, 0, 5), 2),
    };
  });
  const derived: Record<string, number> = {};
  const put = (key: string, v: number, d: number) => {
    if (Number.isFinite(v)) derived[key] = r(v, d);
  };
  put('roll_centre_front_mm', s.rcFront * 1000, 0);
  put('roll_centre_rear_mm', s.rcRear * 1000, 0);
  if (ctx.summaries) {
    const { front, rear } = ctx.summaries;
    put('camber_gain_front_deg_per_cm', front.camberGain * RAD_TO_DEG * 0.01, 2);
    put('camber_gain_rear_deg_per_cm', rear.camberGain * RAD_TO_DEG * 0.01, 2);
    put('roll_camber_front', front.rollCamber, 2);
    put('roll_camber_rear', rear.rollCamber, 2);
    put('anti_dive_front_pct', front.antiPitch * 100, 0);
    put('anti_squat_rear_pct', rear.antiPitch * 100, 0);
  }
  let event = eventLabel(s, cornerIds, ctx.vehicleClass);
  const driving = drive !== undefined && s.mode !== 'auto' && ctx.vehicleClass === 'car';
  if (driving) {
    if (drive.before) {
      put('throttle_before_pct', drive.before.throttle * 100, 0);
      put('brake_before_pct', drive.before.brake * 100, 0);
      put('steer_before_deg', drive.before.steer * RAD_TO_DEG, 1);
    }
    if (drive.eventAge !== undefined) put('event_age_s', drive.eventAge, 1);
    const off = drive.aidsOff.length > 0 ? `, assists off (${drive.aidsOff.join(', ')})` : ''; // label charset: no colon
    if (event.length + off.length <= 120) event += off;
  }
  return {
    vehicle_class: ctx.vehicleClass,
    vehicle: ctx.vehicleId,
    suspension: ctx.suspensionId,
    section: ctx.sectionId,
    section_name: ctx.sectionName.replace(/[^\p{L}\p{N} ,.()'/-]/gu, '').slice(0, 40),
    event,
    speed_kmh: r(clamp(s.speed * 3.6, 0, 500), 0),
    lat_g: r(clamp(s.ay / G, -5, 5), 2),
    long_g: r(clamp(s.ax / G, -5, 5), 2),
    roll_deg: r(clamp(s.roll * RAD_TO_DEG, -90, 90), 2),
    pitch_deg: r(clamp(s.pitch * RAD_TO_DEG, -45, 45), 2),
    corners: corners as EngineerTelemetry['corners'],
    derived,
    ...(driving ? { drive: driveBlock(s, drive) } : {}),
  };
}

/** Three suggested questions per section phenomenon (no digits: numbers come from the sim). */
export const CHIPS: Readonly<Record<Phenomenon, readonly [string, string, string]>> = {
  'ride-resonance': ['Araç dalgalı zeminde neden sarsılıyor?', 'Tekerlek sekmesi nedir?', 'Burada amortisörlerin etkisi var mı?'],
  'brake-dive': ['Burun neden öne dalıyor?', 'Dalmaya direnç nedir?', 'Hangi süspansiyon en az dalar?'],
  'steering-lock': ['Ön tekerlekler neden eğiliyor?', 'Kaster nedir?', 'Sol ön tekerleği göster'],
  'single-wheel-bump': ['Tek tekerlek nasıl bağımsız hareket eder?', 'Süspansiyon hareketinden kaynaklanan yönlenme nedir?', 'Tümseği ağır çekimde göster'],
  'sustained-roll': ['Dış tekerlek neden eğiliyor?', 'Kamber kazanımı nedir?', 'Hangi süspansiyon daha iyi?'],
  harshness: ['Burada neden sert hissediliyor?', 'MacPherson sürtünmeyi artırır mı?', 'Bir amortisör göster'],
  'roll-reversal': ['Gövde neden iki yana sallanıyor?', 'Amortisörler burada ne yapıyor?', 'Ağır çekimde göster'],
  heave: ['Araç neden hafifliyor?', 'Çukurda ne oluyor?', 'Yayları göster'],
  'steady-state-roll': ['Burada neden daha fazla yatıyor?', 'Yalpa merkezi nedir?', 'Çift salıncakla karşılaştır'],
  'lane-change': ['Gövde neden sallanıyor?', 'Yatma hareketi ne kadar hızlı değişebilir?', 'Ağır çekimde göster'],
  'off-camber': ['Bu viraj neden farklı hissettiriyor?', 'En çok hangi tekerlek çalışıyor?', 'Yalpa merkezi nedir?'],
  settle: ['Süspansiyon şu anda ne yapıyor?', 'Yalpa merkezi nedir?', 'Hangi süspansiyon daha iyi?'],
};

/** Single-track questions: a bike has front/rear wheels and leans into the turn. */
export const MOTO_CHIPS: Readonly<Record<Phenomenon, readonly [string, string, string]>> = {
  'ride-resonance': ['Motosiklet dalgalı zeminde neden sarsılıyor?', 'Çatal ve arka amortisör ne yapıyor?', 'Seçili motosiklet süspansiyonu nasıl çalışıyor?'],
  'brake-dive': ['Çatal frenlemede neden sıkışıyor?', 'Telelever dalmayı nasıl azaltır?', 'Hangi motosiklet süspansiyonu daha az dalar?'],
  'steering-lock': ['Motosiklet dar virajda nasıl yönleniyor?', 'İz mesafesi nedir?', 'Ön tekerleği göster'],
  'single-wheel-bump': ['Ön ve arka tekerlek tümseği nasıl karşılıyor?', 'Çatal neden sıkışıyor?', 'Tümseği ağır çekimde göster'],
  'sustained-roll': ['Motosiklet virajın içine neden yatıyor?', 'Yatma açısı ile kamberin ilişkisi nedir?', 'Hangi motosiklet süspansiyonu daha iyi?'],
  harshness: ['Motosiklet burada neden sert hissediliyor?', 'Çatalın ilk hareket sürtünmesi nedir?', 'Arka amortisör ne yapıyor?'],
  'roll-reversal': ['Motosiklet neden ters yöne yatıyor?', 'Amortisörler yön değiştirmede ne yapıyor?', 'Ağır çekimde göster'],
  heave: ['Motosiklet tepede neden hafifliyor?', 'Çukurda ön ve arka yaylara ne oluyor?', 'Yayları göster'],
  'steady-state-roll': ['Motosiklet çemberde neden yatıyor?', 'Telelever ile teleskopik çatalın farkı nedir?', 'Modern arka bağlantı ne yapıyor?'],
  'lane-change': ['Motosiklet şerit değiştirirken nasıl yatıyor?', 'Çatal ve arka amortisör nasıl tepki veriyor?', 'Ağır çekimde göster'],
  'off-camber': ['Yolun eğimi motosikleti nasıl etkiliyor?', 'Ön ve arka lastiklerin yükü nasıl değişiyor?', 'İz mesafesi nedir?'],
  settle: ['Seçili motosiklet süspansiyonu nasıl çalışıyor?', 'Klasik ve Modern düzenin farkı nedir?', 'Hangi motosiklet süspansiyonu daha iyi?'],
};

export function chipsFor(phenomenon: Phenomenon | undefined, vehicleClass: VehicleClass): readonly string[] {
  return phenomenon ? (vehicleClass === 'motorcycle' ? MOTO_CHIPS : CHIPS)[phenomenon] : [];
}

/** Two or three questions after a detected drive event (rules.ts driveKey), no digits. */
export const EVENT_CHIPS: Readonly<Record<string, readonly string[]>> = {
  'slide-rear-lift': ['Neden spin attım?', 'Gaz kesince arkadan kayma nedir?', 'Bunu nasıl önlerim?'],
  'slide-rear': ['Arka taraf neden kaydı?', 'Arkadan kayma nedir?', 'Süspansiyon bunu değiştirir mi?'],
  'slide-front': ['Neden virajın dışına açıldı?', 'Önden kayma nedir?', 'Süspansiyon bunu değiştirir mi?'],
  lockup: ['Tekerlek neden kilitlendi?', 'ABS ne yapar?'],
  wheelspin: ['Tekerlek neden patinaj yaptı?', 'Çekiş desteği ne yapar?'],
  'aid-abs': ['ABS orada ne yaptı?', 'ABS olmadan daha kısa mesafede durur mu?'],
  'aid-traction': ['Çekiş desteği ne yaptı?', 'Arka tekerlekler neden patinaj yaptı?'],
  'aid-stability': ['Denge desteği ne yaptı?', 'Araç neden dönüyordu?'],
  'strike-kerb': ['O tekerlekte ne oldu?', 'Burada süspansiyon türü etkili mi?'],
  'strike-bump': ['O tekerlekte ne oldu?', 'Burada süspansiyon türü etkili mi?'],
  'hard-stop': ['Burun neden öne daldı?', 'Süspansiyon durma mesafesini değiştirir mi?'],
  'wheel-lift': ['Tekerleğin yükü neden azaldı?', 'Bu tutuşu azaltır mı?'],
  'bump-stop': ['Darbe takozu nedir?', 'Tekerlek neden hareket sınırına ulaştı?'],
  swap: ['Değiştirince ne değişti?', 'Bir fark hisseder miyim?', 'Hangi süspansiyon daha iyi?'],
};

/** Chips while driving with no recent event. */
export const DRIVE_CHIPS: readonly string[] = ['Değiştirince ne değişti?', 'Önden kayma nedir?', 'Denge desteği ne yapar?'];
