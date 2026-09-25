import { h } from '../dom.js';
import { ROUTES } from '../routes.js';
import { hrefFor } from '../router.js';

/**
 * Application shell: header, section navigation, main area, research disclaimer.
 * @returns {{ root: HTMLElement, main: HTMLElement, banner: HTMLElement, setActive: (id: string | null) => void }}
 */
export function createLayout() {
  const links = ROUTES.map((r) =>
    h('a', { href: hrefFor(r.id), 'data-route': r.id, class: 'nav-link' }, [r.title]),
  );

  const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, links);
  const banner = h('div', { class: 'banner-slot', role: 'status', 'aria-live': 'polite' });
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });

  const root = h('div', { class: 'shell' }, [
    h('a', { href: '#main', class: 'skip-link' }, ['Skip to content']),
    h('header', { class: 'header' }, [
      h('span', { class: 'brand' }, ['ORB Research']),
      h('span', { class: 'brand-sub' }, ['Historical research & backtesting']),
    ]),
    nav,
    h('div', { class: 'content' }, [
      banner,
      main,
      h('footer', { class: 'footer' }, [
        'Historical research only. Past results do not guarantee future performance. ',
        'Cross-symbol results describe historical association, not causation.',
      ]),
    ]),
  ]);

  /** @param {string | null} id */
  function setActive(id) {
    for (const link of links) {
      if (link.dataset.route === id) {
        link.setAttribute('aria-current', 'page');
        // On phones the tab bar scrolls sideways; keep the current tab visible.
        link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }

  return { root, main, banner, setActive };
}
