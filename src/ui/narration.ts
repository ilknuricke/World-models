/** Turkish message narration, shared by the caption and engineer panels in one overlay. */
import { h } from './dom';

type SpeechEngine = Pick<SpeechSynthesis, 'cancel' | 'getVoices' | 'speak'>;

export interface NarrationState {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly activated: boolean;
  readonly unavailable: boolean;
  readonly voiceName: string | null;
  readonly speaking: boolean;
  readonly text: string | null;
  readonly priority: number | null;
}

export interface Narrator {
  readonly state: NarrationState;
  /** A new displayed sentence. New messages replace the current utterance rather than queue behind it. */
  say(owner: object, text: string, priority?: number): void;
  /** Reserve the voice while a requested panel is waiting or visible, independently of playback. */
  setFocus(owner: object, priority: number | null): void;
  /** Hiding one panel must not interrupt another panel's more recent message. */
  clear(owner: object, interrupt?: boolean): void;
  activate(): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface NarratorOptions {
  readonly synthesis: SpeechEngine | null;
  readonly utterance: ((text: string) => SpeechSynthesisUtterance) | null;
  readonly enabled?: boolean;
  /** Try reading immediately; browsers that block autoplay resume on the next user gesture. */
  readonly autoplay?: boolean;
  readonly onChange?: (state: NarrationState) => void;
}

/** Browser-independent speech lifecycle; enabled by default, with a gesture fallback for autoplay restrictions. */
export function createNarrator(options: NarratorOptions): Narrator {
  const { synthesis, utterance: makeUtterance } = options;
  const supported = synthesis !== null && makeUtterance !== null;
  let enabled = options.enabled ?? true;
  let activated = options.autoplay ?? true;
  let unavailable = false;
  let voiceName: string | null = null;
  let speaking = false;
  let disposed = false;
  let generation = 0;
  let latest: { owner: object; text: string; priority: number } | null = null;
  let current: { owner: object; text: string; priority: number; utterance: SpeechSynthesisUtterance } | null = null;
  const focused = new Map<object, number>();
  const blocked = (owner: object, priority: number) => [...focused].some(([other, held]) => other !== owner && held > priority);
  const state = (): NarrationState => ({ supported, enabled, activated, unavailable, voiceName, speaking, text: current?.text ?? null, priority: current?.priority ?? null });
  const changed = () => options.onChange?.(state());

  const cancel = () => {
    generation++;
    if (!current) return;
    current = null;
    speaking = false;
    try { synthesis?.cancel(); } catch { /* Voice service unavailable: the visual message still works. */ }
    changed();
  };
  const speakLatest = () => {
    if (disposed || !supported || !enabled || !activated || !latest || !synthesis || !makeUtterance) return;
    if (current?.owner === latest.owner && current.text === latest.text) return;
    cancel();
    const token = generation;
    try {
      const speech = makeUtterance(latest.text);
      speech.lang = 'tr-TR';
      const voices = synthesis.getVoices();
      speech.voice = voices.find((voice) => voice.lang.toLowerCase() === 'tr-tr')
        ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('tr'))
        ?? null;
      voiceName = speech.voice?.name ?? null;
      speech.rate = 1;
      speech.onstart = () => {
        if (disposed || generation !== token) return;
        speaking = true;
        changed();
      };
      speech.onend = () => {
        if (disposed || generation !== token) return;
        current = null;
        speaking = false;
        changed();
      };
      speech.onerror = (event) => {
        if (disposed || generation !== token) return;
        current = null;
        speaking = false;
        if (event.error === 'canceled' || event.error === 'interrupted') {
          changed();
          return;
        }
        if (event.error === 'not-allowed') activated = false;
        else unavailable = true;
        changed();
      };
      current = { ...latest, utterance: speech };
      unavailable = false;
      synthesis.speak(speech);
      changed();
    } catch {
      current = null;
      speaking = false;
      unavailable = true;
      changed();
    }
  };

  return {
    get state() { return state(); },
    say(owner, text, priority = 0) {
      if (disposed) return;
      const sentence = text.trim().replace(/\s+/g, ' ').replace(/\s*→\s*/g, ' yerine ');
      if (!sentence) return;
      // A visible requested answer keeps ownership after it finishes, and while waiting for a reply.
      if (blocked(owner, priority)) return;
      // An answer requested by the visitor must finish before incidental captions can take the voice.
      // Drop those captions entirely: they must not queue up or replace the answer resumed after muting.
      const protectedMessage = current ?? (!enabled || !activated ? latest : null);
      if (protectedMessage && protectedMessage.owner !== owner && protectedMessage.priority > priority) return;
      latest = { owner, text: sentence, priority };
      speakLatest();
    },
    setFocus(owner, priority) {
      if (disposed) return;
      if (priority === null) {
        focused.delete(owner);
        return; // Captions rejected during focus stay dropped; only a new message may speak.
      }
      focused.set(owner, priority);
      if (latest && blocked(latest.owner, latest.priority)) latest = null;
      if (current && blocked(current.owner, current.priority)) cancel();
    },
    clear(owner, interrupt = true) {
      if (latest?.owner === owner) latest = null;
      if (interrupt && current?.owner === owner) cancel();
    },
    activate() {
      if (disposed || activated) return;
      activated = true;
      unavailable = false;
      speakLatest();
      changed();
    },
    setEnabled(value) {
      if (disposed) return;
      enabled = value;
      if (enabled) speakLatest();
      else cancel();
      changed();
    },
    dispose() {
      cancel();
      latest = null;
      focused.clear();
      disposed = true;
    },
  };
}

