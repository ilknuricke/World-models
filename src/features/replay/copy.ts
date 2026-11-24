/** Replay feature copy and pure decisions (no DOM). Copy carries no digits (ARCH-M2 §13.7). */
import { REPLAY_LIMITS, type DriveEvent } from '../../contracts/drive';
import type { ReplayStatus } from '../../sim-core/drive/control';
import type { ReplayRefusal } from '../../sim-core/replay/format';
import type { LinkError } from './link';
import type { LoadError, SaveError } from './server';

/** Moment replay: the newest seconds it replays and the slow motion it plays them at (MD-43). */
export const MOMENT_SECONDS = 4;
export const MOMENT_TIME_SCALE = 0.25;
/** A detected driving event offers the moment replay for this long, s. */
export const OFFER_S = 10;
/** Recorded seconds before the chip offers anything. */
export const MIN_RECORDED_S = 1;
/** How long a note stays, s. */
export const NOTE_S = 6;

export const COPY = {
  moment: 'Son anları izle',
  momentTitle: 'Son anları ağır çekimde izleyin, ardından buradan sürmeye devam edin',
  share: 'Paylaş',
  shareTitle: 'Bu sürüşü bağlantıyla paylaşın',
  copy: 'Kopyala',
  copied: 'Bağlantı kopyalandı',
  copyManually: 'Bağlantıyı seçip kopyalayın',
  shareLastMinute: 'Son dakika paylaşılıyor: bir bağlantı en fazla bir dakikalık sürüş içerir.',
  tooBig: 'Bu sürüş bir bağlantıya sığmayacak kadar ayrıntılı.',
  linkNote: 'Bağlantı, sürüşünüzü ziyaretçinin tarayıcısında yeniden simüle ederek oynatır.',
  replay: 'Tekrar oynat',
  shared: 'Paylaşılan sürüş',
  slow: 'Ağır çekim',
  driveIt: 'Kendiniz sürün',
  driveItTitle: 'Tekrarı durdurup kontrolü buradan devralın',
  yourTurn: 'Sıra sizde: tekrarın bittiği yerden sürmeye devam ediyorsunuz.',
  back: 'Sürüşünüze döndünüz: kontrol yeniden sizde.',
  recording: 'Kaydediliyor',
  // saved runs (12-05)
  saveShort: 'Kısa bağlantı kaydet',
  saveWhole: 'Tüm sürüşü kaydet',
  saveTitle: 'Sürüşü laboratuvar sunucusuna kaydedip kısa bir bağlantı alın',
  saveRetry: 'Yeniden dene',
  savePrivacy: 'Kısa bir doğrulamanın ardından yalnızca kontrol girdileriniz ve başlangıç durumu otuz gün saklanır. Hesap veya kişisel bilgi gerekmez.',
  checking: 'Robot olmadığınız doğrulanıyor…',
  saving: 'Kaydediliyor…',
  saved: 'Kaydedildi: bu kısa bağlantı tüm sürüşü otuz gün boyunca oynatır.',
  longRun: 'Bir bağlantı en fazla bir dakikalık sürüş içerir. Kısa bağlantı almak için tüm sürüşü kaydedin.',
  tooBigSave: 'Bu sürüş bir bağlantıya sığmayacak kadar ayrıntılı. Kısa bağlantı almak için kaydedin.',
  fetching: 'Paylaşılan sürüş alınıyor…',
} as const;

const MINUTES = ['', 'bir dakika', 'iki dakika', 'üç dakika', 'dört dakika', 'beş dakika', 'altı dakika', 'yedi dakika', 'sekiz dakika', 'dokuz dakika', 'on dakika'];
/** "the last five minutes" (copy carries no digits). */
export const lastMinutes = (m: number): string => `son ${MINUTES[m] ?? 'birkaç dakika'}`;
/** The saved state's line when only the newest part of the run was saved. */
export const savedPart = (m: number): string => `Kaydedildi: bu kısa bağlantı sürüşün ${lastMinutes(m)}lık bölümünü otuz gün boyunca oynatır.`;
/** Before saving a part: why. */
export const savingPart = (m: number): string => `Sürüşün ${lastMinutes(m)}lık bölümü kaydediliyor: bir kayıt en fazla on dakika içerebilir ve boyutu sınırlıdır.`;

