/**
 * Manual Drive (plans 08-03, 09-05, 10-04; ARCHITECTURE-M2 §9, §10.1-10.4; research m2/07, m2/18, m2/22): the DRIVE
 * service (sources, arbiter, takeover edges) with the keyboard, gamepad and touch sources; the AUTO | MANUAL pill (speed
 * and gear while driving, aids popover and lamps, the stations list, the Returning chip); the hint line (takeover
 * prompt, control hint, station note, idle cue); hand-back (Returning on the loop, a faded release from the annex), the
 * fade over every cut, out-of-bounds recovery, R / pad Y reset, subtle gamepad rumble. Mode changes go through the bus
 * ('drive:request' / 'drive:reset'); the kernel mirrors the simulation's mode into store.driveMode.
 */
import { neutralIntent, type DriveMode } from '../../contracts/drive';
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { DRIVE } from '../../contracts/services';
import type { Frenet, StationDefinition, WorldDefinition } from '../../contracts/world';
import type { DriveHost } from '../../sim-core/drive/control';
import { h, mount } from '../../ui/dom';
import { kmh } from '../../ui/format';
import { createArbiter } from './arbiter';
import { canRumble, createGamepadSource, type PadLike } from './gamepad';
import { FADE, fadeOpacity, handBackKind, nearestSpawn, returningLabel } from './handback';
import { idleState, noteFault, promptVisible, TIMING, type IdleState } from './idle';
import { AID_COPY, AID_KEYS, aidsSummary, HUD_ICON, LAMP_TEXT, LAMP_TITLE, LAMPS, updateLamps, withAid } from './hud';
import { createKeyboardSource } from './keyboard';
import { gearLabel, isDriving } from './keys';
import { createRumble, createRumbleState, rumbleLevels } from './rumble';
import { createTouchSource } from './touch';
import './drive.css';

type HintKind = 'none' | 'prompt' | 'controls' | 'pad' | 'station' | 'note' | 'cue';

const MODE_LABEL: Readonly<Record<DriveMode, string>> = { auto: 'Otomatik', manual: 'Manuel', returning: 'Dönülüyor', replay: 'Tekrar' };
const ANNOUNCE: Readonly<Record<DriveMode, string>> = {
  auto: 'Otomatik. Araç turu kendi sürüyor.',
  manual: 'Manuel. Kontrol sizde. Enter otomatik sürüşe bırakır.',
  returning: 'Tura dönülüyor. Herhangi bir sürüş tuşuyla kontrolü geri alabilirsiniz.',
  replay: 'Tekrar.',
};
/** How long a station's note and a short note (controller, back on the road) stay, s. */
const STATION_NOTE_S = 9;
const NOTE_S = 3;

const kbd = (...keys: string[]) => keys.map((k) => h('kbd', { class: 'sl-drive-kbd' }, k));
const icon = (id: keyof typeof HUD_ICON) => {
  const el = h('span', { class: 'sl-drive-icon', 'aria-hidden': 'true' });
  el.innerHTML = HUD_ICON[id];
  return el;
};
const group = (keys: string[], label: string) => h('span', { class: 'sl-drive-hint-group' }, ...kbd(...keys), label);

let frameHandler: ((frame: FrameInfo) => void) | undefined;

