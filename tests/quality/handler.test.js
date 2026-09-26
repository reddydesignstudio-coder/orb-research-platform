/** data-quality function (TASK 014, D-029) against a fake PostgREST: pending, range, refusals. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataQualityHandler } from '../../supabase/functions/_shared/quality/handler.js';
import { firstSessionDate, pendingSessions } from '../../supabase/functions/_shared/quality/run.js';
import { BASE, SECRET, candlesFrom, fakeDb, job } from './fake-db.js';

const HISTORY = '2025-09-26T00:00:00.000Z';
const NOW = Date.parse('2025-10-08T12:00:00Z');
const env = (n) => ({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }), SUPABASE_URL: BASE }[n]);
const call = async (fetchImpl, body, key = SECRET) => {
  const h = createDataQualityHandler({ env, fetchImpl, now: () => NOW, log: () => {}, historyStartUtc: HISTORY });
  const res = await h(new Request('https://x/functions/v1/data-quality', { method: 'POST', headers: { apikey: key }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
};
// EDT: 09:30 NY = 13:30Z
const day = (d) => `${d}T13:30:00.000Z`;

function scenario() {
  const candles = [
    ...candlesFrom(1, day('2025-09-26'), 90),                 // Fri complete
    ...candlesFrom(1, day('2025-09-29'), 90, [0, 1, 2]),      // Mon incomplete
    // Tue 30 Sep: nothing stored → no_data
    ...candlesFrom(1, day('2025-10-01'), 90),                 // Wed complete (answered only up to here)
    ...candlesFrom(2, day('2025-09-26'), 90), ...candlesFrom(2, day('2025-09-27'), 90), ...candlesFrom(2, day('2025-09-28'), 90),
  ];
  const jobs = [job(1, HISTORY, '2025-10-02T00:00:00.000Z'), job(2, HISTORY, '2025-09-29T00:00:00.000Z')];
  return fakeDb({ jobs, candles });
}

test('firstSessionDate: history 26 Sep 00:00Z → first NY session is 26 Sep (25 Sep 09:30 NY is before the start)', () => {
  assert.equal(firstSessionDate({ symbol: 'SPY', market: 'us_stock', session_timezone: 'America/New_York', session_start: '09:30', session_end: '11:00' }, HISTORY), '2025-09-26');
});

test('pending: checks answered sessions only, stops at the import frontier, weekends are market_closed', async () => {
  const { db, fetchImpl } = scenario();
  const { status, json } = await call(fetchImpl, { pending: true });
  assert.equal(status, 200, JSON.stringify(json));
  const spy = json.perSymbol.find((p) => p.symbol === 'SPY');
  assert.deepEqual(spy.byStatus, { complete: 2, market_closed: 2, incomplete: 1, no_data: 1 });
  assert.equal(spy.checkedThrough, '2025-10-01');
  assert.equal(spy.waitingForImportFrom, '2025-10-02');
  assert.deepEqual(spy.problems, ['2025-09-29 incomplete 87/90 missing 09:30–09:32', '2025-09-30 no_data 0/90']);
  const btc = json.perSymbol.find((p) => p.symbol === 'BTC/USD');
  assert.deepEqual([btc.checked, btc.byStatus.complete, btc.waitingForImportFrom], [3, 3, '2025-09-29'], 'crypto: weekends are open');
  assert.equal(json.perSymbol.find((p) => p.symbol === 'NOSESS').skipped, 'SESSION_NOT_DEFINED');
  assert.equal(db.quality.length, 9);
  const row = db.quality.find((q) => q.symbol_id === 1 && q.session_date === '2025-09-29');
  assert.deepEqual([row.expected_candles, row.actual_candles, row.missing_candles, row.checked_at], [90, 87, 3, new Date(NOW).toISOString()]);

  // Second call: nothing new until the importer moves on.
  const again = await call(fetchImpl, { pending: true });
  assert.equal(again.json.checked, 0);
  assert.equal(again.json.more, false);
});

test('pending: perSymbol limits each call and reports more', async () => {
  const { fetchImpl } = scenario();
  const r = await call(fetchImpl, { pending: true, perSymbol: 2 });
  assert.equal(r.json.perSymbol.find((p) => p.symbol === 'SPY').checked, 2);
  assert.equal(r.json.more, true);
  const r2 = await call(fetchImpl, { pending: true, perSymbol: 2 });
  assert.equal(r2.json.perSymbol.find((p) => p.symbol === 'SPY').checkedThrough, '2025-09-29');
});

test('range: re-checks and overwrites answered sessions, lists the ones not yet imported', async () => {
  const { db, fetchImpl } = scenario();
  await call(fetchImpl, { pending: true });
  const r = await call(fetchImpl, { symbol: 'SPY', from: '2025-09-29', to: '2025-10-04' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.checked, r.json.notYetImported], [3, ['2025-10-02', '2025-10-03']]);
  assert.equal(r.json.sessions[0].details.missing[0], '09:30–09:32');
  assert.equal(db.quality.filter((q) => q.symbol_id === 1).length, 6, 'upsert: no duplicate rows');
});

test('refusals: key, body, unknown symbol, bad range, no session', async () => {
  const { fetchImpl } = scenario();
  assert.equal((await call(fetchImpl, { pending: true }, 'sb_secret_wrongwrongwrong')).status, 401);
  assert.equal((await call(fetchImpl, {})).json.error.code, 'BAD_REQUEST');
  assert.equal((await call(fetchImpl, { pending: true, perSymbol: 0 })).status, 400);
  assert.equal((await call(fetchImpl, { pending: true, symbol: 'SPY' })).status, 400);
  assert.equal((await call(fetchImpl, { symbol: 'NOPE', from: '2025-10-01', to: '2025-10-02' })).json.error.code, 'UNKNOWN_SYMBOL');
  assert.equal((await call(fetchImpl, { symbol: 'SPY', from: '2025-10-02', to: '2025-10-01' })).status, 400);
  assert.equal((await call(fetchImpl, { symbol: 'SPY', from: '2025-01-01', to: '2025-12-01' })).status, 400, 'range too long');
  assert.equal((await call(fetchImpl, { symbol: 'NOSESS', from: '2025-10-01', to: '2025-10-02' })).json.error.code, 'SESSION_NOT_DEFINED');
});

test('database errors are reported as DATABASE_ERROR (502), never swallowed', async () => {
  const { fetchImpl } = fakeDb({ failOn: 'data_quality' });
  const r = await call(fetchImpl, { pending: true });
  assert.deepEqual([r.status, r.json.error.code], [502, 'DATABASE_ERROR']);
});

test('pendingSessions: already-checked dates are skipped without stopping', () => {
  const sym = { id: 1, symbol: 'SPY', market: 'us_stock', session_timezone: 'America/New_York', session_start: '09:30', session_end: '11:00' };
  const r = pendingSessions({ symbol: sym, assessed: new Set(['2025-09-26', '2025-09-27']), answered: [{ start: HISTORY, end: '2025-09-30T00:00:00.000Z' }], historyStartUtc: HISTORY, todayDate: '2025-10-08', limit: 10 });
  assert.deepEqual(r.sessions.map((s) => s.date), ['2025-09-28', '2025-09-29']);
  assert.equal(r.frontierDate, '2025-09-30');
});
