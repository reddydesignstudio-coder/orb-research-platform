/**
 * market-data Edge Function handler (TASK 007). Injected env and fetch:
 * no Supabase, no Twelve Data, no real keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarketDataHandler, parseSecretKeys, safeEqual } from '../../supabase/functions/_shared/market-data/handler.js';
import { TD_RESPONSES } from '../adapters/fixtures/twelve-data-responses.js';

// Fake credentials assembled at runtime (no credential-shaped literals in the repo).
const SECRET = ['sb', 'secret', 'fakefakefakefake1234'].join('_');
const PUBLISHABLE = ['sb', 'publishable', 'fakefakefake5678'].join('_');
const TD_KEY = ['td', 'live', 'fakekey0123456789'].join('_');
const URL_BASE = 'https://project.supabase.test';

const SYMBOLS = {
  SPY: { symbol: 'SPY', market: 'us_stock', provider: 'twelve_data', provider_symbol: 'SPY', enabled: true },
  'EUR/USD': { symbol: 'EUR/USD', market: 'forex', provider: 'twelve_data', provider_symbol: 'EUR/USD', enabled: true },
  OFF: { symbol: 'OFF', market: 'us_stock', provider: 'twelve_data', provider_symbol: 'OFF', enabled: false },
  OTHER: { symbol: 'OTHER', market: 'us_stock', provider: 'other_provider', provider_symbol: 'OTHER', enabled: true },
};

function setup({ env = {}, td = TD_RESPONSES } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    const u = new URL(url);
    if (u.origin === URL_BASE && u.pathname === '/rest/v1/symbols') {
      const wanted = u.searchParams.get('symbol').replace(/^eq\./, '');
      return Response.json(SYMBOLS[wanted] ? [SYMBOLS[wanted]] : []);
    }
    if (u.hostname === 'api.twelvedata.com') {
      const fx = td[u.searchParams.get('start_date')];
      return new Response(JSON.stringify(fx.body), { status: fx.status, headers: fx.headers ?? {} });
    }
    throw new TypeError(`fetch failed: unexpected ${url}`);
  };
  const vars = {
    SUPABASE_URL: URL_BASE,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
    TWELVE_DATA_API_KEY: TD_KEY,
    ...env,
  };
  const logs = [];
  const handle = createMarketDataHandler({
    env: (n) => vars[n],
    fetchImpl,
    now: () => Date.parse('2026-08-04T13:30:20Z'),
    log: (m) => logs.push(m),
  });
  return { handle, calls, logs };
}

const post = (body, key = SECRET, raw) =>
  new Request('https://fn.test/market-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { apikey: key } : {}) },
    body: raw ?? JSON.stringify(body),
  });

const SPY_OK = { symbol: 'SPY', startUtc: '2026-07-01T13:30:00Z', endUtc: '2026-07-01T13:33:00Z' };

async function read(res) {
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text), headers: res.headers };
}

// ------------------------------------------------------------------ success
test('returns normalized candles and the completeness decision for a configured symbol', async () => {
  const { handle, calls } = setup();
  const r = await read(await handle(post(SPY_OK)));
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.provider, 'twelve_data');
  assert.equal(r.json.result.candles.length, 3);
  assert.equal(r.json.result.candles[0].timestampUtc, '2026-07-01T13:30:00.000Z');
  assert.equal(r.json.completeness.state, 'answered');
  // DB read uses the secret key; the provider call uses the provider key, in a header.
  assert.equal(calls[0].headers.apikey, SECRET);
  assert.equal(calls[1].headers.Authorization, `apikey ${TD_KEY}`);
  assert.ok(!calls[1].url.includes(TD_KEY));
  // Neither key ever reaches the response; no CORS header (browsers cannot read it).
  assert.ok(!r.text.includes(TD_KEY) && !r.text.includes(SECRET));
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('symbol lookup is exact and URL-encoded (EUR/USD)', async () => {
  const { handle, calls } = setup({ td: { '2026-07-01T13:30:00': { status: 200, body: { meta: { symbol: 'EUR/USD', interval: '1min' }, values: [], status: 'ok' } } } });
  const r = await read(await handle(post({ ...SPY_OK, symbol: 'EUR/USD' })));
  assert.equal(r.status, 200);
  assert.equal(new URL(calls[0].url).searchParams.get('symbol'), 'eq.EUR/USD');
  assert.equal(new URL(calls[1].url).searchParams.get('symbol'), 'EUR/USD');
});

// ------------------------------------------------------------------ caller authorization
test('rejects callers without a Supabase secret key — including the publishable key', async () => {
  const { handle, calls } = setup();
  for (const key of [null, PUBLISHABLE, `${SECRET}x`, SECRET.slice(0, -1)]) {
    const r = await read(await handle(post(SPY_OK, key)));
    assert.equal(r.status, 401, String(key));
    assert.equal(r.json.error.code, 'UNAUTHORIZED');
  }
  assert.equal(calls.length, 0, 'no database or provider call before authorization');
});

test('fails closed when Supabase secret keys are not available', async () => {
  const { handle } = setup({ env: { SUPABASE_SECRET_KEYS: undefined } });
  const r = await read(await handle(post(SPY_OK)));
  assert.equal(r.status, 500);
  assert.equal(r.json.error.code, 'SERVER_MISCONFIGURED');
});

test('only POST', async () => {
  const { handle } = setup();
  const r = await handle(new Request('https://fn.test/market-data', { method: 'GET', headers: { apikey: SECRET } }));
  assert.equal(r.status, 405);
});

// ------------------------------------------------------------------ input and configuration
test('bad input → 400 without calling anything', async () => {
  const { handle, calls } = setup();
  const cases = [
    post(null, SECRET, 'not json'),
    post({ startUtc: SPY_OK.startUtc, endUtc: SPY_OK.endUtc }),
    post({ ...SPY_OK, endUtc: SPY_OK.startUtc }),
    post({ ...SPY_OK, startUtc: '2026-07-01 09:30' }), // no timezone
  ];
  for (const req of cases) assert.equal((await handle(req)).status, 400);
  assert.equal(calls.length, 0);
});

test('unknown, disabled or unregistered-provider symbols are refused; nothing is guessed', async () => {
  const { handle, calls } = setup();
  assert.equal((await read(await handle(post({ ...SPY_OK, symbol: 'NOPE' })))).json.error.code, 'SYMBOL_NOT_CONFIGURED');
  assert.equal((await read(await handle(post({ ...SPY_OK, symbol: 'OFF' })))).json.error.code, 'SYMBOL_DISABLED');
  assert.equal((await read(await handle(post({ ...SPY_OK, symbol: 'OTHER' })))).json.error.code, 'PROVIDER_NOT_REGISTERED');
  assert.ok(calls.every((c) => !c.url.includes('twelvedata')), 'no provider call');
});

test('missing provider key → AUTH_FAILED telling the owner where to add it', async () => {
  const { handle, calls } = setup({ env: { TWELVE_DATA_API_KEY: undefined } });
  const r = await read(await handle(post(SPY_OK)));
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'AUTH_FAILED');
  assert.match(r.json.error.message, /Edge Function secret/);
  assert.equal(r.json.error.retryPolicy, 'needs_human');
  assert.equal(calls.length, 1, 'database read only');
});

// ------------------------------------------------------------------ provider errors
test('provider rate limit → 429 with the wait; quota → 429 with wait to 00:00 UTC', async () => {
  const { handle } = setup();
  const rate = await read(await handle(post({ symbol: 'SPY', startUtc: '2026-08-04T13:30:00Z', endUtc: '2026-08-04T13:40:00Z' })));
  assert.equal(rate.status, 429);
  assert.deepEqual([rate.json.error.code, rate.json.error.retryAfterMs, rate.json.error.retryPolicy], ['RATE_LIMITED', 40_000, 'wait_then_retry']);
  const quota = await read(await handle(post({ symbol: 'SPY', startUtc: '2026-08-05T13:30:00Z', endUtc: '2026-08-05T13:40:00Z' })));
  assert.equal(quota.json.error.code, 'QUOTA_EXHAUSTED');
});

test('provider auth error echoing the key is redacted in the response', async () => {
  const td = { '2026-08-01T13:30:00': { status: 401, body: { code: 401, message: `bad key ${TD_KEY}`, status: 'error' } } };
  const { handle } = setup({ td });
  const r = await read(await handle(post({ symbol: 'SPY', startUtc: '2026-08-01T13:30:00Z', endUtc: '2026-08-01T13:40:00Z' })));
  assert.equal(r.json.error.code, 'AUTH_FAILED');
  assert.ok(!r.text.includes(TD_KEY));
});

test('database unavailable → 502 DATABASE_ERROR; unexpected errors → 500, logged without secrets', async () => {
  const failing = createMarketDataHandler({
    env: (n) => ({ SUPABASE_URL: URL_BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ d: SECRET }), TWELVE_DATA_API_KEY: TD_KEY })[n],
    fetchImpl: async () => new Response('down', { status: 503 }),
  });
  assert.equal((await read(await failing(post(SPY_OK)))).json.error.code, 'DATABASE_ERROR');
  const unreachable = createMarketDataHandler({
    env: (n) => ({ SUPABASE_URL: URL_BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ d: SECRET }) })[n],
    fetchImpl: async () => { throw new TypeError(`fetch failed ${SECRET}`); },
  });
  const u = await read(await unreachable(post(SPY_OK)));
  assert.equal(u.json.error.code, 'DATABASE_ERROR');
  assert.ok(!u.text.includes(SECRET));

  const logs = [];
  const broken = createMarketDataHandler({
    env: (n) => ({ SUPABASE_URL: URL_BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ d: SECRET }), TWELVE_DATA_API_KEY: TD_KEY })[n],
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error(`boom ${SECRET} ${TD_KEY}`); } }),
    log: (m) => logs.push(m),
  });
  const r = await read(await broken(post(SPY_OK)));
  assert.equal(r.status, 500);
  assert.ok(!r.text.includes(SECRET) && !r.text.includes(TD_KEY));
  assert.ok(logs.length === 1 && !logs[0].includes(SECRET) && !logs[0].includes(TD_KEY));
});

// ------------------------------------------------------------------ helpers
test('parseSecretKeys and safeEqual', () => {
  assert.deepEqual(parseSecretKeys(JSON.stringify({ a: SECRET, b: 'short' })), [SECRET]);
  assert.deepEqual(parseSecretKeys('not json'), []);
  assert.deepEqual(parseSecretKeys(undefined), []);
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', undefined), false);
});
