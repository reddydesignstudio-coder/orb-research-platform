import rawConfig from './app-config.js';
import { validateConfig } from './config.js';
import { resolveRoute } from './router.js';
import { createLayout } from './views/layout.js';
import { renderPlannedPage, renderNotFound, renderConfigBanner } from './views/pages.js';

const config = validateConfig(rawConfig);
if (config.state === 'invalid') {
  // Fail loudly (RULES.md — FAIL LOUDLY): visible in the UI and in the console.
  console.error('[config] Invalid public configuration:', config.errors);
}

const layout = createLayout();
document.getElementById('app').replaceChildren(layout.root);

const banner = renderConfigBanner(config);
if (banner) layout.banner.replaceChildren(banner);

function render() {
  const result = resolveRoute(window.location.hash);
  if (result.found) {
    layout.main.replaceChildren(renderPlannedPage(result.route));
    layout.setActive(result.route.id);
    document.title = `${result.route.title} · ORB Research`;
  } else {
    layout.main.replaceChildren(renderNotFound(result.path));
    layout.setActive(null);
    document.title = 'Not found · ORB Research';
  }
}

window.addEventListener('hashchange', () => {
  render();
  layout.main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
render();
