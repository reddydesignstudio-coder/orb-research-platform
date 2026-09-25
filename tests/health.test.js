import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHealth, classifyHealthStatus } from '../frontend/js/health.js';

const READY = {
  state: 'ready',
  errors: [],
  supabaseUrl: 'https://example.supabase.co/',
  supabaseAnonKey: 'sb_' + 'publishable_' + 'x'.repeat(20),
};

test('online when the health endpoint returns 200, using the publishable key', async () => {
  let seen;
  const fakeFetch = async (url, opts) => {
    seen = { url, apikey: opts.headers.apikey };
    return { status: 200 };
  };
  const h = await checkHealth(READY, fakeFetch);
  assert.equal(h.state, 'online');
  assert.equal(seen.url, 'https://example.supabase.co/auth/v1/health');
  assert.equal(seen.apikey, READY.supabaseAnonKey);
});

test('paused, rejected key and unexpected statuses are distinguished', () => {
  assert.equal(classifyHealthStatus(540).state, 'paused');
  assert.equal(classifyHealthStatus(503).state, 'paused');
  assert.equal(classifyHealthStatus(401).label, 'Key rejected');
  assert.equal(classifyHealthStatus(500).state, 'error');
});

test('network failure is reported as offline, not swallowed', async () => {
  const h = await checkHealth(READY, async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.equal(h.state, 'offline');
  assert.match(h.detail, /ECONNREFUSED/);
});

test('no request is made when config is unconfigured or invalid', async () => {
  let called = false;
  const spy = async () => ((called = true), { status: 200 });
  assert.equal((await checkHealth({ state: 'unconfigured', errors: [] }, spy)).state, 'unconfigured');
  assert.equal((await checkHealth({ state: 'invalid', errors: [{ code: 'X' }] }, spy)).state, 'error');
  assert.equal(called, false);
});
