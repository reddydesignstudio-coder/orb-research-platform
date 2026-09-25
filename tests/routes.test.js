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
