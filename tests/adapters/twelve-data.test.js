/**
 * Twelve Data adapter (TASK 006). Uses synthetic responses in the documented
 * format and an injected fetch — no live provider, no real key (PROVIDERS.md §15).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { checkProviderContract } from '../providers/provider-contract.js';
import { TD_FOREX, TD_RESPONSES, TD_SCENARIOS } from './fixtures/twelve-data-responses.js';
import {
  CapabilityNotVerifiedError,
  ProviderError,
  assessCompleteness,
  createProviderRegistry,
  defineRange,
  defineRequest,
  isVerified,
  remainingRange,
  requireVerified,
  retryPolicyFor,
  splitRange,
} from '../../supabase/functions/_shared/providers/mod.js';
import {
  MAX_SAFE_RANGE_MINUTES,
  TWELVE_DATA_ID,
  buildTimeSeriesUrl,
  createTwelveDataProvider,
  msToNextMinute,
  msToUtcMidnight,
  parseRetryAfter,
  tdDatetimeToUtc,
} from '../../supabase/functions/_shared/adapters/twelve_data/mod.js';

const KEY = ['td', 'test', 'key', 'zyxwvutsrqpo9876'].join('_'); // fake, assembled at runtime
const SPY = Object.freeze({ symbol: 'SPY', provider: TWELVE_DATA_ID, provider_symbol: 'SPY', market: 'us_stock' });
const EURUSD = Object.freeze({ symbol: 'EUR/USD', provider: TWELVE_DATA_ID, provider_symbol: 'EUR/USD', market: 'forex' });
const NOW = Date.parse('2026-08-04T13:30:20Z');

/** Fake fetch serving fixtures by start_date; records every call. */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    const fx = responses[u.searchParams.get('start_date')];
    if (!fx) return new Response(JSON.stringify({ code: 400, message: 'no fixture', status: 'error' }), { status: 400 });
    if (fx.throws === 'network') throw new TypeError('fetch failed: ECONNRESET');
    if (fx.throws === 'timeout') throw new DOMException('The operation timed out.', 'TimeoutError');
    const body = fx.raw ?? JSON.stringify(fx.body);
    return new Response(body, { status: fx.status, headers: fx.headers ?? {} });
  };
  fn.calls = calls;
  return fn;
}

const make = (responses = TD_RESPONSES, extra = {}) =>
  createTwelveDataProvider({ apiKey: KEY, plan: 'basic', fetchImpl: fakeFetch(responses), now: () => NOW, ...extra });

const req = (p, cfg, start, end) => defineRequest({ symbol: p.resolveSymbol(cfg), range: defineRange(start, end) });

// ------------------------------------------------------------------ contract
test('Twelve Data adapter satisfies the shared provider contract', async () => {
  const violations = await checkProviderContract({ provider: make(), symbolConfig: SPY, scenarios: TD_SCENARIOS, secrets: [KEY] });
  assert.deepEqual(violations, []);
});

test('registers in the provider registry under "twelve_data" (matches the seeded symbols)', () => {
  const registry = createProviderRegistry([make()]);
  assert.equal(registry.forSymbol(SPY).id, 'twelve_data');
});

// ------------------------------------------------------------------ request
test('request: exact symbol, 1min, UTC dates, asc, page size, raw prices; key only in the header', async () => {
  const fetchImpl = fakeFetch(TD_RESPONSES);
  const p = make(TD_RESPONSES, { fetchImpl });
  await p.fetchCandles(req(p, SPY, '2026-07-01T13:30:00Z', '2026-07-01T13:33:00Z'));
  const { url, init } = fetchImpl.calls[0];
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://api.twelvedata.com/time_series');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    symbol: 'SPY', interval: '1min', start_date: '2026-07-01T13:30:00', end_date: '2026-07-01T13:32:00', // inclusive: last bar
    timezone: 'UTC', order: 'asc', outputsize: '5000', adjust: 'none',
  });
  assert.ok(!url.includes(KEY), 'API key must never be in the URL');
  assert.equal(init.headers.Authorization, `apikey ${KEY}`);
  assert.equal(init.method, 'GET');
});

test('forex symbol with a slash is sent exactly as configured', () => {
  const p = make();
  const url = buildTimeSeriesUrl(req(p, EURUSD, '2026-07-01T13:30:00Z', '2026-07-01T13:32:00Z'));
  assert.equal(new URL(url).searchParams.get('symbol'), 'EUR/USD');
});

