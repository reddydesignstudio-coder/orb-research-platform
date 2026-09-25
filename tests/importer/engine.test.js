/** Import job engine (TASK 008): windows, job records, storage, stopping rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWindows, runImport } from '../../supabase/functions/_shared/importer/engine.js';
import { compareDecimal, validateCandles } from '../../supabase/functions/_shared/importer/validate.js';
import { defineRange, verified } from '../../supabase/functions/_shared/providers/mod.js';
import { createFakeProvider, FAKE_ID } from '../providers/fixtures/fake-provider.js';
import { createMemoryStore } from './memory-store.js';

const KEY = ['fk', 'import', 'secret0123456789'].join('_');
const SYMBOL = Object.freeze({ id: 7, symbol: 'SPY', provider: FAKE_ID, provider_symbol: 'SPY', market: 'us_stock', enabled: true });
const NOW = Date.parse('2026-09-25T12:00:30Z');

/** Rows for minutes [from, from+n) of a UTC day, as the fake provider's format. */
function rows(startIso, n, { bad = [] } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(Date.parse(startIso) + i * 60_000).toISOString();
    out.push(bad.includes(i) ? { t, o: '10', h: '9', l: '9.5', c: '10', v: '1' } : { t, o: '10', h: '10.5', l: '9.5', c: '10.2', v: '1' });
  }
  return out;
}

const W1 = '2026-09-24T13:30:00.000Z';
const W2 = '2026-09-24T13:40:00.000Z';
const W3 = '2026-09-24T13:50:00.000Z';

function provider(responses) {
  return createFakeProvider({
    apiKey: KEY,
    responses,
    facts: { maxSafeRangeMinutes: verified(10, 'test fixture') },
  });
}

const run = (responses, opts = {}) => {
  const store = opts.store ?? createMemoryStore();
  return runImport({
    runId: 'run-1',
    symbolRow: SYMBOL,
    config: SYMBOL,
    provider: provider(responses),
    range: defineRange(opts.start ?? W1, opts.end ?? '2026-09-24T14:00:00Z'),
    store,
    maxJobs: opts.maxJobs ?? 7,
    now: () => NOW,
    secrets: [KEY],
  }).then((summary) => ({ summary, store }));
};

const OK3 = {
  [W1]: { more: false, rows: rows(W1, 10) },
  [W2]: { more: false, rows: rows(W2, 10) },
  [W3]: { more: false, rows: rows(W3, 10) },
};

// ------------------------------------------------------------------ planning
test('planWindows: consecutive half-open windows of at most the safe size, no gaps or overlaps', () => {
  const w = planWindows(defineRange('2026-09-24T00:00:00Z', '2026-09-24T00:25:00Z'), 10);
  assert.deepEqual(w.map((x) => [x.startUtc.slice(11, 16), x.endUtc.slice(11, 16), x.minutes]), [
    ['00:00', '00:10', 10], ['00:10', '00:20', 10], ['00:20', '00:25', 5],
  ]);
  assert.equal(planWindows(defineRange('2026-09-24T00:00:00Z', '2026-09-24T00:20:00Z'), 10).length, 2);
  assert.equal(planWindows(defineRange('2026-09-24T00:00:00Z', '2026-09-24T00:01:00Z'), 4999).length, 1);
  assert.throws(() => planWindows(defineRange('2026-09-24T00:00:00Z', '2026-09-24T00:01:00Z'), 0));
});

// ------------------------------------------------------------------ happy path
test('one run: one job per window, all succeeded, candles stored once, counts recorded', async () => {
  const { summary, store } = await run(OK3);
  assert.equal(summary.runId, 'run-1');
  assert.equal(summary.windows, 3);
  assert.deepEqual(summary.jobs.map((j) => j.status), ['succeeded', 'succeeded', 'succeeded']);
  assert.deepEqual(summary.totals, { received: 30, inserted: 30, duplicates: 0 });
  assert.equal(summary.stoppedReason, null);
  assert.equal(summary.nextStartUtc, null);
  assert.equal(store.candles.size, 30);
  const job = store.jobs.get(1);
  assert.deepEqual(
    [job.run_id, job.symbol_id, job.provider, job.interval, job.requested_start, job.requested_end, job.started_at, job.completed_at],
    ['run-1', 7, FAKE_ID, '1min', W1, W2, '2026-09-25T12:00:30.000Z', '2026-09-25T12:00:30.000Z'],
  );
});

test('re-running the same range stores nothing twice: every candle counted as a duplicate', async () => {
  const store = createMemoryStore();
  await run(OK3, { store });
  const { summary } = await run(OK3, { store });
  assert.deepEqual(summary.totals, { received: 30, inserted: 0, duplicates: 30 });
  assert.equal(store.candles.size, 30);
});

test('an answered window with no candles succeeds and is recorded as a fact, not interpreted', async () => {
  const { summary, store } = await run({ [W1]: { more: false, rows: [] } }, { end: W2 });
  assert.equal(summary.jobs[0].status, 'succeeded');
  assert.equal(summary.jobs[0].received_count, 0);
  assert.equal(store.candles.size, 0);
});