export default {
  id: 'drive',
  requires: [],
  phase: 'overlay',

  init(c) {
    const { store, bus } = c;
    const mode = () => store.get().driveMode;
    const available = () => c.sim.current.drive?.available === true;
    const worldDef = (): WorldDefinition | null => c.sim.current.world?.def ?? null;
    const stations = (): readonly StationDefinition[] => worldDef()?.stations ?? [];

    const arbiter = createArbiter();
    c.services.provide(DRIVE, {
      addSource: (source) => arbiter.add(source),
      get activeSource() {
        return arbiter.active;
      },
    });

    // --- DOM: hint line above the pill, the pill, popovers, the fade, touch controls, a polite live region
    const hintPrompt = h(
      'span',
      { class: 'sl-drive-hint-row', 'data-kind': 'prompt' },
      h('span', { class: 'sl-drive-fine' }, 'Basın: ', ...kbd('W'), ' veya ', ...kbd('↑'), ' · direksiyona geçin'),
      h('span', { class: 'sl-drive-padtext' }, 'Basın: ', ...kbd('A'), ' veya direksiyona geçmek için oyun çubuğunu hareket ettirin'),
      h('span', { class: 'sl-drive-coarse' }, 'Sürmek için Manuel seçeneğine dokunun'),
    );
    const hintControls = h(
      'span',
      { class: 'sl-drive-hint-row', 'data-kind': 'controls' },
      h('span', { class: 'sl-drive-hint-group' }, ...kbd('W', 'A', 'S', 'D'), h('span', { class: 'sl-drive-hint-or' }, 'veya ok tuşları'), 'Sür'),
      group(['R'], 'Sıfırla'),
      group(['Enter'], 'Kontrolü bırak'),
    );
    const hintPad = h('span', { class: 'sl-drive-hint-row', 'data-kind': 'pad' }, group(['Çubuk'], 'Yön ver'), group(['RT', 'LT'], 'Gaz, fren'), group(['Y'], 'Sıfırla'), group(['A'], 'Kontrolü bırak'));
    const stationName = h('span', { class: 'sl-drive-station-name' });
    const stationText = h('span', { class: 'sl-drive-station-text' });
    const hintStation = h('span', { class: 'sl-drive-hint-row', 'data-kind': 'station' }, stationName, stationText);
    const noteText = h('span');
    const hintNote = h('span', { class: 'sl-drive-hint-row', 'data-kind': 'note' }, noteText);
    const cueCount = h('span', { class: 'sl-drive-cue-count' });
    const hintCue = h('span', { class: 'sl-drive-hint-row', 'data-kind': 'cue' }, 'Otomatik sürüşe kalan: ', cueCount, h('span', { class: 'sl-drive-hint-or' }, '· herhangi bir tuşa basın'));
    const hint = h('div', { class: 'sl-drive-hint', 'aria-hidden': 'true' }, hintPrompt, hintControls, hintPad, hintStation, hintNote, hintCue);

    const autoLabel = h('span', { class: 'sl-drive-seg-label' }, 'Otomatik');
    const segAuto = h('span', { class: 'sl-drive-seg', 'data-mode': 'auto' }, h('span', { class: 'sl-drive-dot', 'aria-hidden': 'true' }), autoLabel, ...kbd('Enter'));
    const segManual = h('span', { class: 'sl-drive-seg', 'data-mode': 'manual' }, h('span', { class: 'sl-drive-dot', 'aria-hidden': 'true' }), 'Manuel', ...kbd('W'));
    const toggle = h(
      'button',
      { type: 'button', class: 'sl-drive-toggle', 'aria-keyshortcuts': 'Enter' },
      h('span', { class: 'sl-drive-thumb', 'aria-hidden': 'true' }),
      segAuto,
      segManual,
    );
    const speed = h('span', { class: 'sl-drive-speed' });
    const gear = h('span', { class: 'sl-drive-gear' });
    const readout = h('span', { class: 'sl-drive-readout', 'aria-hidden': 'true' }, speed, h('span', { class: 'sl-drive-unit' }, 'km/h'), gear);
    const note = h('span', { class: 'sl-drive-note' }, 'Bu araçta yalnızca otomatik sürüş var');

    // Returning (10-04): the autopilot is bringing the car back; "Rejoin now" releases at once (a faded cut)
    const returnText = h('span', { class: 'sl-drive-return-text' }, 'Sürüş çizgisi aranıyor…');
    const rejoinBtn = h('button', { type: 'button', class: 'sl-drive-rejoin', title: 'Canlı tura hemen dön' }, 'Şimdi dön');
    const returnChip = h('span', { class: 'sl-drive-return' }, h('span', { class: 'sl-drive-return-dot', 'aria-hidden': 'true' }), returnText, rejoinBtn);

    // handling HUD (09-05), Manual only: aid lamps + the Approximate badge in the pill (icon + text, shown only while
    // lit: presence, never colour alone), and the Assists button with its popover of four switches.
    const lampEls = LAMPS.map((id) => h('span', { class: 'sl-drive-lamp', 'data-lamp': id, title: LAMP_TITLE[id], hidden: true }, icon(id), h('span', { class: 'sl-drive-lamp-text' }, LAMP_TEXT[id])));
    const lamps = h('span', { class: 'sl-drive-lamps' }, ...lampEls);
    const aidsTag = h('span', { class: 'sl-drive-aids-tag' });
    const aidsBtn = h(
      'button',
      { type: 'button', class: 'sl-drive-aids-btn', title: 'Sürüş destekleri', 'aria-expanded': 'false', 'aria-controls': 'sl-drive-aids-panel' },
      icon('assists'),
      aidsTag,
    );
    const switches = AID_KEYS.map((key) =>
      h('input', { type: 'checkbox', role: 'switch', class: 'sl-drive-switch', 'aria-labelledby': `sl-drive-aid-${key}`, 'aria-describedby': `sl-drive-aid-${key}-hint` }),
    );
    const switchRow = (id: string, name: string, hintText: string, input: HTMLInputElement) =>
      h(
        'label',
        { class: 'sl-drive-aid' },
        h('span', { class: 'sl-drive-aid-text' }, h('span', { id, class: 'sl-drive-aid-name' }, name), h('span', { id: `${id}-hint`, class: 'sl-drive-aid-hint' }, hintText)),
        input,
      );
    // rumble toggle: only while a pad that can rumble is connected
    const rumbleSwitch = h('input', { type: 'checkbox', role: 'switch', class: 'sl-drive-switch', 'aria-labelledby': 'sl-drive-rumble', 'aria-describedby': 'sl-drive-rumble-hint' });
    rumbleSwitch.checked = true;
    const rumbleRow = switchRow('sl-drive-rumble', 'Oyun kumandası titreşimi', 'Bordürlerde, tümseklerde ve tutunma sınırında hafif titreşim', rumbleSwitch);
    rumbleRow.hidden = true;
    const aidsPanel = h(
      'div',
      { id: 'sl-drive-aids-panel', class: 'sl-drive-aids-panel sl-drive-panel', role: 'group', 'aria-labelledby': 'sl-drive-aids-title', hidden: true },
      h('div', { class: 'sl-drive-aids-head' }, h('span', { id: 'sl-drive-aids-title', class: 'sl-drive-aids-title' }, 'Sürüş destekleri'), h('span', { class: 'sl-drive-aids-model' }, 'Destek: basitleştirilmiş model')),
      ...AID_KEYS.map((key, i) => switchRow(`sl-drive-aid-${key}`, AID_COPY[key].name, AID_COPY[key].hint, switches[i]!)),
      rumbleRow,
    );

    // stations (10-04): experiments on the proving ground, never challenges (copy from the world content)
    const stationsLabel = h('span', { class: 'sl-drive-stations-label' }, 'Deney noktaları');
    const stationsBtn = h(
      'button',
      { type: 'button', class: 'sl-drive-stations-btn', 'aria-expanded': 'false', 'aria-controls': 'sl-drive-stations-panel', hidden: true },
      icon('stations'),
      stationsLabel,
    );
    const stationsTitle = h('span', { id: 'sl-drive-stations-title', class: 'sl-drive-aids-title' });
    const stationsSub = h('span', { class: 'sl-drive-aids-model' });
    const stationList = h('div', { class: 'sl-drive-station-list' });
    const stationsPanel = h(
      'div',
      { id: 'sl-drive-stations-panel', class: 'sl-drive-stations-panel sl-drive-panel', role: 'group', 'aria-labelledby': 'sl-drive-stations-title', hidden: true },
      h('div', { class: 'sl-drive-aids-head' }, stationsTitle, stationsSub),
      stationList,
    );

    const pill = h('div', { class: 'sl-drive-pill' }, toggle, readout, returnChip, lamps, stationsBtn, aidsBtn, note);
    // 11-05: the shared action row (other features' `.sl-drive-action` chips: Grip rings, Replay, Compare): chips
    // mounted on the overlay are adopted into it (and handed back on dispose); drive.css places the row
    const actions = h('div', { class: 'sl-drive-actions' });
    const root = h('div', { class: 'sl-drive' }, hint, pill, aidsPanel, stationsPanel);
    const fade = h('div', { class: 'sl-drive-fade', 'aria-hidden': 'true' });
    const announce = h('div', { class: 'sl-visually-hidden', 'aria-live': 'polite' });
    c.dom.overlay.prepend(fade); // under the HUD: the pill stays readable through a fade
    c.addDisposer(() => fade.remove());
    c.addDisposer(mount(c.dom.overlay, root));
    c.addDisposer(mount(c.dom.overlay, actions));
    c.addDisposer(mount(c.dom.overlay, announce));
    const overlay = c.dom.overlay;
    const adopt = (n: Node) => {
      if (n instanceof HTMLElement && n.parentElement === overlay && n.classList.contains('sl-drive-action')) actions.append(n);
    };
    for (const el of [...overlay.children]) adopt(el);
    const adopter = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach(adopt);
    });
    adopter.observe(overlay, { childList: true });
    c.addDisposer(() => {
      adopter.disconnect();
      for (const el of [...actions.children]) overlay.append(el);
    });
    const say = (text: string) => {
      if (announce.textContent !== text) announce.textContent = text;
    };

    // --- state
    const intent = neutralIntent();
    const idle: IdleState = { countdown: 0, handBack: false };
    let idleS = 0;
    let autoS = 0;
    let controlsS = 0;
    let stationS = 0;
    let noteS = 0;
    let now = 0;
    const shown = { mode: '' as DriveMode | '', available: null as boolean | null, hint: 'none' as HintKind, countdown: -1, kmh: -1, gear: Number.NaN, lamps: 0, stations: -1, returning: '' };
    const lampHold = new Float64Array(LAMPS.length);
    const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };

    // --- fade (0.35 s over every cut; reduced motion: none, the cut stays a cut)
    let fadeT = -1;
    let fadeOut = false;
    let fadeAction: (() => void) | null = null;
    /** With an action: fade out, run it, fade in. Without: the cut already happened, fade in from dark. */
    const fadeThen = (action?: () => void) => {
      if (store.get().reducedMotion) return action?.();
      if (action) {
        if (fadeAction) return; // one at a time
        fadeAction = action;
        fadeOut = true;
        fadeT = 0;
      } else if (fadeT < 0) {
        fadeOut = false;
        fadeT = 0;
      }
    };

    const showNote = (text: string, seconds = NOTE_S) => {
      noteText.textContent = text;
      noteS = seconds;
    };

    const refuse = () => {
      note.classList.remove('is-pulse');
      void note.offsetWidth; // restart the pulse
      note.classList.add('is-pulse');
      say('Bu araçta manuel sürüş kullanılamıyor.');
    };
    const takeOver = () => {
      if (!available()) return refuse();
      bus.emit('drive:request', { mode: 'manual' });
    };
    const unpause = () => {
      if (store.get().paused) store.setKey('paused', false);
    };
    const release = () => bus.emit('drive:request', { mode: 'auto', immediate: true });
    /** Auto on the detached clock a drive left behind (MD-07): "Off the live lap" + Rejoin now; idle re-syncs. */
    const offLap = () => mode() === 'auto' && c.sim.frame.drive.detached;
    /** Simulation times of the latest automatic state restores (plant faults), for the "Reset to road" rule (MD-18). */
    const faultTimes: number[] = [];
    let annexOf: WorldDefinition | null = null;
    let annex: ReadonlySet<string> = new Set();
    const annexZones = () => {
      const def = worldDef();
      if (def !== annexOf) {
        annexOf = def;
        annex = new Set(def ? [...def.zones.map((z) => z.id), 'field'] : []);
      }
      return annex;
    };
    /** Enter / the pill / the idle timer / pad A in Manual: Returning on the loop, a faded release from the annex. */
    const handBack = () => {
      idleS = 0;
      unpause();
      if (mode() !== 'manual') return;
      const d = c.sim.frame.drive;
      if (handBackKind(d.zone, d.lineOffset, annexZones()) === 'return') bus.emit('drive:request', { mode: 'auto' });
      else {
        showNote('Tura dönülüyor');
        say('Tura dönülüyor.');
        fadeThen(release);
      }
    };
    const toggleMode = () => (isDriving(mode()) ? handBack() : takeOver());
    const reset = () => {
      if (isDriving(mode())) bus.emit('drive:reset', {});
    };
    const onInput = () => {
      idleS = 0;
      if (isDriving(mode())) unpause(); // a driving input while paused unpauses (§10.1)
    };

    const keyboard = createKeyboardSource(mode, (command) => {
      idleS = 0;
      if (command === 'toggle') toggleMode();
      else if (command === 'reset') reset();
      else onInput();
    });
    c.addDisposer(() => keyboard.dispose());
    c.addDisposer(arbiter.add(keyboard));

    // gamepad (standard mapping) and rumble
    let pad: PadLike | null = null;
    const rumble = createRumble();
    const rumbleSt = createRumbleState();
    const levels = { weak: 0, strong: 0 };
    const gamepad = createGamepadSource(
      (command) => {
        idleS = 0;
        if (command === 'toggle') toggleMode();
        else if (command === 'reset') reset();
        else onInput();
      },
      (next) => {
        if (pad && !next) rumble.stop(pad);
        const was = pad;
        pad = next;
        rumbleRow.hidden = !canRumble(next);
        root.classList.toggle('has-pad', next !== null);
        if (next && !was) {
          showNote('Oyun kumandası bağlandı');
          say('Oyun kumandası bağlandı.');
        } else if (!next && was) {
          showNote('Oyun kumandasının bağlantısı kesildi');
          say('Oyun kumandasının bağlantısı kesildi. Klavyeyle sürmeye devam edebilirsiniz.');
        }
      },
    );
    c.addDisposer(arbiter.add(gamepad));
    rumbleSwitch.addEventListener('change', () => {
      if (!rumbleSwitch.checked) rumble.stop(pad);
    });

    // touch (coarse pointers, Manual)
    const touch = createTouchSource(onInput);
    c.addDisposer(mount(c.dom.overlay, touch.el));
    c.addDisposer(() => touch.dispose());
    c.addDisposer(arbiter.add(touch));
    const coarseQuery = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    let coarse = coarseQuery?.matches === true;
    const onCoarse = (e: MediaQueryListEvent) => (coarse = e.matches);
    coarseQuery?.addEventListener?.('change', onCoarse);
    c.addDisposer(() => coarseQuery?.removeEventListener?.('change', onCoarse));

    toggle.addEventListener('click', (e) => {
      if (e.detail > 0) toggle.blur(); // pointer click: keep Space/Enter for the scene
      toggleMode();
    });
    rejoinBtn.addEventListener('click', (e) => {
      if (e.detail > 0) rejoinBtn.blur();
      if (mode() !== 'returning' && !offLap()) return;
      fadeThen(release);
    });

    // Popovers (Assists, Stations): disclosures; one open at a time; Escape or a click elsewhere closes them. A pointer
    // toggle gives focus back to the page so the driving keys keep working (a focused control would swallow them).
    const panels = [
      { panel: aidsPanel, btn: aidsBtn },
      { panel: stationsPanel, btn: stationsBtn },
    ];
    const setOpen = (which: HTMLElement, open: boolean, focusButton = false) => {
      for (const { panel, btn } of panels) {
        if (!open && panel !== which) continue; // closing one leaves the other alone; opening one closes the other
        const want = panel === which && open;
        if (want === !panel.hidden) continue;
        panel.hidden = !want;
        btn.setAttribute('aria-expanded', String(want));
        btn.classList.toggle('is-open', want);
        if (panel === which && focusButton) btn.focus();
      }
    };
    const closeAll = () => panels.forEach(({ panel }) => setOpen(panel, false));
    for (const { panel, btn } of panels) {
      btn.addEventListener('click', (e) => {
        if (e.detail > 0) btn.blur();
        if (panel === stationsPanel) renderStations();
        setOpen(panel, panel.hidden);
      });
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || panel.hidden) return;
        e.preventDefault(); // controls' Escape (and anything else) leaves it alone
        setOpen(panel, false, true);
      };
      panel.addEventListener('keydown', onKey);
      btn.addEventListener('keydown', onKey);
    }
    // Escape with the focus elsewhere (a pointer opened it) still closes an open popover
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      for (const { panel } of panels) {
        if (panel.hidden) continue;
        e.preventDefault();
        setOpen(panel, false);
      }
    };
    window.addEventListener('keydown', onEscape);
    c.addDisposer(() => window.removeEventListener('keydown', onEscape));
    let pointerToggle = false;
    aidsPanel.addEventListener('pointerdown', () => (pointerToggle = true));
    aidsPanel.addEventListener('keydown', () => (pointerToggle = false));
    switches.forEach((input, i) =>
      input.addEventListener('change', () => {
        store.setKey('driveAids', withAid(store.get().driveAids, AID_KEYS[i]!, input.checked));
        if (pointerToggle) input.blur();
      }),
    );
    rumbleSwitch.addEventListener('change', () => pointerToggle && rumbleSwitch.blur());
    const onOutside = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      for (const { panel, btn } of panels) if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) setOpen(panel, false);
    };
    window.addEventListener('pointerdown', onOutside, true);
    c.addDisposer(() => window.removeEventListener('pointerdown', onOutside, true));

    // the stations list, rebuilt on open (the world comes with the track)
    const goStation = (st: StationDefinition, viaKeyboard: boolean) => {
      closeAll();
      if (!available()) return refuse();
      if (viaKeyboard) toggle.focus();
      stationName.textContent = st.name;
      stationText.textContent = st.caption;
      stationS = STATION_NOTE_S;
      noteS = 0;
      say(`${st.name}. ${st.experiment}`);
      fadeThen(() => {
        if (!isDriving(mode())) bus.emit('drive:request', { mode: 'manual' });
        bus.emit('drive:reset', { spawn: st.id });
        unpause();
      });
    };
    let listOf: readonly StationDefinition[] | null = null;
    const renderStations = () => {
      const auto = !isDriving(mode());
      stationsTitle.textContent = auto ? 'Test alanında sür' : 'Deney noktaları';
      stationsSub.textContent = auto ? 'Denemek için bir yer seçin' : 'Bir deney noktasına sürün';
      const list = stations();
      if (list === listOf) return;
      listOf = list;
      stationList.replaceChildren(
        ...list.map((st) => {
          const b = h(
            'button',
            { type: 'button', class: 'sl-drive-station', 'data-station': st.id },
            h('span', { class: 'sl-drive-station-row' }, h('span', { class: 'sl-drive-aid-name' }, st.name), st.suspension ? null : h('span', { class: 'sl-drive-station-tag' }, 'Lastik tutunması deneyi')),
            h('span', { class: 'sl-drive-aid-hint' }, st.experiment),
          );
          b.addEventListener('click', (e) => goStation(st, e.detail === 0));
          return b;
        }),
      );
    };

    const onPointer = () => (idleS = 0);
    for (const type of ['pointerdown', 'wheel'] as const) {
      window.addEventListener(type, onPointer, { passive: true });
      c.addDisposer(() => window.removeEventListener(type, onPointer));
    }
    const onBlur = () => rumble.stop(pad);
    window.addEventListener('blur', onBlur);
    c.addDisposer(() => window.removeEventListener('blur', onBlur));
    c.addDisposer(() => rumble.stop(pad));

    c.on('drive:mode', ({ mode: next, previous }) => {
      if (isDriving(previous) && !isDriving(next)) {
        arbiter.disarm(); // an input still held after the hand-back must be released before it can take over again
        autoS = 0;
        touch.release();
        rumble.stop(pad);
      }
      if (isDriving(next)) {
        controlsS = TIMING.controlsFor;
        idleS = 0;
      }
      say(ANNOUNCE[next]);
    });
    c.on('drive:event', (e) => {
      if (e.kind === 'mode' && e.cut && e.mode === 'auto' && e.previous !== 'auto') fadeThen();
      else if (e.kind === 'reset') fadeThen();
      else if (e.kind === 'out-of-bounds') {
        const m = mode();
        if (m === 'returning') return fadeThen(release);
        if (m !== 'manual') return;
        const d = c.sim.frame.drive;
        const world = c.sim.current.world;
        const loopDistance = world ? Math.abs(world.project(d.x, d.y, NaN, fr).l) : Number.NaN;
        const spawn = nearestSpawn(d.x, d.y, loopDistance, stations());
        showNote('Test alanına geri dönüldü');
        say('Alan dışına çıktınız. Test alanına geri dönüldü.');
        fadeThen(() => bus.emit('drive:reset', spawn ? { spawn } : {}));
      } else if (e.kind === 'fault') {
        // the plant restored its last good state; repeated restores mean the car cannot settle: put it on the road
        if (!noteFault(faultTimes, e.simTime) || mode() !== 'manual') return;
        showNote('Yola geri dönüldü');
        say('Model kararlı hale gelemedi. Yola geri dönüldü.');
        fadeThen(() => bus.emit('drive:reset', {}));
      }
    });
    c.watch((s) => {
      root.classList.toggle('is-hidden', s.attract || !s.hudVisible);
      root.classList.toggle('is-attract', s.attract);
      if (s.attract || !s.hudVisible) closeAll();
      const aids = s.driveAids;
      switches.forEach((input, i) => (input.checked = aids[AID_KEYS[i]!]));
      const sum = aidsSummary(aids);
      aidsTag.textContent = sum.tag;
      aidsTag.hidden = sum.tag === '';
      aidsBtn.setAttribute('aria-label', sum.label);
    });

    const setHint = (kind: HintKind) => {
      if (kind === shown.hint) return;
      shown.hint = kind;
      hint.dataset.kind = kind;
      hint.classList.toggle('is-shown', kind !== 'none');
      root.classList.toggle('has-hint', kind !== 'none');
      root.classList.toggle('has-tall-hint', kind === 'station');
    };

    frameHandler = ({ dt, time, t }) => {
      now = time;
      const m = mode();
      const driving = isDriving(m);
      const can = available();

      const r = arbiter.update(time, intent);
      if (r.deliberate) idleS = 0;
      if (r.fresh && !driving) takeOver();
      if (driving) c.sim.current.drive?.setIntent(intent);

      // fade
      if (fadeT >= 0) {
        fadeT += dt;
        if (fadeAction && fadeT >= FADE.out) {
          const action = fadeAction;
          fadeAction = null;
          action();
        }
        const op = fadeOpacity(fadeT, fadeOut);
        fade.style.opacity = op.toFixed(3);
        if (op === 0 && !fadeAction && fadeT > FADE.out) fadeT = -1;
      }

      // timers and the hint line (cue > note > station > controls > prompt)
      stationS = Math.max(0, stationS - dt);
      noteS = Math.max(0, noteS - dt);
      let kind: HintKind = 'none';
      if (driving) {
        // An open action popover is active use, including a verification iframe whose input stays in its frame.
        // Resume a full idle period after it closes rather than cutting off the visitor's pending action.
        idleS = actions.querySelector('[aria-expanded="true"]') ? 0 : idleS + dt;
        controlsS = Math.max(0, controlsS - dt);
        idleState(idleS, c.flags.screen, idle);
        if (idle.handBack) handBack();
        else if (idle.countdown > 0) kind = 'cue';
        else if (noteS > 0) kind = 'note';
        else if (stationS > 0) kind = 'station';
        else if (controlsS > 0) kind = arbiter.active === 'gamepad' ? 'pad' : arbiter.active === 'touch' ? 'none' : 'controls';
      } else {
        // off the live lap after a drive: 20 s without input re-syncs to the shared lap (a faded cut). Not in e2e mode
        // (like attract's idle start): specs step slowly in wall-clock time and must not be re-synced under them.
        idleS = offLap() && !store.get().paused ? idleS + dt : 0;
        if (idleS >= TIMING.rejoinAfter && !c.flags.e2e) {
          idleS = 0;
          showNote('Canlı tura dönülüyor');
          say('Canlı tura dönülüyor.');
          fadeThen(release);
        }
        if (m === 'auto') autoS += dt;
        if (noteS > 0) kind = 'note';
        else if (can && m === 'auto' && promptVisible(autoS)) kind = 'prompt';
      }
      setHint(kind);
      if (kind === 'cue' && idle.countdown !== shown.countdown) {
        if (shown.countdown <= 0) say(`${idle.countdown} saniye sonra otomatik sürüşe dönülecek. Sürmeye devam etmek için herhangi bir tuşa basın.`);
        shown.countdown = idle.countdown;
        cueCount.textContent = String(idle.countdown);
      } else if (kind !== 'cue') shown.countdown = 0;

      // pill
      if (m !== shown.mode || can !== shown.available) {
        shown.mode = m;
        shown.available = can;
        pill.dataset.mode = driving ? 'manual' : 'auto';
        root.classList.toggle('is-driving', driving);
        actions.classList.toggle('is-driving', driving);
        pill.classList.toggle('is-unavailable', !can && !driving);
        pill.classList.toggle('is-returning', m === 'returning');
        autoLabel.textContent = driving ? 'Otomatik' : MODE_LABEL[m];
        toggle.setAttribute('aria-pressed', String(driving));
        if (!can && !driving) {
          toggle.setAttribute('aria-disabled', 'true');
          toggle.setAttribute('aria-label', `Sürüş modu: ${MODE_LABEL[m]}. Bu araçta manuel sürüş kullanılamıyor`);
          toggle.title = 'Bu araçta yalnızca otomatik sürüş var';
        } else {
          toggle.removeAttribute('aria-disabled');
          toggle.setAttribute('aria-label', driving ? 'Sürüş modu: Manuel. Otomatik sürüşe bırak' : `Sürüş modu: ${MODE_LABEL[m]}. Direksiyona geç`);
          toggle.title = driving ? 'Otomatik sürüşe bırak (Enter)' : 'Direksiyona geç (W, ↑ veya Enter)';
        }
        if (!stationsPanel.hidden) renderStations();
      }
      const nStations = can && m !== 'returning' ? stations().length : 0;
      if (nStations !== shown.stations) {
        shown.stations = nStations;
        stationsBtn.hidden = nStations === 0;
        if (nStations === 0) setOpen(stationsPanel, false);
      }
      stationsBtn.setAttribute('aria-label', driving ? 'Deney noktaları: test alanındaki bir deneye sürün' : 'Test alanında sür: bir deney seçin');
      const off = offLap();
      pill.classList.toggle('is-off-lap', off);
      if (m === 'returning' || off) {
        const label = off ? 'Canlı turun dışında' : returningLabel((c.sim.current.drive as DriveHost | undefined)?.autopilot?.state);
        if (label !== shown.returning) returnText.textContent = shown.returning = label;
      }
      const lit = updateLamps(t.drive, driving, dt, lampHold);
      if (lit !== shown.lamps) {
        shown.lamps = lit;
        lampEls.forEach((el, i) => (el.hidden = (lit & (1 << i)) === 0));
        lamps.classList.toggle('is-lit', lit !== 0);
      }
      if (!driving) setOpen(aidsPanel, false);
      if (driving) {
        const d = t.drive;
        const v = Math.round(kmh(Math.hypot(d.u, d.v)));
        if (v !== shown.kmh) speed.textContent = String((shown.kmh = v));
        if (d.gear !== shown.gear) gear.textContent = gearLabel((shown.gear = d.gear));
      }

      // touch controls: coarse pointers while driving (also with the HUD hidden: they are the controls)
      const touchOn = coarse && driving && can && !store.get().attract;
      if (touch.el.hidden === touchOn) {
        touch.el.hidden = !touchOn;
        root.classList.toggle('has-touch', touchOn);
        if (!touchOn) touch.release();
      }

      // rumble: only while driving with the pad
      const rumbling = driving && rumbleSwitch.checked && pad !== null && arbiter.active === 'gamepad';
      rumbleLevels(t.corners, t.drive, rumbling, dt, rumbleSt, levels);
      if (rumbling) rumble.update(pad, levels.weak, levels.strong, now);
    };
    c.addDisposer(() => (frameHandler = undefined));
  },

  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
