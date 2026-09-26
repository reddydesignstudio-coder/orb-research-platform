/** Data quality script (TASK 014): repeated pending calls, merge, reports — no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatQualityReport, formatRangeReport, runPending } from '../scripts/data-quality.mjs';

const page = (more, checked, extra = {}) => ({ status: 200, json: { ok: true, more, perSymbol: [
  { symbol: 'SPY', checked, byStatus: { complete: checked - 1, market_closed: 1 }, problems: [], checkedThrough: '2025-10-01', waitingForImportFrom: more ? null : '2025-11-07' },
  { symbol: 'AUD/USD', checked, byStatus: { incomplete: checked }, problems: [`2025-09-26 incomplete 45/90 missing 09:31, 09:33, 09:35, 09:37 …`], ...extra },
  { symbol: 'NOSESS', skipped: 'SESSION_NOT_DEFINED' },
] } });

test('runPending repeats while more remain and merges counts', async () => {
  const replies = [page(true, 30), page(false, 10)];
  const r = await runPending(async () => replies.shift());
  assert.deepEqual([r.calls, r.error, r.more], [2, null, false]);
  const spy = r.perSymbol.find((p) => p.symbol === 'SPY');
  assert.deepEqual([spy.checked, spy.byStatus.complete, spy.byStatus.market_closed, spy.waitingForImportFrom], [40, 38, 2, '2025-11-07']);
  assert.equal(r.perSymbol.find((p) => p.symbol === 'AUD/USD').problems.length, 2);
  const out = formatQualityReport(r);
  assert.match(out, /Checked 80 session\(s\) in 2 call\(s\)\./);
  assert.match(out, /\| SPY \| 40 \| 38 \| 0 \| 0 \| 0 \| 2 \| 2025-11-07 \|/);
  assert.match(out, /\| NOSESS \| skipped: SESSION_NOT_DEFINED/);
  assert.match(out, /\*\*AUD\/USD\*\* \(2\): 2025-09-26 incomplete 45\/90/);
});

test('runPending stops on an error and at the call limit', async () => {
  const err = await runPending(async () => ({ status: 502, json: { ok: false, error: { code: 'DATABASE_ERROR', message: 'boom' } } }));
  assert.deepEqual([err.calls, err.error], [1, 'DATABASE_ERROR: boom']);
  assert.match(formatQualityReport(err), /Stopped with a problem:\*\* DATABASE_ERROR/);
  const none = await runPending(async () => ({ status: 0, json: null }));
  assert.equal(none.error, 'HTTP 0: no response');
  const capped = await runPending(async () => page(true, 1), { maxCalls: 3 });
  assert.deepEqual([capped.calls, capped.more], [3, true]);
  assert.match(formatQualityReport(capped), /more remain/);
});

test('range report lists each session with its explanation', () => {
  const out = formatRangeReport({ symbol: 'AUD/USD', from: '2025-09-26', to: '2025-09-29', checked: 2, notYetImported: [], sessions: [
    { session_date: '2025-09-26', status: 'incomplete', actual_candles: 45, expected_candles: 90, missing_candles: 45, duplicate_candles: 0, invalid_ohlc_candles: 0, invalid_timestamp_candles: 0, details: { missing: ['09:31', '09:33'] } },
    { session_date: '2025-09-27', status: 'market_closed', actual_candles: 0, expected_candles: 0, missing_candles: 0, duplicate_candles: 0, invalid_ohlc_candles: 0, invalid_timestamp_candles: 0, details: { closedReason: 'weekend' } },
  ] });
  assert.match(out, /\| 2025-09-26 \| incomplete \| 45\/90 \| 45 \| 0 \| missing 09:31, 09:33 \|/);
  assert.match(out, /\| 2025-09-27 \| market_closed \| 0\/0 \| 0 \| 0 \| weekend \|/);
});
