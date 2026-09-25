/**
 * Hash-based router.
 *
 * GitHub Pages serves static files only and has no fallback to index.html for
 * unknown paths, so deep links such as /backtest would 404. Hash routes
 * (#/backtest) always load index.html. See docs/DECISIONS.md (D-004).
 *
 * `resolveRoute` is a pure function so it can be tested without a browser.
 */

import { ROUTES, DEFAULT_ROUTE_ID } from './routes.js';

/**
 * Turn a location hash into a normalised path.
 *   ''            -> '/'
 *   '#'           -> '/'
 *   '#/backtest/' -> '/backtest'
 *   '#/data?x=1'  -> '/data'
 * @param {string} hash
 * @returns {string}
 */
export function hashToPath(hash) {
  let path = String(hash ?? '').replace(/^#/, '');
  path = path.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path.toLowerCase();
}

/**
 * @param {string} hash
 * @param {readonly import('./routes.js').Route[]} [routes]
 * @returns {{ found: true, route: import('./routes.js').Route } | { found: false, path: string }}
 */
export function resolveRoute(hash, routes = ROUTES) {
  const path = hashToPath(hash);
  const route = routes.find((r) => r.path === path);
  if (route) return { found: true, route };
  return { found: false, path };
}

/**
 * @param {string} id
 * @returns {string} hash link for a route id, e.g. '#/backtest'
 */
export function hrefFor(id) {
  const route = ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`Unknown route id: ${id}`);
  return `#${route.path}`;
}

export { DEFAULT_ROUTE_ID };
