/**
 * importer Edge Function handler + PostgREST store (TASK 008, TASK 009).
 * Fake PostgREST and Twelve Data (tests/importer/fake-backend.js); no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImporterHandler } from '../../supabase/functions/_shared/importer/handler.js';
import { BASE, SECRET, TD_KEY, bars, fakeBackend } from './fake-backend.js';

const NOW = Date.parse('2026-09-25T12:00:20Z'); // settled until 11:30Z
const RUN_ID = '11111111-2222-4333-8444-555555555555';

function handler(backend, env = {}, now = NOW) {
  const vars = { SUPABASE_URL: BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }), TWELVE_DATA_API_KEY: TD_KEY, ...env };
  return createImporterHandler({ env: (n) => vars[n], fetchImpl: backend.fetchImpl, now: () => now, newRunId: () => RUN_ID, log: () => {} });
}

const post = (body, key = SECRET) =>
  new Request('https://fn.test/importer', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { apikey: key } : {}) }, body: JSON.stringify(body) });

const read = async (res) => {
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
};

const OPEN = { symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' };
const OPEN_BARS = { '2026-09-24T13:30:00': bars('2026-09-24T13:30:00Z', 90) };

// ------------------------------------------------------------------ TASK 008 behaviour
test('imports an opening window: job with run id and counts; 90 candles stored with provider', async () => {
  const backend = fakeBackend({ tdRows: OPEN_BARS });
  const r = await read(await handler(backend)(post(OPEN)));
  assert.equal(r.status, 200);
  assert.equal(r.json.runId, RUN_ID);
  assert.deepEqual(r.json.totals, { received: 90, inserted: 90, duplicates: 0 });
  const job = backend.db.jobs[0];
  assert.deepEqual(
    [job.run_id, job.symbol_id, job.provider, job.status, job.received_count, job.inserted_count, job.duplicate_count],
    [RUN_ID, 1, 'twelve_data', 'succeeded', 90, 90, 0],
  );
  assert.deepEqual(backend.db.candles[0], {
    id: 1, symbol_id: 1, timestamp_utc: '2026-09-24T13:30:00.000Z', open: '100.10', high: '100.50', low: '100.00', close: '100.40',
    volume: '1000', provider: 'twelve_data', interval: '1min',
  });
  assert.ok(!r.text.includes(SECRET) && !r.text.includes(TD_KEY));
});

test('weekend window answered with "no data" → succeeded with the provider message recorded', async () => {
  const backend = fakeBackend();
  const r = await read(await handler(backend)(post({ symbol: 'SPY', startUtc: '2026-09-19T13:30:00Z', endUtc: '2026-09-19T15:00:00Z' })));
  assert.equal(r.json.jobs[0].status, 'succeeded');
  assert.match(backend.db.jobs[0].error_message, /No data is available/);
});

test('a long range is split into safe windows (≤ 4 999 min) and limited by maxJobs', async () => {
  const backend = fakeBackend();
  const r = await read(await handler(backend)(post({ symbol: 'SPY', startUtc: '2026-08-01T00:00:00Z', endUtc: '2026-09-01T00:00:00Z', maxJobs: 2 })));
  assert.equal(r.json.windows, 9); // 44 640 min / 4 999
  assert.equal(r.json.jobs.length, 2);
  assert.equal(r.json.stoppedReason, 'JOB_LIMIT_REACHED');
  const [a, b] = backend.db.jobs;
  assert.equal(a.requested_end, b.requested_start, 'windows are contiguous');
  assert.equal(r.json.nextStartUtc, new Date(Date.parse('2026-08-01T00:00:00Z') + 2 * 4999 * 60_000).toISOString());
});

test('provider rate limit is recorded on the job and the run stops', async () => {
  const backend = fakeBackend({ tdErrors: { '2026-09-24T13:30:00': { code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' } } });
  const r = await read(await handler(backend)(post(OPEN)));
  const job = backend.db.jobs[0];
  assert.deepEqual([job.status, job.error_code, job.next_retry_at], ['rate_limited', 'RATE_LIMITED', '2026-09-25T12:01:00.000Z']);
  assert.equal(r.json.stoppedReason, 'RATE_LIMITED');
  assert.equal(r.json.checkpointUtc, null, 'nothing answered, no checkpoint');
});

// ------------------------------------------------------------------ TASK 009: checkpoint & resume
test('repeating a run requests nothing already answered (no provider call, no credit, no duplicates)', async () => {
  const backend = fakeBackend({ tdRows: OPEN_BARS });
  const h = handler(backend);
  await h(post(OPEN));
  const r = await read(await h(post(OPEN)));
  assert.equal(r.json.alreadyAnsweredMinutes, 90);
  assert.equal(r.json.windows, 0);
  assert.deepEqual(r.json.jobs, []);
  assert.equal(backend.db.tdCalls.length, 1, 'provider called once in total');
  assert.equal(backend.db.candles.length, 90);
});

test('import_progress is refreshed from stored candles; common dataset stays null until every enabled symbol has data', async () => {
  const backend = fakeBackend({ tdRows: OPEN_BARS });
  const r = await read(await handler(backend)(post(OPEN)));
  assert.deepEqual(r.json.progress, {
    symbol_id: 1, provider: 'twelve_data', interval: '1min',
    first_timestamp_utc: '2026-09-24T13:30:00.000Z', last_timestamp_utc: '2026-09-24T14:59:00.000Z', candle_count: 90,
    common_dataset_timestamp: null, // QQQ has no candles yet
  });
  assert.equal(r.json.historyStartUtc, '2026-09-24T13:30:00.000Z');
  assert.equal(r.json.checkpointUtc, '2026-09-24T15:00:00.000Z');
});

test('an interrupted run resumes at the failed window: completed windows are not requested again', async () => {
  const W = ['2026-09-20T00:00:00Z', '2026-09-23T11:19:00Z']; // one 4 999-minute step; the rest fits one window
  const tdStart = (iso) => iso.slice(0, 19);
  const backend = fakeBackend({ tdErrors: { [tdStart(W[1])]: { code: 500, message: 'Internal error', status: 'error' } } });
  const h = handler(backend);
  const first = await read(await h(post({ symbol: 'SPY', startUtc: W[0], endUtc: '2026-09-25T11:30:00Z' })));
  assert.deepEqual(first.json.jobs.map((j) => j.status), ['succeeded', 'failed']);
  assert.equal(first.json.checkpointUtc, '2026-09-23T11:19:00.000Z');

  // Provider recovers; "continue" picks up exactly at the checkpoint.
  const recovered = fakeBackend({ jobs: backend.db.jobs });
  const r = await read(await handler(recovered)(post({ symbol: 'SPY', continue: true })));
  assert.equal(r.json.mode, 'continue');
  assert.deepEqual(recovered.db.tdCalls, [tdStart(W[1])], 'first window not requested again');
  assert.equal(r.json.checkpointUtc, '2026-09-25T11:30:00.000Z');
  assert.equal(r.json.stoppedReason, null);
});

test('jobs left "running" by an interrupted run are closed as INTERRUPTED and their window is redone', async () => {
  const stale = {
    run_id: 'old', symbol_id: 1, provider: 'twelve_data', interval: '1min', status: 'running',
    requested_start: '2026-09-24T13:30:00.000Z', requested_end: '2026-09-24T15:00:00.000Z', started_at: '2026-09-25T11:00:00.000Z',
  };
  const done = { ...stale, run_id: 'older', status: 'succeeded', requested_start: '2026-09-24T12:00:00.000Z', requested_end: '2026-09-24T13:30:00.000Z', started_at: '2026-09-25T10:00:00.000Z' };
  const backend = fakeBackend({ tdRows: OPEN_BARS, jobs: [done, stale] });
  const r = await read(await handler(backend)(post({ symbol: 'SPY', continue: true, maxJobs: 1 })));
  assert.equal(r.json.interruptedJobsClosed, 1);
  assert.deepEqual([backend.db.jobs[1].status, backend.db.jobs[1].error_code], ['failed', 'INTERRUPTED']);
  assert.equal(backend.db.tdCalls[0], '2026-09-24T13:30:00', 'resumes at the interrupted window');
});

test('a job that is still running (recent) is not touched', async () => {
  const recent = {
    run_id: 'x', symbol_id: 1, provider: 'twelve_data', interval: '1min', status: 'running',
    requested_start: '2026-09-24T13:30:00.000Z', requested_end: '2026-09-24T15:00:00.000Z', started_at: '2026-09-25T11:55:00.000Z',
  };
  const backend = fakeBackend({ tdRows: OPEN_BARS, jobs: [recent] });
  const r = await read(await handler(backend)(post(OPEN)));
  assert.equal(r.json.interruptedJobsClosed, 0);
  assert.equal(backend.db.jobs[0].status, 'running');
});

test('continue: needs existing history; reports up-to-date without calling the provider', async () => {
  const empty = fakeBackend();
  const none = await read(await handler(empty)(post({ symbol: 'SPY', continue: true })));
  assert.equal(none.status, 409);
  assert.equal(none.json.error.code, 'NO_HISTORY_YET');

  const upToDate = fakeBackend({
    jobs: [{ run_id: 'r', symbol_id: 1, provider: 'twelve_data', interval: '1min', status: 'succeeded', requested_start: '2026-09-24T00:00:00.000Z', requested_end: '2026-09-25T11:30:00.000Z', started_at: '2026-09-25T11:40:00.000Z' }],
  });
  const r = await read(await handler(upToDate)(post({ symbol: 'SPY', continue: true })));
  assert.equal(r.json.upToDate, true);
  assert.equal(r.json.checkpointUtc, '2026-09-25T11:30:00.000Z');
  assert.equal(upToDate.db.tdCalls.length, 0);
});

test('checkpoint semantics follow answered ranges, not the last candle (a weekend is answered too)', async () => {
  const backend = fakeBackend({ tdRows: { '2026-09-18T20:00:00': bars('2026-09-18T20:00:00Z', 1) } }); // Fri 16:00 ET bar only
  const r = await read(await handler(backend)(post({ symbol: 'SPY', startUtc: '2026-09-18T20:00:00Z', endUtc: '2026-09-21T13:00:00Z' })));
  assert.equal(r.json.progress.last_timestamp_utc, '2026-09-18T20:00:00.000Z');
  assert.equal(r.json.checkpointUtc, '2026-09-21T13:00:00.000Z', 'weekend counted as answered');
});

// ------------------------------------------------------------------ refusals
test('refusals: no secret key, unsettled minutes, maxJobs above plan limit, unknown symbol, mixed modes', async () => {
  const backend = fakeBackend();
  const h = handler(backend);
  assert.equal((await h(post(OPEN, null))).status, 401);
  const unsettled = await read(await h(post({ symbol: 'SPY', startUtc: '2026-09-25T11:00:00Z', endUtc: '2026-09-25T11:31:00Z' })));
  assert.equal(unsettled.status, 400);
  assert.match(unsettled.json.error.message, /at least 30 minutes ago/);
  assert.equal((await h(post({ symbol: 'SPY', startUtc: '2026-09-25T11:00:00Z', endUtc: '2026-09-25T11:30:00Z' }))).status, 200, 'exactly settled is allowed');
  const tooMany = await read(await h(post({ ...OPEN, maxJobs: 8 })));
  assert.match(tooMany.json.error.message, /1 to 7/);
  assert.equal((await h(post({ ...OPEN, symbol: 'NOPE' }))).status, 404);
  assert.equal((await h(post({ ...OPEN, continue: true }))).status, 400);
});

test('missing provider key → AUTH_FAILED before any job is created', async () => {
  const backend = fakeBackend();
  const r = await read(await handler(backend, { TWELVE_DATA_API_KEY: undefined })(post(OPEN)));
  assert.equal(r.json.error.code, 'AUTH_FAILED');
  assert.equal(backend.db.jobs.length, 0);
});
