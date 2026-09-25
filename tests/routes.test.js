import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, DEFAULT_ROUTE_ID } from '../frontend/js/routes.js';

// PROJECT.md §16 — the seven sections of the finished product.
const REQUIRED_TITLES = ['Dashboard', 'Data', 'Admin', 'ORB Research', 'Backtest', 'Relationships', 'Settings'];

test('all seven PROJECT.md §16 sections exist, in order', () => {
  assert.deepEqual(
    ROUTES.map((r) => r.title),
    REQUIRED_TITLES,
  );
});

test('route ids and paths are unique and well formed', () => {
  const ids = new Set(ROUTES.map((r) => r.id));
  const paths = new Set(ROUTES.map((r) => r.path));
  assert.equal(ids.size, ROUTES.length);
  assert.equal(paths.size, ROUTES.length);
  for (const r of ROUTES) {
    assert.match(r.id, /^[a-z][a-z-]*$/);
    assert.match(r.path, /^\/[a-z-]*$/);
    assert.ok(r.summary.length > 0);
  }
});

test('every planned section names the task(s) that build it', () => {
  for (const r of ROUTES) {
    if (r.status === 'planned') {
      assert.ok(r.plannedIn.length > 0, r.id);
      for (const t of r.plannedIn) assert.match(t, /^TASK \d{3}$/);
    }
  }
});

test('default route exists and is the root path', () => {
  const def = ROUTES.find((r) => r.id === DEFAULT_ROUTE_ID);
  assert.ok(def);
  assert.equal(def.path, '/');
});

test('route table is immutable', () => {
  assert.ok(Object.isFrozen(ROUTES));
});

test('every section has a tone, an existing icon and highlights', async () => {
  const { ICONS } = await import('../frontend/js/icons.js');
  const css = await (await import('node:fs/promises')).readFile(
    new URL('../frontend/css/app.css', import.meta.url),
    'utf8',
  );
  for (const r of ROUTES) {
    assert.ok(ICONS[r.icon], `${r.id}: icon "${r.icon}" missing from icons.js`);
    assert.match(css, new RegExp(`\\.tone-${r.tone}\\s*\\{`), `${r.id}: .tone-${r.tone} missing from app.css`);
    assert.ok(r.highlights.length >= 1, `${r.id}: no highlights`);
  }
});

test('green and red are not used as section tones (reserved for bullish / bearish)', () => {
  for (const r of ROUTES) assert.ok(!['green', 'red', 'emerald', 'rose'].includes(r.tone), r.id);
});
