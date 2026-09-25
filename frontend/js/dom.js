import { ICONS } from './icons.js';

/**
 * Minimal DOM helper.
 *
 * Text is always set with textContent, never innerHTML, so values that later
 * come from the database or a provider cannot inject markup.
 *
 * @param {string} tag
 * @param {Record<string, string | boolean | undefined>} [attrs]
 * @param {Array<Node | string | null | undefined | false>} [children]
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Inline SVG icon from icons.js. Decorative: hidden from screen readers.
 * @param {string} name
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function icon(name, className = 'icon') {
  const paths = ICONS[name];
  if (!paths) throw new Error(`Unknown icon: ${name}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
