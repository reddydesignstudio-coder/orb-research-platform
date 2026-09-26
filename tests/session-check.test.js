/** Session check report (TASK 013): summarising stored candles against the validator — no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSessionReport, summariseSymbol } from '../scripts/session-check.mjs';
import { expectedMinutes, sessionFor } from '../supabase/functions/_shared/sessions/validator.js';

const SPY = { symbol: 'SPY', market: 'us_stock', session_timezone: 'America/New_York', session_start: '09:30:00', session_end: '11:00:00' };
const minutes = (d) => expectedMinutes(sessionFor(SPY, d));

test('Thanksgiving week: complete, incomplete, no data, not yet imported, closed with candles', () => {
  // Mon 24 Nov – Sun 30 Nov 2025; answered through Fri 28 Nov 00:00Z only.
  const ts = [
    ...minutes('2025-11-24'),
    ...minutes('2025-11-25').slice(1), // 89
    // 26 Nov: nothing stored although answered → no data
    '2025-11-27T15:00:00.000Z', // Thanksgiving, 10:00 ET → candle on a closed day
    ...minutes('2025-11-28'), // complete even though not yet answered
    '2025-11-24T21:00:00.000Z', // 16:00 ET → outside the window
  ];
  const s = summariseSymbol(SPY, '2025-11-24', '2025-12-01', ts, [{ start: '2025-11-01T00:00:00.000Z', end: '2025-11-28T00:00:00.000Z' }]);
  assert.deepEqual(
    [s.openSessions, s.complete, s.incomplete, s.missingCandles, s.noData, s.notYetImported, s.closedSessions, s.outsideWindow],
    [4, 2, 1, 1, 1, 0, 3, 1],
  );
  assert.deepEqual(s.closedWithCandles, ['2025-11-27 (1)']);
  assert.deepEqual(s.closedDays, ['2025-11-27 Thanksgiving Day']);
  assert.deepEqual(s.noDataDays, ['2025-11-26']);

  const pending = summariseSymbol(SPY, '2025-12-01', '2025-12-02', [], []);
  assert.deepEqual([pending.notYetImported, pending.noData], [1, 0], 'unanswered sessions are not reported as missing');

  const out = formatSessionReport({ from: '2025-11-24', to: '2025-12-01', summaries: [s] });
  assert.match(out, /\| SPY \| us_stock \| 4 \| 2 \| 1 \(1\) \| 1 \| 0 \| 3 \| 1 \| 1 \|/);
  assert.match(out, /holidays: 2025-11-27 Thanksgiving Day/);
});
