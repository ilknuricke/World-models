/**
 * Credits panel (plan 04-02, ARCHITECTURE §15): asset attributions from the manifest (generated from
 * assets-src/ATTRIBUTION.json) plus code/data credits. Opens on `store.creditsOpen` (HUD link, shortcut card).
 */
import type { FeatureModule } from '../../contracts/app';
import { h, mount } from '../../ui/dom';
import { CODE_CREDITS, LICENSE_NOTICES } from './code-credits';
import './credits.css';
import { attributionText, licenseName } from './text';

const CLOSE_ICON =
  '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';

/** Plain text with its URLs as links; textContent stays exactly `text`. */
function linkify(text: string): (Node | string)[] {
  return text.split(/(https?:\/\/[^\s)]+?)(?=[.]?(?:\s|\)|$))/).map((part, i) =>
    i % 2 === 1 ? h('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part) : part,
  );
}

export default {
  id: 'credits',
  requires: [],
  phase: 'overlay',

  init(c) {
    const close = h('button', { type: 'button', class: 'sl-credits-close', 'aria-label': 'Katkıda bulunanları kapat' });
    close.innerHTML = CLOSE_ICON;
    const body = h('div', { class: 'sl-credits-body' });
    const panel = h(
      'aside',
      { class: 'sl-credits', role: 'dialog', 'aria-labelledby': 'sl-credits-title', hidden: true },
      h('header', { class: 'sl-credits-head' }, h('h2', { class: 'sl-credits-title', id: 'sl-credits-title' }, 'Katkıda bulunanlar'), close),
      body,
    );
    c.addDisposer(mount(c.dom.overlay, panel));

    const render = () => {
      const assets = c.assets.manifest.attributions.map((a) =>
        h(
          'li',
          { class: 'sl-credits-item' },
          h('div', { class: 'sl-credits-name' }, a.title, h('span', { class: 'sl-credits-lic' }, licenseName(a.license))),
          h('p', { class: 'sl-credits-text' }, ...linkify(attributionText(a))),
        ),
      );
      const code = CODE_CREDITS.map((k) =>
        h(
          'li',
          { class: 'sl-credits-item' },
          h('div', { class: 'sl-credits-name' }, h('a', { href: k.url, target: '_blank', rel: 'noopener noreferrer' }, k.name), h('span', { class: 'sl-credits-lic' }, k.license)),
          h('p', { class: 'sl-credits-text' }, `${k.use}. ${k.copyright}.`),
        ),
      );
      body.replaceChildren(
        h(
          'p',
          { class: 'sl-credits-lede' },
          'Süspansiyon Laboratuvarı, başkalarının çalışmalarından yararlanır. Araç modelleri yalnızca biçimleri için kullanılır; üretici verilerini temsil etmez. Araç parametreleri örnek niteliğindedir.',
        ),
        h('h3', { class: 'sl-credits-h sl-label' }, 'Görsel ve ses kaynakları'),
        assets.length ? h('ul', { class: 'sl-credits-list' }, ...assets) : h('p', { class: 'sl-credits-text' }, 'Kaynak listesi kullanılamıyor.'),
        h('h3', { class: 'sl-credits-h sl-label' }, 'Kod, veri ve yazı tipleri'),
        h('ul', { class: 'sl-credits-list' }, ...code),
        h('h3', { class: 'sl-credits-h sl-label' }, 'Lisans bildirimleri'),
        ...LICENSE_NOTICES.flatMap((n) => [h('p', { class: 'sl-credits-text' }, n.title), h('pre', { class: 'sl-credits-notice' }, n.text)]),
        h('p', { class: 'sl-credits-text' }, ...linkify('Geist yazı tipleri: SIL Open Font License 1.1 (https://openfontlicense.org). postprocessing: zlib lisansı. n8ao: ISC lisansı.')),
      );
    };

    let opener: Element | null = null;
    let rendered = false;
    close.addEventListener('click', () => c.store.setKey('creditsOpen', false));
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      c.store.setKey('creditsOpen', false);
    });
    c.watch((s) => {
      if (s.creditsOpen === !panel.hidden) return;
      if (s.creditsOpen) {
        if (!rendered) render();
        rendered = true;
        opener = document.activeElement;
        panel.hidden = false;
        close.focus();
      } else {
        panel.hidden = true;
        if (opener instanceof HTMLElement && opener.isConnected && panel.contains(document.activeElement)) opener.focus();
        opener = null;
      }
    });
  },
} satisfies FeatureModule;
