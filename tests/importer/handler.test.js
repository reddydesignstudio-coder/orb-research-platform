/**
 * importer Edge Function handler + PostgREST store (TASK 008).
 * A fake PostgREST (unique key, ignore-duplicates) and Twelve Data fixtures;
 * no network, no real keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImporterHandler } from '../../supabase/functions/_shared/importer/handler.js';

const SECRET = ['sb', 'secret', 'importfake0123456789'].join('_');
const TD_KEY = ['td', 'live', 'importfake98765'].join('_');
const BASE = 'https://project.supabase.test';
const NOW = Date.parse('2026-09-25T12:00:00Z');

const SYMBOLS = [
  { id: 1, symbol: 'SPY', market: 'us_stock', provider: 'twelve_data', provider_symbol: 'SPY', enabled: true },
];

/** Minimal PostgREST behaviour for the tables the importer uses. */
function fakeBackend({ tdRows = {}, tdErrors = {} } = {}) {
  const db = { jobs: [], candles: [], requests: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    db.requests.push({ method, path: u.pathname, params: Object.fromEntries(u.searchParams), headers: init.headers ?? {} });

    if (u.hostname === 'api.twelvedata.com') {
      const start = u.searchParams.get('start_date');
      if (tdErrors[start]) return new Response(JSON.stringify(tdErrors[start]), { status: 200 });
      const values = tdRows[start] ?? [];
      if (!values.length) return Response.json({ code: 400, message: 'No data is available on the specified dates.', status: 'error' });
      return Response.json({ meta: { symbol: u.searchParams.get('symbol'), interval: '1min' }, values, status: 'ok' });
    }
    if (u.origin !== BASE) throw new TypeError('fetch failed: unexpected host');
    if (init.headers?.apikey !== SECRET) return new Response('{"message":"bad key"}', { status: 401 });

    const table = u.pathname.replace('/rest/v1/', '');
    const body = init.body ? JSON.parse(init.body) : null;
    if (table === 'symbols' && method === 'GET') {
      const want = u.searchParams.get('symbol').replace(/^eq\./, '');
      return Response.json(SYMBOLS.filter((s) => s.symbol === want));
    }
    if (table === 'import_jobs' && method === 'POST') {
      const row = { id: db.jobs.length + 1, received_count: 0, inserted_count: 0, duplicate_count: 0, ...body[0] };
      db.jobs.push(row);
      return Response.json([{ id: row.id }], { status: 201 });
    }
    if (table === 'import_jobs' && method === 'PATCH') {
      const id = Number(u.searchParams.get('id').replace(/^eq\./, ''));
      Object.assign(db.jobs[id - 1], body);
      return Response.json([db.jobs[id - 1]]);
    }
    if (table === 'candles' && method === 'POST') {
      assert.equal(u.searchParams.get('on_conflict'), 'symbol_id,interval,timestamp_utc');
      assert.match(init.headers.prefer, /resolution=ignore-duplicates/);
      const inserted = [];
      for (const r of body) {
        const dup = db.candles.some((c) => c.symbol_id === r.symbol_id && c.interval === r.interval && c.timestamp_utc === r.timestamp_utc);
        if (!dup) {
          const row = { id: db.candles.length + 1, ...r };
          db.candles.push(row);
          inserted.push({ id: row.id });
        }
      }
      return Response.json(inserted, { status: 201 });
    }
    return new Response('{"message":"not found"}', { status: 404 });
  };
  return { db, fetchImpl };
}

const bars = (startIso, n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(startIso) + i * 60_000).toISOString();
    return { datetime: `${d.slice(0, 10)} ${d.slice(11, 19)}`, open: '100.10', high: '100.50', low: '100.00', close: '100.40', volume: '1000' };
  });

function handler(backend, env = {}) {
  const vars = { SUPABASE_URL: BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }), TWELVE_DATA_API_KEY: TD_KEY, ...env };
  return createImporterHandler({ env: (n) => vars[n], fetchImpl: backend.fetchImpl, now: () => NOW, newRunId: () => '11111111-2222-4333-8444-555555555555', log: () => {} });
}