export interface MessageNarration {
  say(text: string): void;
  setFocused(focused: boolean): void;
  /** A naturally expired caption may finish speaking; explicit hiding or a mode change interrupts it. */
  clear(interrupt?: boolean): void;
  dispose(): void;
}

export interface MessageNarrationOptions {
  /** Requested answers take precedence over background captions during playback and while focused. */
  readonly priority?: number;
}

interface SharedNarration {
  readonly narrator: Narrator;
  readonly cleanup: () => void;
  readonly owners: Set<object>;
  references: number;
}

const overlays = new WeakMap<HTMLElement, SharedNarration>();

function mountNarrator(overlay: HTMLElement): SharedNarration {
  const button = h('button', { type: 'button', class: 'sl-narration-toggle', 'aria-label': 'Sesli anlatım', 'aria-pressed': 'true' });
  const root = h('div', { class: 'sl-narration' }, button);
  overlay.append(root);
  let narrator: Narrator;
  const sync = (state: NarrationState) => {
    button.disabled = !state.supported;
    button.setAttribute('aria-pressed', String(state.enabled));
    button.textContent = !state.supported ? 'Anlatım desteklenmiyor' : state.unavailable ? 'Ses kullanılamıyor'
      : state.enabled ? (state.speaking ? ((state.priority ?? 0) > 0 ? 'Mühendis yanıtı okunuyor' : 'Anlatım okunuyor') : 'Anlatım açık') : 'Anlatım kapalı';
    button.title = !state.supported ? 'Tarayıcınız sesli anlatımı desteklemiyor.'
      : state.unavailable ? 'Türkçe ses şu anda kullanılamıyor. Yeniden denemek için anlatımı kapatıp açın.'
      : !state.enabled ? 'Türkçe sesli anlatımı aç'
      : state.activated ? 'Türkçe sesli anlatımı kapat' : 'Anlatım açık. Tarayıcı sesi başlatmak için ilk dokunuşu veya tuşu bekliyor.';
    if (state.voiceName) button.title += ` Seçili ses: ${state.voiceName}.`;
    if (state.speaking && state.text) button.title += ` Okunan metin: ${state.text}`;
  };
  let synthesis: SpeechSynthesis | null = null;
  try { synthesis = typeof speechSynthesis === 'undefined' ? null : speechSynthesis; } catch { /* Unsupported embed. */ }
  narrator = createNarrator({
    synthesis,
    utterance: typeof SpeechSynthesisUtterance === 'function' ? (text) => new SpeechSynthesisUtterance(text) : null,
    enabled: true,
    onChange: sync,
  });
  sync(narrator.state);

  const gesture = (event: Event) => {
    if (event.target instanceof Node && root.contains(event.target)) return;
    if (event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey || event.altKey || event.repeat)) return;
    if (!document.hidden) narrator.activate();
  };
  const visibility = () => {
    if (document.hidden) {
      // Clear each live owner's pending message too; returning to this tab must not speak an expired caption.
      for (const owner of owners) narrator.clear(owner);
    }
  };
  const owners = new Set<object>();
  // Owners are registered below through this closure's methods, without making the controller global.
  const shared: SharedNarration = {
    narrator,
    owners,
    references: 0,
    cleanup() {
      window.removeEventListener('pointerdown', gesture, true);
      window.removeEventListener('keydown', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
      narrator.dispose();
      root.remove();
    },
  };
  button.addEventListener('click', () => {
    // A browser may block autoplay; this gesture starts the already-enabled narration.
    if (narrator.state.enabled && !narrator.state.activated) {
      narrator.activate();
      return;
    }
    const enabled = !narrator.state.enabled;
    narrator.setEnabled(enabled);
    if (enabled) narrator.activate();
  });
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('keydown', gesture, true);
  document.addEventListener('visibilitychange', visibility);
  return shared;
}

/** One toggle and one speech queue per overlay, even when all three message features are enabled. */
export function acquireNarration(overlay: HTMLElement, options: MessageNarrationOptions = {}): MessageNarration {
  let shared = overlays.get(overlay);
  if (!shared) {
    shared = mountNarrator(overlay);
    overlays.set(overlay, shared);
  }
  const owner = {};
  const entry = shared;
  entry.owners.add(owner);
  shared.references++;
  let disposed = false;
  return {
    say(text) { if (!disposed && !document.hidden) entry.narrator.say(owner, text, options.priority ?? 0); },
    setFocused(value) { if (!disposed) entry.narrator.setFocus(owner, value ? options.priority ?? 0 : null); },
    clear(interrupt) { if (!disposed) entry.narrator.clear(owner, interrupt); },
    dispose() {
      if (disposed) return;
      disposed = true;
      entry.narrator.clear(owner);
      entry.narrator.setFocus(owner, null);
      entry.owners.delete(owner);
      if (--entry.references === 0) {
        entry.cleanup();
        overlays.delete(overlay);
      }
    },
  };
}