// ------------------------------------------------------------------ normalization
test('UTC datetimes, bar start, exact decimals (trailing zeros kept), volume kept', async () => {
  const p = make();
  const r = await p.fetchCandles(req(p, SPY, '2026-07-01T13:30:00Z', '2026-07-01T13:33:00Z'));
  assert.deepEqual(r.candles[0], {
    timestampUtc: '2026-07-01T13:30:00.000Z', open: '545.12000', high: '545.50000', low: '545.01000', close: '545.40000',
    volume: '120000', provider: 'twelve_data', interval: '1min',
  });
  assert.deepEqual(r.coveredRange, { first: '2026-07-01T13:30:00.000Z', last: '2026-07-01T13:32:00.000Z' });
  assert.ok(r.providerNotes.some((n) => n.includes('api-credits-left=7')));
});

test('DST: 09:30 New York is 13:30Z in July and 14:30Z in January — the adapter never applies offsets', async () => {
  const p = make();
  const summer = await p.fetchCandles(req(p, SPY, '2026-07-01T13:30:00Z', '2026-07-01T13:33:00Z'));
  const winter = await p.fetchCandles(req(p, SPY, '2026-01-15T14:30:00Z', '2026-01-15T14:31:00Z'));
  const ny = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  assert.equal(ny(summer.candles[0].timestampUtc), '09:30');
  assert.equal(ny(winter.candles[0].timestampUtc), '09:30');
});

test('forex rows without volume → volume null, never 0', async () => {
  const p = make(TD_FOREX);
  const r = await p.fetchCandles(req(p, EURUSD, '2026-07-01T13:30:00Z', '2026-07-01T13:32:00Z'));
  assert.equal(r.candles.length, 2);
  assert.ok(r.candles.every((c) => c.volume === null));
  assert.equal(r.candles[0].open, '1.08512');
});

test('tdDatetimeToUtc: only the documented bare format is converted; anything else is left for rejection', () => {
  assert.equal(tdDatetimeToUtc('2026-07-01 13:30:00'), '2026-07-01T13:30:00Z');
  assert.equal(tdDatetimeToUtc('2026-07-01'), '2026-07-01');
  assert.equal(tdDatetimeToUtc('2026-07-01 13:30:00-04:00'), '2026-07-01 13:30:00-04:00');
  assert.equal(tdDatetimeToUtc(undefined), undefined);
});

test('a bar at the exclusive range end, if ever returned, is rejected (belongs to the next range), not stored', async () => {
  const p = make();
  const r = await p.fetchCandles(req(p, SPY, '2026-07-02T13:30:00Z', '2026-07-02T13:32:00Z'));
  assert.equal(r.candles.length, 2);
  assert.deepEqual(r.rejected.map((x) => x.reason), ['OUTSIDE_REQUESTED_RANGE']);
});

test('invalid rows are rejected with reasons; valid rows kept', async () => {
  const p = make();
  const r = await p.fetchCandles(req(p, SPY, '2026-07-03T13:30:00Z', '2026-07-03T13:40:00Z'));
  assert.deepEqual(r.candles.map((c) => c.timestampUtc), ['2026-07-03T13:30:00.000Z', '2026-07-03T13:33:00.000Z']);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['INVALID_DECIMAL', 'INVALID_TIMESTAMP']);
});

// ------------------------------------------------------------------ completeness
test('empty answers are recorded as facts (provider message kept), and count as answered within the safe size', async () => {
  const p = make();
  const caps = p.capabilities();
  const noData = await p.fetchCandles(req(p, SPY, '2026-07-04T13:30:00Z', '2026-07-04T13:40:00Z'));
  assert.equal(noData.candles.length, 0);
  assert.ok(noData.providerNotes.some((n) => n.includes('No data is available')));
  assert.deepEqual(assessCompleteness(noData, caps), { state: 'answered', reason: assessCompleteness(noData, caps).reason, empty: true });
  const empty = await p.fetchCandles(req(p, SPY, '2026-07-05T13:30:00Z', '2026-07-05T13:40:00Z'));
  assert.equal(assessCompleteness(empty, caps).state, 'answered');
});

test('range sizing: 4999 minutes can be answered; 5000 minutes cannot (undetermined → split)', () => {
  const caps = make().capabilities();
  assert.equal(MAX_SAFE_RANGE_MINUTES, 4999);
  const result = (minutes) => ({
    candles: [], rejected: [], truncation: 'unknown',
    requestedRange: defineRange('2026-07-06T00:00:00Z', new Date(Date.parse('2026-07-06T00:00:00Z') + minutes * 60_000)),
  });
  assert.equal(assessCompleteness(result(4999), caps).state, 'answered');
  assert.equal(assessCompleteness(result(5000), caps).state, 'undetermined');
});

