/** Import scheduler decisions (TASK 012): wait, back off, stop — no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FAILURES, backoffMs, decide, formatSchedulerReport } from '../scripts/import-scheduler.mjs';

const NOW = Date.parse('2026-09-26T10:00:00Z');
const ok = (extra) => ({ ok: true, jobs: [], totals: { inserted: 0 }, ...extra });
const d = (status, json, failures = 0) => decide(status, json, { failures, nowMs: NOW, rand: 0.5 });

test('job limit / minute budget → wait until the next request is allowed (+1 s)', () => {
  assert.deepEqual(d(200, ok({ stoppedReason: 'JOB_LIMIT_REACHED', budget: { nextRequestAllowedAtUtc: '2026-09-26T10:00:40.000Z' } })),
    { action: 'wait', ms: 41_000, reason: 'JOB_LIMIT_REACHED', failures: 0 });
  assert.equal(d(200, ok({ stoppedReason: 'MINUTE_BUDGET_REACHED', retryAtUtc: '2026-09-26T10:00:10.000Z' })).ms, 11_000);
  assert.equal(d(200, ok({ stoppedReason: 'MINUTE_BUDGET_REACHED', retryAtUtc: '2026-09-26T09:59:00.000Z' })).ms, 1_000, 'never negative');
});

test('daily budget or provider quota → stop cleanly, not a failure', () => {
  const r = d(200, ok({ stoppedReason: 'DAILY_BUDGET_REACHED', retryAtUtc: '2026-09-27T00:00:00.000Z' }));
  assert.equal(r.action, 'stop');
  assert.equal(r.failed, undefined);
  assert.match(r.reason, /resumes after 2026-09-27T00:00:00.000Z/);
  assert.equal(d(200, ok({ stoppedReason: 'QUOTA_EXHAUSTED' })).action, 'stop');
});

test('provider rate limit → wait for its retry time; repeated rate limits stop the run', () => {
  assert.deepEqual(d(200, ok({ stoppedReason: 'RATE_LIMITED', retryAtUtc: '2026-09-26T10:00:30.000Z' })),
    { action: 'wait', ms: 31_000, reason: 'RATE_LIMITED', failures: 1 });
  assert.equal(d(200, ok({ stoppedReason: 'RATE_LIMITED', retryAtUtc: '2026-09-26T10:00:01.000Z' })).ms, 5_000, 'at least 5 s');
  const stop = d(200, ok({ stoppedReason: 'RATE_LIMITED' }), MAX_FAILURES - 1);
  assert.deepEqual([stop.action, stop.failed], ['stop', true]);
});

test('transient failures back off exponentially and stop after MAX_FAILURES in a row', () => {
  const first = d(200, ok({ stoppedReason: 'PROVIDER_UNAVAILABLE' }));
  assert.deepEqual([first.action, first.failures], ['wait', 1]);
  assert.equal(d(0, null).reason, 'FUNCTION_UNREACHABLE');
  assert.equal(d(502, { ok: false, error: { code: 'DATABASE_ERROR' } }, 1).failures, 2);
  const last = d(200, ok({ stoppedReason: 'NETWORK_ERROR' }), MAX_FAILURES - 1);
  assert.deepEqual([last.action, last.failed], ['stop', true]);
  // A successful call resets the streak.
  assert.equal(d(200, ok({ stoppedReason: 'JOB_LIMIT_REACHED', budget: { nextRequestAllowedAtUtc: '2026-09-26T10:00:05Z' } }), 3).failures, 0);
});

test('backoffMs: exponential with jitter, capped at 120 s', () => {
  assert.equal(backoffMs(1, 0), 2_500);
  assert.equal(backoffMs(1, 0.999), 4_998);
  assert.equal(backoffMs(3, 0), 10_000);
  assert.equal(backoffMs(20, 0), 60_000);
  assert.ok(backoffMs(20, 0.999) <= 120_000);
});

test('owner-action problems stop and fail loudly: auth, bad configuration, refused call', () => {
  for (const [status, json] of [
    [200, ok({ stoppedReason: 'AUTH_FAILED' })],
    [401, { ok: false, error: { code: 'UNAUTHORIZED' } }],
    [409, { ok: false, error: { code: 'NOTHING_TO_IMPORT' } }],
  ]) {
    const r = d(status, json);
    assert.deepEqual([r.action, r.failed], ['stop', true], JSON.stringify(json));
  }
});

test('finished: up to date, or nothing more possible this run', () => {
  assert.deepEqual(d(200, ok({ upToDate: true })), { action: 'stop', reason: 'UP_TO_DATE', failures: 0 });
  assert.equal(d(200, ok({ stoppedReason: null })).reason, 'NOTHING_MORE_THIS_RUN');
});

test('report: calls, totals, budget, common frontier, per-symbol table', () => {
  const out = formatSchedulerReport({
    startedAt: 'S', stopReason: 'DAILY_BUDGET_REACHED', failed: false,
    calls: [{ status: 200, jobs: 7, inserted: 945, result: 'JOB_LIMIT_REACHED', next: 'wait 41 s' }, { status: 200, jobs: 3, inserted: 270, result: 'DAILY_BUDGET_REACHED', next: 'stop' }],
    last: {
      budget: { usedToday: 780, dailyBudget: 780, dayResetsAtUtc: 'R', usedLastMinute: 3, minuteBudget: 7 },
      commonAnsweredThroughUtc: 'C', historyStartUtc: 'H', settledUntilUtc: 'U',
      perSymbol: [{ symbol: 'SPY', answeredThroughUtc: 'A', complete: false, setAside: null }],
    },
  });
  assert.match(out, /Calls: 2 · provider requests: 10 · candles stored: 1215/);
  assert.match(out, /Budget: 780 \/ 780 requests today \(resets R\)/);
  assert.match(out, /Common frontier: `C`/);
  assert.match(out, /\| SPY \| A \| no \|  \|/);
});