// ------------------------------------------------------------------ validation
test('invalid OHLC rows are not stored and are reported; the rest of the window is kept', async () => {
  const { summary, store } = await run({ [W1]: { more: false, rows: rows(W1, 10, { bad: [3, 4] }) } }, { end: W2 });
  const j = summary.jobs[0];
  assert.equal(j.status, 'succeeded');
  assert.deepEqual([j.received_count, j.inserted_count, j.duplicate_count], [10, 8, 0]);
  assert.match(j.error_message, /2 row\(s\) not stored: HIGH_NOT_HIGHEST ×2/);
  assert.equal(store.candles.size, 8);
});

test('validateCandles / compareDecimal: exact decimal comparison, no float rounding', () => {
  assert.equal(compareDecimal('10.50', '10.5'), 0);
  assert.equal(compareDecimal('9.99999999999999999', '10'), -1);
  assert.equal(compareDecimal('010', '9'), 1);
  assert.equal(compareDecimal('0.1', '0.10000000000000001'), -1);
  const base = { open: '10', high: '11', low: '9', close: '10.5' };
  assert.equal(validateCandles([base]).valid.length, 1);
  assert.equal(validateCandles([{ ...base, open: '0' }]).invalid[0].reason, 'NON_POSITIVE_PRICE');
  assert.equal(validateCandles([{ ...base, close: '11.0000001' }]).invalid[0].reason, 'HIGH_NOT_HIGHEST');
  assert.equal(validateCandles([{ ...base, open: '8.9' }]).invalid[0].reason, 'LOW_NOT_LOWEST');
  assert.equal(validateCandles([{ open: '5', high: '5', low: '5', close: '5' }]).valid.length, 1, 'flat candle is valid');
});

// ------------------------------------------------------------------ stopping rules
test('a failed window stops the run there: later windows are not attempted, resume point = failed window', async () => {
  const { summary, store } = await run({ ...OK3, [W2]: { failure: { status: 503, message: 'down' } } });
  assert.deepEqual(summary.jobs.map((j) => j.status), ['succeeded', 'failed']);
  assert.equal(summary.jobs[1].error_code, 'PROVIDER_UNAVAILABLE');
  assert.equal(summary.stoppedReason, 'PROVIDER_UNAVAILABLE');
  assert.equal(summary.nextStartUtc, W2);
  assert.equal(store.jobs.size, 2, 'window 3 was never requested');
  assert.equal(store.candles.size, 10);
});

test('rate limit → rate_limited with next_retry_at = now + the provider wait', async () => {
  const { summary } = await run({ [W1]: { failure: { status: 429, message: 'slow down', retryAfterSeconds: 30 } } });
  const j = summary.jobs[0];
  assert.equal(j.status, 'rate_limited');
  assert.equal(j.error_code, 'RATE_LIMITED');
  assert.equal(j.next_retry_at, '2026-09-25T12:01:00.000Z');
  assert.equal(summary.nextStartUtc, W1);
});

test('incomplete window (truncation) → partial: what arrived is stored, window not done, run stops', async () => {
  const { summary, store } = await run({ ...OK3, [W1]: { more: true, rows: rows(W1, 4) } });
  const j = summary.jobs[0];
  assert.equal(j.status, 'partial');
  assert.equal(j.error_code, 'RANGE_NOT_COMPLETE');
  assert.equal(j.inserted_count, 4);
  assert.equal(summary.stoppedReason, 'RANGE_NOT_COMPLETE');
  assert.equal(summary.nextStartUtc, W1);
  assert.equal(store.candles.size, 4);
});

test('job limit: the run stops before the next window and says where to resume', async () => {
  const { summary, store } = await run(OK3, { maxJobs: 2 });
  assert.equal(summary.jobs.length, 2);
  assert.equal(summary.stoppedReason, 'JOB_LIMIT_REACHED');
  assert.equal(summary.nextStartUtc, W3);
  assert.equal(store.jobs.size, 2);
});

test('database failure while storing → failed DATABASE_ERROR, run stops, secrets redacted', async () => {
  const err = Object.assign(new Error(`insert failed using ${KEY}`), { name: 'RestError' });
  const { summary } = await run(OK3, { store: createMemoryStore({ failInsert: err }) });
  const j = summary.jobs[0];
  assert.equal(j.status, 'failed');
  assert.equal(j.error_code, 'DATABASE_ERROR');
  assert.ok(!j.error_message.includes(KEY));
  assert.equal(summary.nextStartUtc, W1);
});

test('provider error messages are recorded without the provider key', async () => {
  const { summary } = await run({ [W1]: { failure: { status: 401, message: 'bad key' } } });
  assert.equal(summary.jobs[0].error_code, 'AUTH_FAILED');
  assert.ok(!summary.jobs[0].error_message.includes(KEY));
});
