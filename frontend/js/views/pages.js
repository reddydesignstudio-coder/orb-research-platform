import { h } from '../dom.js';
import { hrefFor, DEFAULT_ROUTE_ID } from '../router.js';

/**
 * Page for a section that has not been built yet. States plainly that nothing
 * exists and which task will build it (INSTRUCTIONS.md §9: the user should
 * always understand what exists).
 * @param {import('../routes.js').Route} route
 * @returns {HTMLElement}
 */
export function renderPlannedPage(route) {
  return h('section', { class: 'page', 'aria-labelledby': 'page-title' }, [
    h('h1', { id: 'page-title' }, [route.title]),
    h('p', { class: 'lead' }, [route.summary]),
    h('div', { class: 'card' }, [
      h('p', { class: 'card-label' }, ['Not built yet']),
      h('p', {}, [`This section is planned in ${route.plannedIn.join(', ')}. No data or results are shown until then.`]),
    ]),
  ]);
}

/**
 * @param {string} path
 * @returns {HTMLElement}
 */
export function renderNotFound(path) {
  return h('section', { class: 'page', 'aria-labelledby': 'page-title' }, [
    h('h1', { id: 'page-title' }, ['Page not found']),
    h('p', { class: 'lead' }, [`There is no section at "${path}".`]),
    h('p', {}, [h('a', { href: hrefFor(DEFAULT_ROUTE_ID) }, ['Go to the Dashboard'])]),
  ]);
}

/**
 * Configuration status banner.
 * @param {import('../config.js').ConfigResult} config
 * @returns {HTMLElement | null}
 */
export function renderConfigBanner(config) {
  if (config.state === 'ready') return null;
  if (config.state === 'unconfigured') {
    return h('div', { class: 'banner banner-info' }, [
      h('strong', {}, ['Database not connected. ']),
      'The Supabase project is set up from TASK 003 onward. Until then no market data is available.',
    ]);
  }
  return h('div', { class: 'banner banner-error' }, [
    h('strong', {}, ['Configuration error — the app will not connect to the database.']),
    h('ul', {}, config.errors.map((e) => h('li', {}, [`${e.code}: ${e.message}`]))),
  ]);
}