test('full page → truncated; the remainder is not guessed (result order unverified) → the importer splits', async () => {
  const p = make();
  const caps = p.capabilities();
  const r = await p.fetchCandles(req(p, SPY, '2026-07-06T00:00:00Z', '2026-07-10T00:00:00Z'));
  assert.equal(r.truncation, 'detected');
  assert.equal(assessCompleteness(r, caps).state, 'truncated');
  assert.throws(() => remainingRange(r, caps), CapabilityNotVerifiedError);
  assert.equal(splitRange(r.requestedRange).length, 2);
  assert.ok(r.providerNotes.some((n) => n.includes('exceeds the safe size')));
});

// ------------------------------------------------------------------ errors
test('rate limit: retry at the next clock minute; daily limit: retry at 00:00 UTC', async () => {
  const p = make();
  await assert.rejects(p.fetchCandles(req(p, SPY, '2026-08-04T13:30:00Z', '2026-08-04T13:40:00Z')), (e) => {
    assert.equal(e.code, 'RATE_LIMITED');
    assert.equal(e.retryAfterMs, 40_000); // NOW is hh:mm:20
    assert.equal(e.retryPolicy, 'wait_then_retry');
    return true;
  });
  await assert.rejects(p.fetchCandles(req(p, SPY, '2026-08-05T13:30:00Z', '2026-08-05T13:40:00Z')), (e) => {
    assert.equal(e.code, 'QUOTA_EXHAUSTED');
    assert.equal(e.retryAfterMs, Date.parse('2026-08-05T00:00:00Z') - Date.parse('2026-08-04T13:30:20Z'));
    return true;
  });
});

test('a longer Retry-After from the provider is honoured', async () => {
  const p = make();
  await assert.rejects(p.fetchCandles(req(p, SPY, '2026-08-12T13:30:00Z', '2026-08-12T13:40:00Z')), (e) => e.code === 'RATE_LIMITED' && e.retryAfterMs === 90_000);
});

test('human-action errors are not retried automatically', () => {
  for (const code of ['AUTH_FAILED', 'PLAN_RESTRICTED', 'SYMBOL_NOT_FOUND', 'MALFORMED_RESPONSE']) {
    assert.equal(retryPolicyFor(code), 'needs_human');
  }
});

test('the API key never appears in errors, even when the provider echoes it', async () => {
  const echo = { '2026-08-01T13:30:00': { status: 401, body: { code: 401, message: `Key ${KEY} is invalid`, status: 'error' } } };
  const p = make(echo);
  await assert.rejects(p.fetchCandles(req(p, SPY, '2026-08-01T13:30:00Z', '2026-08-01T13:40:00Z')), (e) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.code, 'AUTH_FAILED');
    assert.ok(!e.message.includes(KEY) && !String(e.detail).includes(KEY));
    return true;
  });
});

test('helpers: minute and midnight waits, Retry-After parsing', () => {
  assert.equal(msToNextMinute(Date.parse('2026-01-01T00:00:59.500Z')), 500);
  assert.equal(msToUtcMidnight(Date.parse('2026-01-01T23:00:00Z')), 3_600_000);
  assert.equal(parseRetryAfter('5', 0), 5000);
  assert.equal(parseRetryAfter(null, 0), undefined);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 0), 10_000);
});

// ------------------------------------------------------------------ configuration
test('missing API key → AUTH_FAILED with instructions; unverified plan is refused', () => {
  assert.throws(() => createTwelveDataProvider({ apiKey: '', plan: 'basic' }), (e) => e.code === 'AUTH_FAILED' && /Edge Function secret/.test(e.message));
  assert.throws(() => createTwelveDataProvider({ apiKey: KEY, plan: 'grow' }), /Unverified Twelve Data plan/);
});

test('capabilities: Basic plan limits and live-check facts verified with sources', () => {
  const caps = make().capabilities();
  assert.deepEqual(requireVerified(caps, 'markets'), ['us_stock', 'forex', 'crypto', 'gold']);
  assert.deepEqual(requireVerified(caps, 'volume'), { us_stock: true, forex: false, crypto: false, gold: false });
  assert.equal(requireVerified(caps, 'rateLimit').creditsPerMinute, 8);
  assert.equal(requireVerified(caps, 'quota').creditsPerDay, 800);
  assert.equal(requireVerified(caps, 'pageSize'), 5000);
  for (const k of ['historyDepth', 'resultOrder']) assert.equal(isVerified(caps, k), false, k);
  for (const [k, f] of Object.entries(caps.facts)) if (f.verified) assert.match(f.source, /2026-09-25|derived/, k);
});

test('adapter code reads no environment variables and has no key literal', async () => {
  const dir = new URL('../../supabase/functions/_shared/adapters/twelve_data/', import.meta.url);
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.js'))) {
    const text = await readFile(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /Deno\.env|process\.env|apikey=|from\s+['"]node:/, f);
    for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) assert.match(m[1], /\.js$/, f);
  }
});
