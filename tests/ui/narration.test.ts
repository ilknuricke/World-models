import { describe, expect, it, vi } from 'vitest';
import { createNarrator, type NarratorOptions } from '../../src/ui/narration';

const voice = (lang: string, name: string) => ({ lang, name } as SpeechSynthesisVoice);
function setup(extra: Partial<NarratorOptions> = {}) {
  const utterances: SpeechSynthesisUtterance[] = [];
  let voices = [voice('en-US', 'English'), voice('tr-TR', 'Turkish')];
  const synthesis = {
    speak: vi.fn((speech: SpeechSynthesisUtterance) => { utterances.push(speech); }),
    cancel: vi.fn(),
    getVoices: () => voices,
  };
  const utterance = (text: string) => ({ text, lang: '', voice: null, rate: 1, onend: null, onerror: null } as SpeechSynthesisUtterance);
  const changed = vi.fn();
  const narrator = createNarrator({ synthesis, utterance, onChange: changed, ...extra });
  return { narrator, synthesis, utterances, changed, setVoices: (next: SpeechSynthesisVoice[]) => { voices = next; } };
}
const end = (utterance: SpeechSynthesisUtterance) => utterance.onend?.call(utterance, {} as SpeechSynthesisEvent);
const start = (utterance: SpeechSynthesisUtterance) => utterance.onstart?.call(utterance, {} as SpeechSynthesisEvent);
const error = (utterance: SpeechSynthesisUtterance, code: SpeechSynthesisErrorCode) => utterance.onerror?.call(utterance, { error: code } as SpeechSynthesisErrorEvent);