const post = (body, key = SECRET) =>
  new Request('https://fn.test/importer', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { apikey: key } : {}) }, body: JSON.stringify(body) });

const read = async (res) => {
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
};

// ------------------------------------------------------------------
test('imports an opening window: job recorded with run id and counts; 90 candles stored with provider', async () => {
  const backend = fakeBackend({ tdRows: { '2026-09-24T13:30:00': bars('2026-09-24T13:30:00Z', 90) } });
  const r = await read(await handler(backend)(post({ symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' })));
  assert.equal(r.status, 200);
  assert.equal(r.json.runId, '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(r.json.totals, { received: 90, inserted: 90, duplicates: 0 });
  assert.equal(backend.db.jobs.length, 1);
  const job = backend.db.jobs[0];
  assert.deepEqual(
    [job.run_id, job.symbol_id, job.provider, job.status, job.received_count, job.inserted_count, job.duplicate_count],
    ['11111111-2222-4333-8444-555555555555', 1, 'twelve_data', 'succeeded', 90, 90, 0],
  );
  assert.equal(backend.db.candles.length, 90);
  assert.deepEqual(backend.db.candles[0], {
    id: 1, symbol_id: 1, timestamp_utc: '2026-09-24T13:30:00.000Z', open: '100.10', high: '100.50', low: '100.00', close: '100.40',
    volume: '1000', provider: 'twelve_data', interval: '1min',
  });
  assert.ok(!r.text.includes(SECRET) && !r.text.includes(TD_KEY));
});

test('second run over the same range: duplicates counted, nothing stored twice', async () => {
  const backend = fakeBackend({ tdRows: { '2026-09-24T13:30:00': bars('2026-09-24T13:30:00Z', 90) } });
  const h = handler(backend);
  await h(post({ symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' }));
  const r = await read(await h(post({ symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' })));
  assert.deepEqual(r.json.totals, { received: 90, inserted: 0, duplicates: 90 });
  assert.equal(backend.db.candles.length, 90);
  assert.equal(backend.db.jobs.length, 2);
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
  assert.equal((Date.parse(a.requested_end) - Date.parse(a.requested_start)) / 60_000, 4999);
  assert.equal(r.json.nextStartUtc, new Date(Date.parse('2026-08-01T00:00:00Z') + 2 * 4999 * 60_000).toISOString());
});

test('provider rate limit is recorded on the job and the run stops', async () => {
  const backend = fakeBackend({ tdErrors: { '2026-09-24T13:30:00': { code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' } } });
  const r = await read(await handler(backend)(post({ symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' })));
  assert.equal(r.status, 200);
  const job = backend.db.jobs[0];
  assert.deepEqual([job.status, job.error_code, job.next_retry_at], ['rate_limited', 'RATE_LIMITED', '2026-09-25T12:01:00.000Z']);
  assert.equal(r.json.stoppedReason, 'RATE_LIMITED');
});

// ------------------------------------------------------------------ refusals
test('refuses callers without a secret key, future ranges, and job counts above the plan limit', async () => {
  const backend = fakeBackend();
  const h = handler(backend);
  assert.equal((await h(post({ symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' }, null))).status, 401);
  const future = await read(await h(post({ symbol: 'SPY', startUtc: '2026-09-25T11:00:00Z', endUtc: '2026-09-25T12:01:00Z' })));
  assert.equal(future.status, 400);
  assert.match(future.json.error.message, /future/);
  const tooMany = await read(await h(post({ symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z', maxJobs: 8 })));
  assert.match(tooMany.json.error.message, /1 to 7/);
  assert.equal((await h(post({ symbol: 'NOPE', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' }))).status, 404);
  assert.equal(backend.db.jobs.length, 0, 'no job created for refused requests');
});

test('missing provider key → AUTH_FAILED before any job is created', async () => {
  const backend = fakeBackend();
  const r = await read(await handler(backend, { TWELVE_DATA_API_KEY: undefined })(post({ symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' })));
  assert.equal(r.json.error.code, 'AUTH_FAILED');
  assert.equal(backend.db.jobs.length, 0);
});
