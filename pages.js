import { h, icon } from '../dom.js';
import { ROUTES } from '../routes.js';
import { hrefFor, DEFAULT_ROUTE_ID } from '../router.js';

/**
 * Coloured page header shared by every section.
 * @param {import('../routes.js').Route} route
 */
function hero(route) {
  return h('header', { class: `hero tone-${route.tone}` }, [
    h('span', { class: 'hero-icon' }, [icon(route.icon)]),
    h('div', { class: 'hero-text' }, [
      h('h1', { id: 'page-title' }, [route.title]),
      h('p', { class: 'hero-summary' }, [route.summary]),
    ]),
    h('span', { class: 'pill pill-planned' }, ['Planned']),
  ]);
}

/**
 * What the section will provide (from the spec) and which tasks build it.
 * States plainly that nothing exists yet (INSTRUCTIONS.md §9).
 * @param {import('../routes.js').Route} route
 */
function plannedCard(route) {
  return h('div', { class: `card tone-${route.tone}` }, [
    h('p', { class: 'card-label' }, ['What this section will do']),
    h(
      'ul',
      { class: 'highlights' },
      route.highlights.map((text) => h('li', {}, [icon('check', 'icon icon-check'), h('span', {}, [text])])),
    ),
    h('div', { class: 'card-footer' }, [
      h('span', { class: 'muted' }, ['Not built yet — no data or results are shown until then. Built in']),
      ...route.plannedIn.map((t) => h('span', { class: 'chip' }, [t])),
    ]),
  ]);
}

/** Dashboard: overview of every module as coloured tiles. */
function moduleGrid() {
  const others = ROUTES.filter((r) => r.id !== DEFAULT_ROUTE_ID);
  return h('section', { class: 'modules', 'aria-labelledby': 'modules-title' }, [
    h('h2', { id: 'modules-title', class: 'section-title' }, ['Modules']),
    h(
      'div',
      { class: 'module-grid' },
      others.map((r) =>
        h('a', { href: hrefFor(r.id), class: `module tone-${r.tone}` }, [
          h('span', { class: 'module-icon' }, [icon(r.icon)]),
          h('span', { class: 'module-title' }, [r.title]),
          h('span', { class: 'module-summary' }, [r.summary]),
          h('span', { class: 'module-foot' }, [
            h('span', { class: 'chip' }, [r.plannedIn[0] + (r.plannedIn.length > 1 ? '+' : '')]),
            icon('arrow', 'icon icon-arrow'),
          ]),
        ]),
      ),
    ),
  ]);
}

/**
 * @param {import('../routes.js').Route} route
 * @returns {HTMLElement}
 */
export function renderPlannedPage(route) {
  return h('section', { class: 'page', 'aria-labelledby': 'page-title' }, [
    hero(route),
    plannedCard(route),
    route.id === DEFAULT_ROUTE_ID ? moduleGrid() : null,
  ]);
}

/**
 * @param {string} path
 * @returns {HTMLElement}
 */
export function renderNotFound(path) {
  return h('section', { class: 'page', 'aria-labelledby': 'page-title' }, [
    h('header', { class: 'hero tone-slate' }, [
      h('div', { class: 'hero-text' }, [
        h('h1', { id: 'page-title' }, ['Page not found']),
        h('p', { class: 'hero-summary' }, [`There is no section at "${path}".`]),
      ]),
    ]),
    h('p', {}, [h('a', { href: hrefFor(DEFAULT_ROUTE_ID) }, ['Go to the Dashboard'])]),
  ]);
}

/**
 * Configuration banner. Only shown when something needs attention.
 * @param {import('../config.js').ConfigResult} config
 * @returns {HTMLElement | null}
 */
export function renderConfigBanner(config) {
  if (config.state === 'ready') return null;
  if (config.state === 'unconfigured') {
    return h('div', { class: 'banner banner-info' }, [
      h('strong', {}, ['Database not connected. ']),
      'Add the Supabase URL and publishable key to frontend/js/app-config.js.',
    ]);
  }
  return h('div', { class: 'banner banner-error' }, [
    h('strong', {}, ['Configuration error — the app will not connect to the database.']),
    h('ul', {}, config.errors.map((e) => h('li', {}, [`${e.code}: ${e.message}`]))),
  ]);
}
