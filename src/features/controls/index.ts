/**
 * HUD controls (plan 04-02, research 14 D5): vehicle tag, suspension + view segmented controls, vehicle-class
 * toggle, fullscreen, time controls (pause / slow motion / Live), the honest amplification chip, the UI-01
 * keyboard map with a shortcut card, and the loading overlay. Talks to the rest of the app through the store only.
 */
import type { FeatureContext, FeatureModule } from '../../contracts/app';
import { DRIVE } from '../../contracts/services';
import type { AppState } from '../../contracts/store';
import type { VehicleDefinition } from '../../contracts/vehicle';
import { h, mount } from '../../ui/dom';
import { installMessageLayout } from '../../ui/message-layout';
import './controls.css';
import { setIcon } from './icons';
import { amplificationText, keyAction, LIVE_PATCH, SLOW_MO, type KeyResult } from './keys';
import { assetFraction, bootAssetBytes, weightedProgress } from './loading';
import { createSegmented, type SegmentOption } from './segmented';

const VIEWS: readonly SegmentOption[] = [
  { id: 'follow', label: 'Takip', key: 'f' },
  { id: 'explore', label: 'Keşfet', key: 'e' },
  { id: 'closeup', label: 'Yakın plan', key: 'c' },
];

const LOADING_FADE_MS = 700;

const TAKEOVER_ROWS: [string[], string][] = [[['W', '↑'], 'Direksiyona geç (veya Enter)']];
const DRIVING_ROWS: [string[], string][] = [
  [['W', 'S'], 'Gaz · fren, geri vites'],
  [['A', 'D'], 'Yön ver (veya ok tuşları)'],
  [['R'], 'Yola geri dön'],
  [['Enter'], 'Otomatik sürüşe bırak'],
];

function otherClassVehicle(c: FeatureContext, current: VehicleDefinition | undefined): VehicleDefinition | undefined {
  return current && c.registries.vehicles.list().find((v) => v.class !== current.class);
}

function isTextInput(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select'));
}

/** Pointer clicks drop focus so Space stays "pause" (keyboard activation keeps focus as usual). */
function blurOnPointer(el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    if (e.detail > 0) (e.target as Element).closest('button')?.blur();
  });
}

function button(cls: string, label: string, ...children: (Node | string)[]): HTMLButtonElement {
  return h('button', { type: 'button', class: `sl-controls-btn ${cls}`, 'aria-label': label, title: label }, ...children);
}

/** Loading overlay: weighted progress (asset bytes, then first frame), fades on app:ready. */
function createLoading(c: FeatureContext): void {
  if (c.store.get().loading >= 1) return;
  const fill = h('span', { class: 'sl-controls-loading-fill' });
  const bar = h('div', { class: 'sl-controls-loading-bar', role: 'progressbar', 'aria-label': 'Yükleniyor', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, fill);
  const el = h(
    'div',
    { class: 'sl-controls-loading' },
    h('div', { class: 'sl-controls-loading-mark sl-label' }, 'Süspansiyon Laboratuvarı'),
    bar,
    h('div', { class: 'sl-controls-loading-note' }, 'Test alanı hazırlanıyor'),
  );
  const unmount = mount(c.dom.overlay, el);
  let shown = 0;
  const set = (p: number) => {
    if (p <= shown) return;
    shown = p;
    fill.style.transform = `scaleX(${p})`;
    bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  };

  const bytes = bootAssetBytes(c.assets.manifest);
  const fetched: string[] = [];
  let obs: PerformanceObserver | undefined;
  if (typeof PerformanceObserver === 'function') {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) fetched.push(e.name);
      set(weightedProgress(assetFraction(bytes, fetched), false));
    });
    obs.observe({ type: 'resource', buffered: true });
  }
  c.on('assets:progress', ({ loaded, total }) => set(weightedProgress(total > 0 ? loaded / total : 1, false)));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = () => {
    obs?.disconnect();
    obs = undefined;
    set(1);
    el.classList.add('is-done');
    timer = setTimeout(unmount, LOADING_FADE_MS);
  };
  c.on('app:ready', done);
  c.addDisposer(() => {
    obs?.disconnect();
    clearTimeout(timer);
    unmount();
  });
}