/** Save failures; `retry` = the same action may work in a moment. */
export const SAVE_ERROR: Readonly<Record<SaveError | 'unavailable' | 'expired' | 'unsupported', { readonly text: string; readonly retry: boolean }>> = {
  offline: { text: 'Çevrimdışısınız: kayıt için laboratuvara bağlantı gerekir.', retry: true },
  challenge: { text: 'Doğrulama başarısız oldu; hiçbir şey kaydedilmedi.', retry: true },
  unavailable: { text: 'Doğrulama yüklenemedi; engellenmiş veya çevrimdışı olabilir. Hiçbir şey kaydedilmedi.', retry: true },
  expired: { text: 'Kayıt başlamadan doğrulamanın süresi doldu.', retry: true },
  busy: { text: 'Bu bağlantıdan kısa sürede birkaç kayıt yapıldı. Bir dakika bekleyip yeniden deneyin.', retry: true },
  daily_cap: { text: 'Bugünkü kayıt kotası doldu. Yarın yeniden kayıt yapılabilir.', retry: false },
  storage: { text: 'Kayıt alanı şu anda dolu veya kullanılamıyor.', retry: true },
  disabled: { text: 'Bu sunucuda sürüş kaydı kapalı.', retry: false },
  too_large: { text: 'Bu sürüş kaydedilemeyecek kadar uzun veya ayrıntılı.', retry: false },
  unsupported: { text: 'Bu tarayıcı sürüşü kaydetmek için sıkıştıramıyor.', retry: false },
  failed: { text: 'Bu sefer kayıt yapılamadı.', retry: true },
};
/** After a save failure: what still works. */
export const FALLBACK = { whole: 'Yukarıdaki bağlantıyla tüm sürüşü paylaşabilirsiniz.', minute: 'Yukarıdaki bağlantıyla son dakikayı paylaşabilirsiniz.', none: '' } as const;

const LOAD_ERROR: Readonly<Record<Exclude<LoadError, LinkError>, string>> = {
  invalid: 'Kayıt bağlantısı eksik olduğundan sürüş alınamıyor.',
  missing: 'Bu sürüşün süresi dolmuş veya hiç kaydedilmemiş. Sürüşler otuz gün saklanır.',
  offline: 'Kaydı almak için laboratuvara ulaşılamadı. Bağlantınızı kontrol edip sayfayı yenileyin.',
  failed: 'Kayıt şu anda alınamadı. Biraz sonra sayfayı yenileyip yeniden deneyin.',
};

export const LINK_ERROR: Readonly<Record<LinkError, string>> = {
  damaged: 'Tekrar bağlantısı bozuk veya eksik olduğundan sürüş oynatılamıyor.',
  'newer-format': 'Bu tekrar bağlantısı laboratuvarın daha yeni bir sürümüyle oluşturulmuş. Güncellemek için sayfayı yenileyin.',
  unsupported: 'Bu tarayıcı tekrar bağlantılarını açamıyor.',
};

export const REFUSAL: Readonly<Record<ReplayRefusal | 'unavailable', string>> = {
  track: 'Bu tekrar başka bir pistte kaydedilmiş.',
  world: 'Bu tekrar farklı bir test alanı düzeninde kaydedilmiş.',
  vehicle: 'Bu tekrar başka bir araçla kaydedilmiş.',
  suspension: 'Bu tekrardaki süspansiyon bu otomobilde bulunmuyor.',
  state: 'Bu tekrar laboratuvarın uyumsuz bir sürümüyle kaydedilmiş.',
  unavailable: 'Tekrarlar için sürülebilir bir otomobil gerekir.',
};

/** The honesty line under the replay chip, or null when the replay matches the recording. */
export function statusNote(s: Readonly<ReplayStatus>): string | null {
  if (!s.sameVersion) return 'Eski bir modelle kaydedilmiş: tekrar, özgün sürüşten farklı olabilir.';
  if (!s.sameModel) return 'Farklı model ayarlarıyla kaydedilmiş: tekrar, özgün sürüşten farklı olabilir.';
  if (s.resyncs > 0) return 'Simülasyon kayıttan saptığı için yeniden hizalandı. Bundan sonrası yaklaşık sonuçtur.';
  if (s.mismatches > 0) return 'Simülasyon kayıttan saptı: tekrar bundan sonra farklı olabilir.';
  return null;
}

/** Share: the whole run when it fits the fragment limit, else the newest REPLAY_LIMITS.fragmentSeconds. */
export function shareSeconds(recordedTicks: number): { readonly seconds: number; readonly truncated: boolean } {
  const s = recordedTicks / 240;
  // a window rounds its start down to a whole snapshot second: ask for one less to stay within the limit
  return s <= REPLAY_LIMITS.fragmentSeconds ? { seconds: s, truncated: false } : { seconds: REPLAY_LIMITS.fragmentSeconds - 1, truncated: true };
}

/** Driving events that offer the moment replay (11-02 detectors). */
export const offers = (e: DriveEvent): boolean => e.kind === 'slide' || e.kind === 'lockup' || e.kind === 'wheelspin' || e.kind === 'aid';

/** What a `#rid=` link that cannot play says. */
export const loadMessage = (e: LoadError): string => (e in LOAD_ERROR ? LOAD_ERROR[e as keyof typeof LOAD_ERROR] : LINK_ERROR[e as LinkError]);
