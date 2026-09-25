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
