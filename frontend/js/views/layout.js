import { h, icon } from '../dom.js';
import { ROUTES } from '../routes.js';
import { hrefFor } from '../router.js';

/**
 * Application shell: gradient header with live database status, section
 * navigation, main area, research disclaimer.
 * @returns {{
 *   root: HTMLElement, main: HTMLElement, banner: HTMLElement,
 *   setActive: (id: string | null) => void,
 *   setHealth: (health: import('../health.js').Health) => void
 * }}
 */
export function createLayout() {
  const links = ROUTES.map((r) =>
    h('a', { href: hrefFor(r.id), 'data-route': r.id, class: `nav-link tone-${r.tone}` }, [
      h('span', { class: 'nav-icon' }, [icon(r.icon)]),
      h('span', { class: 'nav-label' }, [r.title]),
    ]),
  );

  const statusDot = h('span', { class: 'status-dot' });
  const statusText = h('span', { class: 'status-text' }, ['Checking database…']);
  const status = h('span', { class: 'status-pill', 'data-state': 'checking', role: 'status', title: '' }, [
    statusDot,
    statusText,
  ]);

  const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, links);
  const banner = h('div', { class: 'banner-slot', role: 'status', 'aria-live': 'polite' });
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });

  const root = h('div', { class: 'shell' }, [
    h('a', { href: '#main', class: 'skip-link' }, ['Skip to content']),
    h('header', { class: 'header' }, [
      h('a', { href: hrefFor('dashboard'), class: 'brand', 'aria-label': 'ORB Research — Dashboard' }, [
        h('span', { class: 'brand-mark' }, [icon('logo')]),
        h('span', { class: 'brand-text' }, [
          h('span', { class: 'brand-name' }, ['ORB Research']),
          h('span', { class: 'brand-sub' }, ['Opening Range Breakout · historical research']),
        ]),
      ]),
      status,
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

  /** @param {import('../health.js').Health} health */
  function setHealth(health) {
    status.dataset.state = health.state;
    status.title = health.detail;
    statusText.textContent = health.label;
  }

  return { root, main, banner, setActive, setHealth };
}
