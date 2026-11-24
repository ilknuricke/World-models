/**
 * Phone remote (`/remote.html?room=CODE`): with `#k=HOSTKEY` it is the presenter's remote (host), with `#d=DRIVERKEY`
 * the phone driver (12-04), otherwise the audience vote panel. Imports no app kernel and no three.js; talks to the room
 * over its own partysocket.
 */
import { h, mount } from '../ui/dom';
import { REMOTE_PAGE, type ClientMessage } from '../contracts/net';
import { clientId, connectRemote, forgetHostKey, normaliseCode, readRemoteTarget, type LinkStatus, type RemoteLink } from './connection';
import { createDriverPanel } from './driver-panel';
import { createHostPanel } from './host-panel';
import './remote.css';
import { createVotePanel } from './vote-panel';

const session = (() => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
})();
const local = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();

const STATUS_TEXT: Record<LinkStatus, string> = {
  connecting: 'Bağlanıyor',
  live: 'Canlı',
  offline: 'Yeniden bağlanıyor',
  denied: 'Anahtar reddedildi',
  gone: 'Oda kapandı',
  full: 'Oda dolu',
  outdated: 'Güncelleme gerekli',
  replaced: 'Kontrol devralındı',
};

function header(code: string | null, role: string | null): { el: HTMLElement; status(s: LinkStatus): void } {
  const dot = h('span', { class: 'rm-dot', 'aria-hidden': 'true' });
  const state = h('span', { class: 'rm-state' });
  const el = h(
    'header',
    { class: 'rm-header' },
    h('div', { class: 'rm-brand' }, h('span', { class: 'rm-wordmark' }, 'Süspansiyon Laboratuvarı'), role ? h('span', { class: 'rm-role' }, role) : null),
    code ? h('div', { class: 'rm-room', 'aria-live': 'polite' }, dot, h('span', { class: 'rm-code' }, code), state) : null,
  );
  return {
    el,
    status(s) {
      el.dataset['status'] = s;
      state.textContent = STATUS_TEXT[s];
    },
  };
}

function joinForm(message: string): HTMLElement {
  const input = h('input', {
    class: 'rm-input',
    name: 'room',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    maxlength: 5,
    placeholder: 'KOD',
    'aria-label': 'Oda kodu',
  });
  const form = h(
    'form',
    { class: 'rm-card rm-join' },
    h('h1', { class: 'rm-join-title' }, 'Laboratuvara katıl'),
    h('p', { class: 'rm-note' }, message),
    input,
    h('button', { type: 'submit', class: 'rm-button rm-primary' }, 'Katıl'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normaliseCode(input.value);
    if (code) location.assign(`${REMOTE_PAGE}?room=${code}`);
    else input.setAttribute('aria-invalid', 'true');
  });
  return form;
}

function banner(text: string, action?: { label: string; run: () => void }): HTMLElement {
  const b = h('div', { class: 'rm-banner', role: 'alert' }, h('p', {}, text));
  if (action) {
    const btn = h('button', { type: 'button', class: 'rm-button' }, action.label);
    btn.addEventListener('click', action.run);
    b.append(btn);
  }
  return b;
}

function start(root: HTMLElement): void {
  const { code, hostKey, driverKey } = readRemoteTarget(location, session);
  // The key never stays in the address bar (screenshots, shared links, history sync).
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  if (!code) {
    const head = header(null, null);
    mount(root, head.el);
    mount(root, joinForm('Büyük ekrandaki beş harfli kodu yazın.'));
    return;
  }

  const role = driverKey ? 'driver' : hostKey ? 'host' : 'audience';
  const head = header(code, role === 'driver' ? 'Sürücü' : role === 'host' ? 'Sunucu' : 'İzleyici');
  const notice = h('div', { class: 'rm-notice' });
  let link: RemoteLink | null = null;
  const send = (m: ClientMessage) => link?.send(m);
  const host = role === 'host' ? createHostPanel(send) : null;
  const vote = role === 'audience' ? createVotePanel(send) : null;
  const driver = role === 'driver' ? createDriverPanel(code, () => link) : null;
  if (driver) {
    document.body.dataset['role'] = 'driver';
    head.el.append(driver.badge);
    // a wheel, not a page: no pinch or double-tap zoom while driving
    document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  }
  mount(root, head.el);
  mount(root, notice);
  mount(root, (host ?? vote ?? driver)!.el);
  link = connectRemote({
    origin: location.origin,
    code,
    role,
    key: driverKey ?? hostKey,
    clientId: clientId(local),
    onMessage: (m) => {
      if (driver) return driver.message(m);
      if (m.t === 'welcome') {
        host?.ctl(m.ctl);
        host?.poll(m.poll);
        vote?.poll(m.poll);
        vote?.viewers(m.presence.viewers);
      } else if (m.t === 'ctl') host?.ctl(m.state);
      else if (m.t === 'poll') {
        host?.poll(m.poll);
        vote?.poll(m.poll);
      }
      else if (m.t === 'presence') vote?.viewers(m.viewers);
    },
    onStatus: (s) => {
      head.status(s);
      document.body.dataset['status'] = s;
      if (driver) {
        driver.status(s); // its own calm sheets for replaced / denied / gone
        notice.replaceChildren(...(s === 'full' ? [banner('Oda şu anda dolu. Biraz sonra yeniden deneyin.')] : s === 'outdated' ? [banner('Yeni bir sürüm kullanıma sunuldu.', { label: 'Yenile', run: () => location.reload() })] : []));
        return;
      }
      if (s === 'denied')
        notice.replaceChildren(
          banner('Bu sunucu bağlantısı artık bu oda için geçerli değil.', {
            label: 'İzleyici olarak katıl',
            run: () => {
              forgetHostKey(code, session);
              location.replace(`${REMOTE_PAGE}?room=${code}`);
            },
          }),
        );
      else if (s === 'gone') notice.replaceChildren(joinForm(`${code} odası kapandı. Büyük ekrandaki kodu kontrol edin.`));
      else if (s === 'full') notice.replaceChildren(banner('Oda şu anda dolu. Biraz sonra yeniden deneyin.'));
      else if (s === 'outdated') notice.replaceChildren(banner('Yeni bir sürüm kullanıma sunuldu.', { label: 'Yenile', run: () => location.reload() }));
      else notice.replaceChildren();
    },
  });
  addEventListener('pagehide', () => {
    driver?.dispose();
    link?.close();
  });
}

const root = document.getElementById('remote');
if (root) start(root);
