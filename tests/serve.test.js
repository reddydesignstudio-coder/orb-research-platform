import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { resolveSafePath, createDevServer, FRONTEND_ROOT } from '../scripts/serve.mjs';

test('resolveSafePath maps URLs inside the frontend root', () => {
  assert.equal(resolveSafePath('/'), resolve(FRONTEND_ROOT, 'index.html'));
  assert.equal(resolveSafePath('/js/main.js?v=1'), resolve(FRONTEND_ROOT, 'js/main.js'));
});

test('resolveSafePath blocks path traversal', () => {
  for (const bad of ['/../package.json', '/%2e%2e/package.json', '/js/../../README.md', '/..%2f..%2fetc/passwd']) {
    const p = resolveSafePath(bad);
    assert.ok(p === null || p.startsWith(FRONTEND_ROOT + sep), `${bad} -> ${p}`);
  }
  assert.equal(resolveSafePath('/a%00b'), null);
  assert.equal(resolveSafePath('/%E0%A4%A'), null); // malformed escape
});

test('dev server serves the app shell with correct types', async (t) => {
  const server = createDevServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /js\/main\.js/);

  const js = await fetch(`${base}/js/main.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /text\/javascript/);

  const css = await fetch(`${base}/css/app.css`);
  assert.match(css.headers.get('content-type'), /text\/css/);

  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
});