describe('Turkish message narration', () => {
  it('narrates a newly displayed message by default without requiring an activation click', () => {
    const { narrator, utterances } = setup();
    expect(narrator.state).toMatchObject({ enabled: true, activated: true });
    narrator.say({}, 'Sol ön tekerlek hafifler.');
    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toMatchObject({ text: 'Sol ön tekerlek hafifler.', lang: 'tr-TR', voice: { lang: 'tr-TR' } });
  });

  it('speaks only the latest displayed sentence after the first gesture, using a Turkish voice', () => {
    const { narrator, utterances } = setup({ autoplay: false });
    const owner = {};
    narrator.say(owner, 'Eski açıklama.');
    narrator.say(owner, 'Sol ön tekerlek hafifler.');
    expect(utterances).toHaveLength(0);
    narrator.activate();
    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toMatchObject({ text: 'Sol ön tekerlek hafifler.', lang: 'tr-TR', voice: { lang: 'tr-TR' } });
  });

  it('does not repeat speech on later gestures or repeated live updates of the same message', () => {
    const { narrator, utterances } = setup();
    const owner = {};
    narrator.activate();
    narrator.say(owner, 'Tekerlek yükselir.');
    narrator.say(owner, 'Tekerlek yükselir.');
    narrator.activate();
    expect(utterances).toHaveLength(1);
    end(utterances[0]!);
    narrator.activate();
    expect(utterances).toHaveLength(1);
  });

  it('cancels an older utterance rather than building a queue, and ignores its stale callbacks', () => {
    const { narrator, synthesis, utterances } = setup();
    narrator.activate();
    narrator.say({}, 'Eski açıklama.');
    narrator.say({}, 'Yeni açıklama.');
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    error(utterances[0]!, 'language-unavailable');
    expect(narrator.state.unavailable).toBe(false);
    end(utterances[0]!);
    narrator.setEnabled(false);
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
  });

  it('clears hidden messages before activation and does not cancel another panel’s newer message', () => {
    const { narrator, synthesis, utterances } = setup({ autoplay: false });
    const insight = {};
    const engineer = {};
    narrator.say(insight, 'Gizlenen açıklama.');
    narrator.clear(insight);
    narrator.activate();
    expect(utterances).toHaveLength(0);
    narrator.say(engineer, 'Mühendisin yanıtı.');
    narrator.clear(insight);
    expect(synthesis.cancel).not.toHaveBeenCalled();
    narrator.clear(engineer);
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('respects the on/off setting, cancels immediately and reads the current message when switched back on', () => {
    const { narrator, synthesis, utterances } = setup({ enabled: false });
    const owner = {};
    narrator.activate();
    narrator.say(owner, 'Gövde sağa yatar.');
    expect(utterances).toHaveLength(0);
    narrator.setEnabled(true);
    expect(utterances).toHaveLength(1);
    narrator.setEnabled(false);
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    narrator.say(owner, 'Gövde sola yatar.');
    narrator.setEnabled(true);
    expect(utterances.map((u) => u.text)).toEqual(['Gövde sağa yatar.', 'Gövde sola yatar.']);
  });

  it('lets a naturally expired caption finish speaking, but never starts it later after a gesture', () => {
    const { narrator, synthesis, utterances } = setup({ autoplay: false });
    const owner = {};
    narrator.say(owner, 'Henüz okunmayan açıklama.');
    narrator.clear(owner, false);
    narrator.activate();
    expect(utterances).toHaveLength(0);
    narrator.say(owner, 'Sesli anlatılan açıklama.');
    narrator.clear(owner, false);
    expect(synthesis.cancel).not.toHaveBeenCalled();
    narrator.say({}, 'Yeni açıklama.');
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('selects voices when they become available, while keeping tr-TR on the browser fallback', () => {
    const { narrator, utterances, setVoices } = setup();
    setVoices([]);
    narrator.activate();
    narrator.say({}, 'İlk açıklama.');
    expect(utterances[0]).toMatchObject({ lang: 'tr-TR', voice: null });
    setVoices([voice('en-US', 'English'), voice('tr', 'Turkish')]);
    narrator.say({}, 'İkinci açıklama.');
    expect(utterances[1]?.voice?.lang).toBe('tr');
  });

  it('waits for another gesture when the browser blocks speech and exposes voice errors without throwing', () => {
    const { narrator, utterances } = setup();
    narrator.say({}, 'Açıklama.');
    error(utterances[0]!, 'not-allowed');
    expect(narrator.state).toMatchObject({ enabled: true, activated: false });
    narrator.activate();
    expect(utterances).toHaveLength(2);
    error(utterances[1]!, 'language-unavailable');
    expect(narrator.state.unavailable).toBe(true);
  });

  it('does not require speech support and ignores empty captions', () => {
    const { narrator, utterances } = setup({ synthesis: null, utterance: null });
    narrator.activate();
    expect(() => narrator.say({}, 'Açıklama.')).not.toThrow();
    expect(narrator.state.supported).toBe(false);
    expect(utterances).toHaveLength(0);
  });

  it('cleans up speech on disposal, and cannot speak again afterwards', () => {
    const { narrator, synthesis, utterances } = setup();
    narrator.activate();
    narrator.say({}, 'Açıklama.');
    narrator.dispose();
    narrator.say({}, 'Sonraki açıklama.');
    narrator.setEnabled(true);
    narrator.activate();
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    expect(utterances).toHaveLength(1);
  });

  it('reports the selected voice and actual playback lifecycle, ignoring stale utterance events', () => {
    const { narrator, utterances, changed } = setup();
    narrator.activate();
    narrator.say({}, 'İlk açıklama.');
    expect(narrator.state).toMatchObject({ voiceName: 'Turkish', speaking: false });
    start(utterances[0]!);
    expect(narrator.state.speaking).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ voiceName: 'Turkish', speaking: true }));
    narrator.say({}, 'İkinci açıklama.');
    expect(narrator.state.speaking).toBe(false);
    start(utterances[1]!);
    end(utterances[0]!);
    expect(narrator.state.speaking).toBe(true);
    error(utterances[1]!, 'language-unavailable');
    expect(narrator.state).toMatchObject({ speaking: false, unavailable: true });
  });

  it('lets engineer answers finish, drops intervening background captions and reads the next fresh caption', () => {
    const { narrator, synthesis, utterances } = setup();
    const background = {};
    const engineer = {};
    narrator.say(background, 'Pist açıklaması.');
    narrator.say(engineer, 'Mühendisin uzun yanıtı.', 10);
    start(utterances[1]!);
    narrator.say(background, 'Yanıt sırasında gösterilen açıklama.');
    narrator.clear(background);
    expect(utterances.map((u) => u.text)).toEqual(['Pist açıklaması.', 'Mühendisin uzun yanıtı.']);
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    expect(narrator.state.speaking).toBe(true);

    end(utterances[1]!);
    expect(utterances).toHaveLength(2); // no stale caption is queued after the answer
    narrator.say(background, 'Yanıttan sonraki yeni açıklama.');
    expect(utterances[2]?.text).toBe('Yanıttan sonraki yeni açıklama.');
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('preserves a protected answer as the latest message and releases priority when its panel closes', () => {
    const { narrator, utterances } = setup();
    const engineer = {};
    const background = {};
    narrator.say(engineer, 'Mühendisin yanıtı.', 10);
    narrator.say(background, 'Arka plan açıklaması.');
    narrator.setEnabled(false);
    narrator.say(background, 'Ses kapalıyken gelen açıklama.');
    narrator.setEnabled(true);
    expect(utterances.map((u) => u.text)).toEqual(['Mühendisin yanıtı.', 'Mühendisin yanıtı.']);
    narrator.clear(engineer);
    narrator.say(background, 'Panel kapandıktan sonraki açıklama.');
    expect(utterances[2]?.text).toBe('Panel kapandıktan sonraki açıklama.');
  });

  it('keeps the requested answer pending if autoplay is blocked instead of replacing it with a background caption', () => {
    const { narrator, utterances } = setup();
    const engineer = {};
    narrator.say(engineer, 'İstenen yanıt.', 10);
    error(utterances[0]!, 'not-allowed');
    narrator.say({}, 'Beklerken gelen açıklama.');
    narrator.activate();
    expect(utterances.map((u) => u.text)).toEqual(['İstenen yanıt.', 'İstenen yanıt.']);
  });

  it('reserves the voice while waiting and after the answer finishes, until the panel releases it', () => {
    const { narrator, synthesis, utterances } = setup();
    const engineer = {};
    const track = {};
    narrator.say(track, 'Viraj notu.');
    start(utterances[0]!);
    narrator.setFocus(engineer, 10);
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    expect(narrator.state).toMatchObject({ speaking: false, text: null, priority: null });
    narrator.clear(engineer); // the panel is waiting for its network response, not closed
    narrator.say(track, 'Yanıt beklenirken gelen viraj notu.');
    expect(utterances).toHaveLength(1);

    narrator.say(engineer, 'Kamber, tekerleğin yol düzlemine göre yaptığı açıdır.', 10);
    start(utterances[1]!);
    expect(narrator.state).toMatchObject({ speaking: true, text: utterances[1]!.text, priority: 10 });
    end(utterances[0]!); // canceled background callbacks cannot clear the answer's playback evidence
    expect(narrator.state.speaking).toBe(true);
    end(utterances[1]!);
    expect(narrator.state).toMatchObject({ speaking: false, text: null, priority: null });
    narrator.say(track, 'Yanıt kartı açıkken yeni viraj notu.');
    expect(utterances).toHaveLength(2);

    narrator.clear(engineer);
    narrator.setFocus(engineer, null);
    expect(utterances).toHaveLength(2); // no rejected notes are queued
    narrator.say(track, 'Panel kapandıktan sonraki yeni not.');
    expect(utterances[2]!.text).toBe('Panel kapandıktan sonraki yeni not.');
  });

  it('drops a muted background message on focus and keeps only the requested answer for unmuting', () => {
    const { narrator, utterances } = setup({ enabled: false });
    const engineer = {};
    const track = {};
    narrator.say(track, 'Ses kapalıyken bekleyen eski viraj notu.');
    narrator.setFocus(engineer, 10);
    narrator.setEnabled(true);
    expect(utterances).toHaveLength(0);
    narrator.say(track, 'Mühendis beklerken gelen not.');
    expect(utterances).toHaveLength(0);
    narrator.say(engineer, 'Mühendisin yanıtı.', 10);
    narrator.setEnabled(false);
    narrator.say(track, 'Yanıt kartı açıkken gelen başka not.');
    narrator.setEnabled(true);
    expect(utterances.map((u) => u.text)).toEqual(['Mühendisin yanıtı.', 'Mühendisin yanıtı.']);
  });

  it('reserves the pending answer across autoplay blocking and subsequent activation', () => {
    const { narrator, utterances } = setup({ autoplay: false });
    const engineer = {};
    narrator.say({}, 'Etkinleştirmeyi bekleyen viraj notu.');
    narrator.setFocus(engineer, 10);
    narrator.activate();
    expect(utterances).toHaveLength(0);
    narrator.say(engineer, 'Beklenen mühendis yanıtı.', 10);
    error(utterances[0]!, 'not-allowed');
    narrator.say({}, 'Tarayıcı izin beklerken gelen not.');
    narrator.activate();
    expect(utterances.map((u) => u.text)).toEqual(['Beklenen mühendis yanıtı.', 'Beklenen mühendis yanıtı.']);
  });

  it('releases only the named owner’s focus and never resumes a preempted message', () => {
    const { narrator, synthesis, utterances } = setup();
    const engineer = {};
    const coach = {};
    const modal = {};
    narrator.setFocus(engineer, 10);
    narrator.setFocus(coach, 1);
    narrator.setFocus(coach, null);
    narrator.say({}, 'Hâlâ engellenen viraj notu.');
    expect(utterances).toHaveLength(0);
    narrator.say(engineer, 'Mühendisin yanıtı.', 10);
    narrator.setFocus(modal, 20);
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    narrator.setFocus(modal, null);
    narrator.setEnabled(false);
    narrator.setEnabled(true);
    expect(utterances).toHaveLength(1); // acquiring focus removed the preempted pending message too
    narrator.say(engineer, 'Mühendisin yeni yanıtı.', 10);
    expect(utterances[1]!.text).toBe('Mühendisin yeni yanıtı.');
    narrator.dispose();
    narrator.setFocus(engineer, null);
    narrator.say({}, 'Kapatılmış anlatıcıdan yeni not.');
    expect(utterances).toHaveLength(2);
  });
});