export default {
  id: 'controls',
  requires: [],
  phase: 'overlay',

  init(c) {
    createLoading(c);
    const set = (patch: Partial<AppState>) => {
      for (const [k, v] of Object.entries(patch)) (c.store.setKey as (k: keyof AppState, v: unknown) => void)(k as keyof AppState, v);
    };

    c.dom.stage.setAttribute('role', 'img');
    c.addDisposer(() => {
      c.dom.stage.removeAttribute('role');
      c.dom.stage.removeAttribute('aria-label');
    });

    // --- top-left: vehicle tag
    const name = h('div', { class: 'sl-controls-name' });
    const subtitle = h('span', {});
    const credits = h('button', { type: 'button', class: 'sl-controls-link', 'aria-label': 'Katkıda bulunanlar', 'aria-expanded': 'false' }, 'Katkıda bulunanlar');
    const tag = h(
      'header',
      { class: 'sl-controls-hud sl-controls-tag' },
      h('div', { class: 'sl-controls-wordmark sl-label' }, 'Süspansiyon Laboratuvarı'),
      name,
      h('div', { class: 'sl-controls-sub' }, subtitle, h('span', { class: 'sl-controls-dot', 'aria-hidden': 'true' }), credits),
    );
    credits.addEventListener('click', () => c.store.setKey('creditsOpen', !c.store.get().creditsOpen));

    // --- top-centre: amplification chip (never hidden while motion is amplified)
    const ampText = h('span', {});
    const ampOff = h('button', { type: 'button', class: 'sl-controls-amp-off' }, 'Gerçek ölçek');
    const amp = h('div', { class: 'sl-controls-amp', role: 'status', hidden: true }, h('span', { class: 'sl-controls-amp-dot', 'aria-hidden': 'true' }), ampText, ampOff);
    ampOff.addEventListener('click', () => c.store.setKey('amplification', 1));

    // --- top-right: time group + vehicle toggle + fullscreen + help
    const live = h('button', { type: 'button', class: 'sl-controls-live' }, h('span', { class: 'sl-controls-live-dot', 'aria-hidden': 'true' }), h('span', { class: 'sl-controls-live-text' }));
    const pause = button('sl-controls-pause', 'Duraklat');
    const slow = button('sl-controls-slow', 'Ağır çekim', h('span', { class: 'sl-controls-slow-text' }, `${SLOW_MO}×`));
    const vehicleBtn = button('sl-controls-vehicle', 'Aracı değiştir', h('span', { class: 'sl-controls-icon' }), h('span', { class: 'sl-controls-vehicle-text' }));
    setIcon(vehicleBtn.firstElementChild!, 'swap');
    const fullscreen = button('sl-controls-fullscreen', 'Tam ekran');
    const cameraBtn = button('sl-controls-camera-btn', 'Kamera seçimi', 'Kamera');
    cameraBtn.setAttribute('aria-expanded', 'false');
    cameraBtn.setAttribute('aria-controls', 'sl-controls-camera');
    const helpBtn = button('sl-controls-help-btn', 'Klavye kısayolları', '?');
    helpBtn.setAttribute('aria-expanded', 'false');
    helpBtn.setAttribute('aria-controls', 'sl-controls-help');
    const time = h('div', { class: 'sl-controls-group', role: 'group', 'aria-label': 'Zaman' }, live, pause, slow);
    const tools = h('div', { class: 'sl-controls-group', role: 'group', 'aria-label': 'Görünüm' }, vehicleBtn, cameraBtn, fullscreen, helpBtn);
    const topRight = h('div', { class: 'sl-controls-hud sl-controls-tr' }, time, tools);

    live.addEventListener('click', () => {
      const s = c.store.get();
      // While driving, "Rejoin live" releases the car straight back onto the shared lap (a cut, ARCH-M2 §9).
      if (s.driveMode !== 'auto') c.bus.emit('drive:request', { mode: 'auto', immediate: true });
      if (s.clock !== 'live' || s.paused || s.timeScale !== 1) set(LIVE_PATCH);
    });
    pause.addEventListener('click', () => c.store.setKey('paused', !c.store.get().paused));
    slow.addEventListener('click', () => set({ timeScale: c.store.get().timeScale === 1 ? SLOW_MO : 1 }));
    vehicleBtn.addEventListener('click', () => {
      const other = otherClassVehicle(c, c.registries.vehicles.get(c.store.get().vehicleId));
      if (other) c.store.setKey('vehicleId', other.id);
    });
    fullscreen.hidden = !document.fullscreenEnabled;
    fullscreen.addEventListener('click', () => {
      const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      p.catch(() => undefined); // denied (iframe, policy): nothing to do
    });
    const syncFullscreen = () => {
      const on = document.fullscreenElement !== null;
      setIcon(fullscreen, on ? 'exitFullscreen' : 'enterFullscreen');
      fullscreen.setAttribute('aria-label', on ? 'Tam ekrandan çık' : 'Tam ekran');
      fullscreen.title = on ? 'Tam ekrandan çık' : 'Tam ekran';
    };
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    c.addDisposer(() => document.removeEventListener('fullscreenchange', syncFullscreen));

    // --- shortcut card (rows are tappable actions)
    const help = h('section', { class: 'sl-controls-hud sl-controls-help', id: 'sl-controls-help', 'aria-label': 'Klavye kısayolları', hidden: true });
    const helpRows = h('div', { class: 'sl-controls-help-rows' });
    const helpCredits = h('button', { type: 'button', class: 'sl-controls-link' }, 'Katkıda bulunanlar');
    help.append(h('div', { class: 'sl-controls-help-title sl-label' }, 'Kısayollar'), helpRows, h('div', { class: 'sl-controls-help-foot' }, helpCredits));
    helpCredits.addEventListener('click', () => {
      help.hidden = true;
      c.store.setKey('creditsOpen', true);
    });
    const setHelp = (open: boolean) => {
      if (open) renderHelp();
      help.hidden = !open;
      helpBtn.setAttribute('aria-expanded', String(open));
    };
    helpBtn.addEventListener('click', () => setHelp(help.hidden));
    helpRows.addEventListener('click', (e) => {
      const key = (e.target as Element).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key !== undefined) apply(keyAction(key, c.store.get(), keyContext()));
    });

    // --- bottom: suspension (primary) and view
    const susp = createSegmented('Süspansiyon', 'sl-controls-susp', (id) => c.store.setKey('suspensionId', id));
    const descriptor = h('p', { class: 'sl-controls-descriptor' });
    const bottom = h('div', { class: 'sl-controls-hud sl-controls-bc' }, susp.el, descriptor);
    let cameraOpen = false;
    const setCameraOpen = (open: boolean) => {
      const restoreCameraFocus = cameraOpen && !open && viewWrap.contains(document.activeElement);
      cameraOpen = open;
      viewWrap.classList.toggle('is-mobile-open', open);
      cameraBtn.setAttribute('aria-expanded', String(open));
      if (restoreCameraFocus) cameraBtn.focus();
    };
    const view = createSegmented('Kamera', 'sl-controls-view', (id) => {
      if (id === 'follow' || id === 'explore' || id === 'closeup') c.store.setKey('view', id);
      setCameraOpen(false);
    });
    view.setOptions(VIEWS);
    const viewWrap = h('div', { class: 'sl-controls-hud sl-controls-br', id: 'sl-controls-camera' }, view.el);
    cameraBtn.addEventListener('click', () => setCameraOpen(!cameraOpen));

    // --- HUD hidden: one quiet way back for touch users
    const restore = h('button', { type: 'button', class: 'sl-controls-restore', hidden: true }, 'Kontrolleri göster');
    restore.addEventListener('click', () => c.store.setKey('hudVisible', true));

    const announce = h('div', { class: 'sl-visually-hidden', 'aria-live': 'polite' });
    const hud = [tag, topRight, bottom, viewWrap, help];
    for (const el of [...hud, amp, restore, announce]) {
      blurOnPointer(el);
      c.addDisposer(mount(c.dom.overlay, el));
    }

    const ro = new ResizeObserver(() => {
      susp.layout();
      view.layout();
    });
    ro.observe(susp.el);
    ro.observe(view.el);
    c.addDisposer(() => ro.disconnect());

    // --- keyboard (UI-01)
    const keyContext = () => {
      const vehicle = c.registries.vehicles.get(c.store.get().vehicleId);
      return { suspensions: vehicle?.suspensions ?? [], otherVehicleId: otherClassVehicle(c, vehicle)?.id ?? null };
    };
    function apply(r: KeyResult): boolean {
      if (r === null) return false;
      if (r === 'help') setHelp(help.hidden);
      else if (r === 'escape') {
        if (help.hidden && !c.store.get().creditsOpen && !cameraOpen) return false;
        setCameraOpen(false);
        setHelp(false);
        c.store.setKey('creditsOpen', false);
      } else set(r);
      return true;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTextInput(e.target)) return;
      // A focused (non-radio) button keeps Space/Enter for its own activation.
      if (e.key === ' ' && e.target instanceof HTMLButtonElement && e.target.getAttribute('role') !== 'radio') return;
      if (e.repeat && e.key !== 'Escape') return;
      if (apply(keyAction(e.key, c.store.get(), keyContext()))) e.preventDefault();
      else if (e.key.toLowerCase() === 'x' && c.store.get().view === 'closeup') announce.textContent = 'Yakın planda iç görünüm açık kalır';
    };
    window.addEventListener('keydown', onKey);
    c.addDisposer(() => window.removeEventListener('keydown', onKey));

    function renderHelp(): void {
      const k = keyContext();
      const drive = c.services.tryGet(DRIVE) !== undefined;
      const driving = c.store.get().driveMode !== 'auto';
      const rows: [string[], string, string?][] = [
        [k.suspensions.map((_, i) => String(i + 1)), 'Süspansiyon'],
        [['F', 'E', 'C'], 'Takip · Keşfet · Yakın plan'],
        c.store.get().view === 'closeup' ? [['X'], 'İç görünüm · yakın planda daima açık'] : [['X'], 'İç görünüm', 'x'],
        ...(k.otherVehicleId ? ([[['V'], 'Araç türü', 'v']] as [string[], string, string][]) : []),
        [['Boşluk'], 'Duraklat', ' '],
        // the drive feature handles these keys itself (W A S D drive outside Auto)
        ...((drive ? (driving ? DRIVING_ROWS : TAKEOVER_ROWS) : []) as [string[], string][]),
        ...((driving ? [] : [[['S'], 'Ağır çekim', 's'], [['A'], 'Hareketi büyüt', 'a']]) as [string[], string, string][]),
        [['H'], 'Kontrolleri gizle', 'h'],
        // the audio feature puts its toggle in the Display group and handles M itself
        ...(tools.querySelector('.sl-audio-btn') ? ([[['M'], 'Sesi aç / kapat']] as [string[], string][]) : []),
        [['Esc'], 'Panelleri kapat'],
      ];
      helpRows.replaceChildren(
        ...rows.map(([keys, label, key]) =>
          h(key === undefined ? 'div' : 'button', { class: 'sl-controls-help-row', type: key === undefined ? null : 'button', 'data-key': key ?? null }, h('span', { class: 'sl-controls-help-keys' }, ...keys.map((x) => h('kbd', { class: 'sl-controls-kbd' }, x))), h('span', {}, label)),
        ),
      );
    }

    // --- render from the store
    let suspKey = '';
    let lastSusp = '';
    let lastView = '';
    c.watch((s) => {
      const vehicle = c.registries.vehicles.get(s.vehicleId);
      name.textContent = vehicle?.name ?? '';
      subtitle.textContent = vehicle?.subtitle ?? '';

      const ids = vehicle?.suspensions ?? [];
      if (ids.join() !== suspKey) {
        suspKey = ids.join();
        susp.setOptions(
          ids.map((id, i) => {
            const copy = c.registries.suspensions.get(id)?.copy;
            return { id, label: copy?.label ?? id, short: copy?.short ?? id, key: String(i + 1) };
          }),
        );
      }
      susp.setValue(s.suspensionId);
      const copy = c.registries.suspensions.get(s.suspensionId)?.copy;
      descriptor.textContent = copy?.descriptor ?? '';
      view.setValue(s.view);
      if (lastSusp && s.suspensionId !== lastSusp) announce.textContent = `${copy?.label ?? s.suspensionId} süspansiyonu`;
      if (lastView && s.view !== lastView) announce.textContent = `${VIEWS.find((v) => v.id === s.view)?.label ?? s.view} kamerası`;
      lastSusp = s.suspensionId;
      lastView = s.view;
      // The canvas is one picture to assistive tech; its name says what it shows (the HUD carries the numbers).
      const viewLabel = VIEWS.find((v) => v.id === s.view)?.label ?? s.view;
      const sceneLabel = `3B görünüm, ${viewLabel}: ${copy?.label ?? s.suspensionId} süspansiyonlu ${vehicle?.name ?? 'araç'}, test alanında ${s.driveMode === 'manual' ? 'sizin kontrolünüzde' : 'tur atıyor'}`;
      if (c.dom.stage.getAttribute('aria-label') !== sceneLabel) c.dom.stage.setAttribute('aria-label', sceneLabel);

      const other = otherClassVehicle(c, vehicle);
      vehicleBtn.hidden = other === undefined;
      if (other) {
        vehicleBtn.lastElementChild!.textContent = other.name;
        vehicleBtn.setAttribute('aria-label', `${other.name} aracına geç`);
        vehicleBtn.title = `${other.name} aracına geç (V)`;
      }

      const isLive = s.clock === 'live' && !s.paused && s.timeScale === 1;
      live.classList.toggle('is-live', isLive);
      live.lastElementChild!.textContent = isLive ? 'Canlı' : 'Canlıya dön';
      live.setAttribute('aria-label', isLive ? 'Canlı' : 'Canlıya dön');
      live.title = isLive ? 'Ortak canlı tur takip ediliyor' : 'Ortak canlı tura dön';
      setIcon(pause, s.paused ? 'play' : 'pause');
      pause.setAttribute('aria-label', s.paused ? 'Oynat' : 'Duraklat');
      pause.title = s.paused ? 'Oynat (Boşluk)' : 'Duraklat (Boşluk)';
      slow.setAttribute('aria-pressed', String(s.timeScale !== 1));
      slow.title = 'Ağır çekim (S)';

      amp.hidden = s.amplification === 1;
      ampText.textContent = amplificationText(s.amplification);

      credits.setAttribute('aria-expanded', String(s.creditsOpen));
      const hidden = !s.hudVisible || s.attract;
      for (const el of hud) el.classList.toggle('is-hidden', hidden);
      if (hidden) {
        setHelp(false);
        setCameraOpen(false);
      }
      restore.hidden = s.hudVisible || s.attract;
    });
    c.addDisposer(installMessageLayout(c.dom.overlay, c.dom.stage));
  },
} satisfies FeatureModule;
