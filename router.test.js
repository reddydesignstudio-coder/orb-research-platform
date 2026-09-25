import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashToPath, resolveRoute, hrefFor } from '../frontend/js/router.js';

test('hashToPath normalises hashes', () => {
  assert.equal(hashToPath(''), '/');
  assert.equal(hashToPath('#'), '/');
  assert.equal(hashToPath('#/'), '/');
  assert.equal(hashToPath('#/backtest'), '/backtest');
  assert.equal(hashToPath('#/backtest/'), '/backtest');
  assert.equal(hashToPath('#/Backtest'), '/backtest');
  assert.equal(hashToPath('#backtest'), '/backtest');
  assert.equal(hashToPath('#/data?symbol=AAPL'), '/data');
  assert.equal(hashToPath(undefined), '/');
});

test('empty hash resolves to the Dashboard', () => {
  const r = resolveRoute('');
  assert.equal(r.found, true);
  assert.equal(r.route.id, 'dashboard');
});

test('every section resolves from its own link', () => {
  for (const id of ['dashboard', 'data', 'admin', 'orb-research', 'backtest', 'relationships', 'settings']) {
    const r = resolveRoute(hrefFor(id));
    assert.equal(r.found, true, id);
    assert.equal(r.route.id, id);
  }
});

test('unknown paths are reported, not silently redirected', () => {
  const r = resolveRoute('#/does-not-exist');
  assert.equal(r.found, false);
  assert.equal(r.path, '/does-not-exist');
});

test('hrefFor rejects unknown ids', () => {
  assert.throws(() => hrefFor('nope'), /Unknown route id/);
});
