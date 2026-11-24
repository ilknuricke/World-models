/**
 * Replays (plan 11-03; ARCHITECTURE-M2 §7.10 F/G, §9; MD-43, MD-50): the chip in the drive feature's action row.
 * Manual: a recording dot, Moment replay (Q: the last moments at quarter speed by exact re-simulation, then manual at
 * exactly the pre-replay state) and Share (the run, or its last minute, as a `#r=` fragment link — never the query
 * string). Replay: what is playing, progress, the honesty line (other model / drifted), "Drive it yourself" (branch
 * into manual). Opening a `#r=` link plays it once the first frame is up; damaged, newer or mismatched links explain
 * themselves calmly. Mode changes go through the bus ('drive:play', 'drive:request'); the kernel calls the simulation.
 * Saved runs (12-05, ARCHITECTURE-M2 §12.1): "Save a short link" / "Save the whole run" in the share popover loads the
 * Turnstile check (only then), posts the run and shows a `#rid=` link; the fragment link stays offered on any failure.
 * Opening `#rid=` fetches the run and plays it like a fragment link.
 */
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import type { DecodedReplay, DriveAids } from '../../contracts/drive';
import type { DriveHost } from '../../sim-core/drive/control';
import { h, mount } from '../../ui/dom';
import { COPY, FALLBACK, LINK_ERROR, loadMessage, MIN_RECORDED_S, MOMENT_SECONDS, MOMENT_TIME_SCALE, NOTE_S, OFFER_S, offers, REFUSAL, SAVE_ERROR, savedPart, savingPart, shareSeconds, statusNote } from './copy';
import { decodeFragment, detectPlatform, encodeFragment, fragmentOf, MAX_FRAGMENT_CHARS, shareUrl } from './link';
import { loadSaved, ridOf, savedUrl, saveReplay, saveSpan } from './server';
import { challenge, siteKeyFor } from './turnstile';
import './replay.css';

let frameHandler: ((frame: FrameInfo) => void) | undefined;
/** Note duration meaning "while the replay plays" (the honesty line). */
const PINNED = 1e9;

const sameAids = (a: DriveAids, b: DriveAids) => a.abs === b.abs && a.traction === b.traction && a.stability === b.stability && a.steering === b.steering;
const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
const ICON_REPLAY =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5v2.6h2.6"/><path d="M7 5.8v4.4L10.2 8z" fill="currentColor" stroke="none"/></svg>';
const ICON_SHARE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 9.4l2.8-2.8"/><path d="M8.6 4.3l1.1-1.1a2.6 2.6 0 0 1 3.7 3.7l-1.1 1.1"/><path d="M7.4 11.7l-1.1 1.1a2.6 2.6 0 0 1-3.7-3.7l1.1-1.1"/></svg>';
const icon = (svg: string) => {
  const el = h('span', { class: 'sl-replay-icon', 'aria-hidden': 'true' });
  el.innerHTML = svg;
  return el;
};

