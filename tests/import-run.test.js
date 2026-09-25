/** Import-run report (TASK 008) — no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../scripts/import-run.mjs';

const req = { symbol: 'SPY', startUtc: '2026-09-24T13:30:00Z', endUtc: '2026-09-24T15:00:00Z' };

test('report lists run id, totals, jobs and the resume point', () => {
  const out = formatReport(200, {
    ok: true, runId: 'r-1', provider: 'twelve_data', windows: 2,
    totals: { received: 90, inserted: 90, duplicates: 0 },
    stoppedReason: 'JOB_LIMIT_REACHED', nextStartUtc: '2026-09-28T00:00:00.000Z',
    jobs: [{ jobId: 5, startUtc: 'a', endUtc: 'b', status: 'succeeded', received_count: 90, inserted_count: 90, duplicate_count: 0, error_message: 'x | y' }],
  }, req);
  assert.match(out, /Run id: `r-1`/);
  assert.match(out, /received 90, inserted 90, duplicates 0/);
  assert.match(out, /resume from `2026-09-28T00:00:00.000Z`/);
  assert.match(out, /\| 5 \| a → b \| succeeded \| 90 \| 90 \| 0 \|  \| x \/ y \|/);
});

test('report shows a refusal with its code', () => {
  assert.match(formatReport(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'future' } }, req), /BAD_REQUEST/);
});