export default {
  id: 'replay',
  requires: [],
  phase: 'overlay',

  init(c) {
    const { store, bus } = c;
    const drive = () => c.sim.current.drive as DriveHost | undefined;
    const mode = () => store.get().driveMode;

    // --- DOM
    const recDot = h('span', { class: 'sl-replay-rec', title: COPY.recording }, h('span', { class: 'sl-replay-rec-dot', 'aria-hidden': 'true' }), h('span', { class: 'sl-replay-rec-text sl-drive-action-label' }, COPY.recording));
    const momentBtn = h(
      'button',
      { type: 'button', class: 'sl-replay-btn', 'data-action': 'moment', title: COPY.momentTitle, 'aria-keyshortcuts': 'Q' },
      icon(ICON_REPLAY),
      h('span', { class: 'sl-drive-action-label' }, COPY.moment),
      h('kbd', { class: 'sl-drive-kbd' }, 'Q'),
    );
    const shareBtn = h('button', { type: 'button', class: 'sl-replay-btn', 'data-action': 'share', title: COPY.shareTitle, 'aria-expanded': 'false', 'aria-controls': 'sl-replay-share' }, icon(ICON_SHARE), h('span', { class: 'sl-drive-action-label' }, COPY.share));
    const recRow = h('div', { class: 'sl-replay-row', 'data-row': 'record', hidden: true }, recDot, momentBtn, shareBtn);

    const playLabel = h('span', { class: 'sl-replay-label' }, COPY.replay);
    const slowTag = h('span', { class: 'sl-replay-tag', hidden: true }, COPY.slow);
    const bar = h('span', { class: 'sl-replay-bar-fill' });
    const progress = h('span', { class: 'sl-replay-bar', role: 'progressbar', 'aria-label': 'Tekrar ilerlemesi', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar);
    const driveBtn = h('button', { type: 'button', class: 'sl-replay-btn is-primary', 'data-action': 'drive', title: COPY.driveItTitle }, COPY.driveIt);
    const playRow = h('div', { class: 'sl-replay-row is-playing', 'data-row': 'play', hidden: true }, h('span', { class: 'sl-replay-play-dot', 'aria-hidden': 'true' }), playLabel, slowTag, progress, driveBtn);

    const shareInput = h('input', { class: 'sl-replay-link', type: 'text', readonly: true, 'aria-label': 'Tekrar bağlantısı', spellcheck: 'false' });
    const copyBtn = h('button', { type: 'button', class: 'sl-replay-btn', 'data-action': 'copy' }, COPY.copy);
    const shareMsg = h('span', { class: 'sl-replay-share-msg', role: 'status' });
    const shareFine = h('span', { class: 'sl-replay-share-fine' }, COPY.linkNote);
    const saveBtn = h('button', { type: 'button', class: 'sl-replay-btn sl-replay-save', 'data-action': 'save', title: COPY.saveTitle }, COPY.saveShort);
    const savePrivacy = h('span', { class: 'sl-replay-share-fine sl-replay-privacy', hidden: true }, COPY.savePrivacy);
    const widgetHost = h('div', { class: 'sl-replay-turnstile', hidden: true });
    const sharePanel = h(
      'div',
      { id: 'sl-replay-share', class: 'sl-replay-share', role: 'group', 'aria-label': COPY.shareTitle, tabindex: -1, hidden: true },
      h('div', { class: 'sl-replay-share-row' }, shareInput, copyBtn),
      shareMsg,
      savePrivacy,
      widgetHost,
      saveBtn,
      shareFine,
    );
    const noteText = h('span');
    const note = h('div', { class: 'sl-replay-note', role: 'status', hidden: true }, noteText);
    const root = h('div', { class: 'sl-drive-action sl-replay', hidden: true }, note, sharePanel, recRow, playRow);
    c.addDisposer(mount(c.dom.overlay, root));

    // --- state
    let noteS = 0;
    let offerS = 0;
    let moment: DecodedReplay | null = null; // the moment replay playing (timeScale owned by us while it plays)
    let shared: DecodedReplay | null = null; // a link's replay playing
    let pendingLink: DecodedReplay | null = null;
    let shareGen = 0;
    let saveGen = 0;
    let widget: { dispose(): void } | null = null;
    let fallback: keyof typeof FALLBACK = 'none';
    const shown = { visible: false, row: '', progress: -1, status: '' as string | null, slow: false, label: '', offered: false };

    const showNote = (text: string, seconds = NOTE_S) => {
      noteText.textContent = text;
      noteS = seconds;
      note.hidden = false;
    };
    const endChallenge = () => {
      widget?.dispose();
      widget = null;
      widgetHost.hidden = true;
      savePrivacy.hidden = true;
    };
    const closeShare = () => {
      saveGen++;
      endChallenge();
      sharePanel.hidden = true;
      shareBtn.setAttribute('aria-expanded', 'false');
    };

    // --- moment replay
    const playMoment = () => {
      const d = drive();
      if (mode() !== 'manual' || !d || d.recordedTicks < MIN_RECORDED_S * 240) return;
      const w = d.last(MOMENT_SECONDS);
      if (!w) return;
      closeShare();
      bus.emit('drive:play', { replay: w });
      if (d.replay?.replay !== w) return; // refused (the kernel warned)
      moment = w;
      shared = null;
      offerS = 0;
      store.setKey('timeScale', MOMENT_TIME_SCALE);
    };
    momentBtn.addEventListener('click', playMoment);
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyQ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (mode() !== 'manual') return;
      e.preventDefault();
      playMoment();
    };
    window.addEventListener('keydown', onKey);
    c.addDisposer(() => window.removeEventListener('keydown', onKey));

    // --- share link
    const share = () => {
      if (!sharePanel.hidden) return closeShare();
      const d = drive();
      if (!d || d.recordedTicks < MIN_RECORDED_S * 240) return;
      const { seconds, truncated } = shareSeconds(d.recordedTicks);
      const r = truncated ? d.last(seconds) : d.recording();
      if (!r) return;
      // the state at the end of the shared run: a viewer's replay must end with the same CRC (e2e reads it)
      sharePanel.dataset.crc = hex(d.stateChecksum());
      sharePanel.dataset.ticks = String(r.header.ticks);
      sharePanel.hidden = false;
      shareBtn.setAttribute('aria-expanded', 'true');
      shareInput.value = '';
      copyBtn.disabled = true;
      shareMsg.textContent = truncated ? COPY.shareLastMinute : '';
      saveGen++;
      endChallenge();
      fallback = truncated ? 'minute' : 'whole';
      saveBtn.hidden = false;
      saveBtn.textContent = truncated ? COPY.saveWhole : COPY.saveShort;
      sharePanel.dataset.save = 'idle';
      delete sharePanel.dataset.saveError;
      delete sharePanel.dataset.rid;
      const gen = ++shareGen;
      void encodeFragment(r).then(
        (fragment) => {
          if (gen !== shareGen) return;
          if (fragment.length > MAX_FRAGMENT_CHARS) {
            fallback = 'none';
            shareMsg.textContent = COPY.tooBigSave;
            saveBtn.textContent = COPY.saveWhole;
            return;
          }
          shareInput.value = shareUrl(location, fragment);
          sharePanel.dataset.chars = String(fragment.length);
          copyBtn.disabled = false;
          shareInput.focus({ preventScroll: true });
          shareInput.select();
        },
        () => {
          if (gen !== shareGen) return;
          fallback = 'none';
          shareMsg.textContent = COPY.tooBigSave;
        },
      );
    };
    shareBtn.addEventListener('click', share);

    // --- saving (12-05): the check loads only now; nothing about the visitor is sent, only the run
    const saveFailed = (code: keyof typeof SAVE_ERROR) => {
      endChallenge();
      const e = SAVE_ERROR[code];
      sharePanel.dataset.save = 'error';
      sharePanel.dataset.saveError = code;
      shareMsg.textContent = [e.text, FALLBACK[fallback]].filter(Boolean).join(' ');
      saveBtn.textContent = COPY.saveRetry;
      saveBtn.hidden = !e.retry;
      (e.retry ? saveBtn : shareInput.value ? shareInput : sharePanel).focus({ preventScroll: true });
    };
    const save = () => {
      const d = drive();
      if (!d || sharePanel.hidden) return;
      const siteKey = siteKeyFor(location);
      if (!siteKey) return saveFailed('disabled');
      const gen = ++saveGen;
      endChallenge();
      saveBtn.hidden = true;
      sharePanel.focus({ preventScroll: true }); // the button that had focus is gone
      sharePanel.dataset.save = 'checking';
      delete sharePanel.dataset.saveError;
      sharePanel.dataset.saveCrc = hex(d.stateChecksum());
      shareMsg.textContent = COPY.checking;
      void saveSpan(d).then((span) => {
        if (gen !== saveGen) return;
        if (!span) return saveFailed(detectPlatform().compress ? 'too_large' : 'unsupported');
        sharePanel.dataset.saveTicks = String(span.replay.header.ticks);
        if (span.minutes) shareMsg.textContent = savingPart(span.minutes);
        savePrivacy.hidden = false;
        widgetHost.hidden = false;
        widget = challenge(widgetHost, siteKey, (o) => {
          if (gen !== saveGen) return;
          if ('error' in o) return saveFailed(o.error);
          sharePanel.dataset.save = 'saving';
          shareMsg.textContent = COPY.saving;
          void saveReplay(o.token, span.data).then((res) => {
            if (gen !== saveGen) return;
            if ('error' in res) return saveFailed(res.error);
            endChallenge();
            sharePanel.dataset.save = 'saved';
            sharePanel.dataset.rid = res.id;
            shareInput.value = savedUrl(location, res.id);
            copyBtn.disabled = false;
            shareMsg.textContent = span.minutes ? savedPart(span.minutes) : COPY.saved;
            shareInput.focus({ preventScroll: true });
            shareInput.select();
          });
        });
      });
    };
    saveBtn.addEventListener('click', save);
    copyBtn.addEventListener('click', () => {
      const url = shareInput.value;
      if (!url) return;
      const manual = () => {
        shareInput.focus();
        shareInput.select();
        shareMsg.textContent = COPY.copyManually;
      };
      if (!navigator.clipboard?.writeText) return manual();
      navigator.clipboard.writeText(url).then(() => (shareMsg.textContent = COPY.copied), manual);
    });
    const onEscape = (e: KeyboardEvent) => e.key === 'Escape' && !sharePanel.hidden && closeShare();
    window.addEventListener('keydown', onEscape);
    c.addDisposer(() => window.removeEventListener('keydown', onEscape));

    driveBtn.addEventListener('click', () => {
      if (mode() === 'replay') bus.emit('drive:request', { mode: 'manual' });
    });

    // --- opening a link (#r= decoded here, #rid= fetched first): play once frames run and the simulation can take it
    let loadGen = 0;
    const openHash = () => {
      const id = ridOf(location.hash);
      if (id !== null) {
        const gen = ++loadGen;
        showNote(COPY.fetching, 30);
        void loadSaved(id).then((res) => {
          if (gen !== loadGen) return;
          if ('error' in res) return showNote(loadMessage(res.error), 10);
          noteS = 0;
          note.hidden = true;
          pendingLink = res.replay;
        });
        return;
      }
      const fragment = fragmentOf(location.hash);
      if (fragment === null) return;
      void decodeFragment(fragment).then((res) => {
        if ('error' in res) showNote(LINK_ERROR[res.error], 10);
        else pendingLink = res.replay;
      });
    };
    openHash();
    window.addEventListener('hashchange', openHash);
    c.addDisposer(() => window.removeEventListener('hashchange', openHash));
    const playLink = (r: DecodedReplay) => {
      const d = drive();
      if (!d || !d.available) return showNote(REFUSAL.unavailable, 10);
      const fit = d.check(r);
      if (!fit.ok) return showNote(REFUSAL[fit.reason], 10);
      bus.emit('drive:play', { replay: r });
      if (d.replay?.replay !== r) return showNote(REFUSAL.state, 10);
      shared = r;
      moment = null;
    };

    c.on('drive:event', (e) => {
      if (offers(e)) offerS = OFFER_S;
    });
    c.on('drive:mode', ({ mode: next, previous }) => {
      if (next === 'replay') return;
      if (previous === 'replay') {
        const d = drive();
        const ended = d?.replay?.state === 'ended';
        if (moment) {
          if (store.get().timeScale === MOMENT_TIME_SCALE) store.setKey('timeScale', 1);
          if (ended && next === 'manual') showNote(COPY.back, 3);
        } else if (shared && ended && next === 'manual') showNote(COPY.yourTurn);
        if (d?.replay && ended) root.dataset.endCrc = hex(d.replay.endChecksum);
        moment = null;
        shared = null;
      }
      if (next !== 'manual') closeShare();
    });

    frameHandler = ({ dt, t }) => {
      const m = mode();
      const st = store.get();
      if (pendingLink && m !== 'replay') {
        const r = pendingLink;
        pendingLink = null;
        playLink(r);
      }
      if (noteS > 0) {
        noteS -= dt;
        if (noteS <= 0) note.hidden = true;
      }
      if (offerS > 0) offerS -= dt;
      const d = drive();
      const recorded = m === 'manual' && d !== undefined && d.recordedTicks >= MIN_RECORDED_S * 240;
      const playing = m === 'replay' && d?.replay != null;
      const visible = !st.attract && st.hudVisible && (recorded || playing || noteS > 0 || !sharePanel.hidden);
      if (visible !== shown.visible) root.hidden = !(shown.visible = visible);
      const row = playing ? 'play' : recorded ? 'record' : '';
      if (row !== shown.row) {
        shown.row = row;
        recRow.hidden = row !== 'record';
        playRow.hidden = row !== 'play';
        root.dataset.state = row;
        if (playing) root.dataset.ticks = String(d!.replay!.ticks);
      }
      const offered = recorded && offerS > 0;
      if (offered !== shown.offered) momentBtn.classList.toggle('is-offered', (shown.offered = offered));
      if (playing) {
        const s = d!.replay!;
        const label = s.moment ? COPY.replay : COPY.shared;
        if (label !== shown.label) playLabel.textContent = shown.label = label;
        const slow = st.timeScale < 1;
        if (slow !== shown.slow) slowTag.hidden = !(shown.slow = slow);
        root.dataset.tick = String(s.tick); // e2e: step a paused page to the exact last tick
        const p = Math.round((1000 * s.tick) / s.ticks) / 10;
        if (p !== shown.progress) {
          shown.progress = p;
          bar.style.transform = `scaleX(${p / 100})`;
          progress.setAttribute('aria-valuenow', String(Math.round(p)));
        }
        const line = statusNote(s);
        if (line !== shown.status) {
          shown.status = line;
          if (line) showNote(line, PINNED);
          else if (noteS > PINNED / 2) {
            noteS = 0;
            note.hidden = true;
          }
        }
        // the store follows the replay's suspension and aids (the kernel then finds nothing to change)
        if (st.suspensionId !== t.suspensionId) store.setKey('suspensionId', t.suspensionId);
        if (!sameAids(st.driveAids, t.drive.aids)) store.setKey('driveAids', { ...t.drive.aids });
      } else if (shown.status) {
        shown.status = null;
        if (noteS > PINNED / 2) noteS = 2; // the honesty line lingers briefly after the replay
      }
    };
    c.addDisposer(() => (frameHandler = undefined));
  },

  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
