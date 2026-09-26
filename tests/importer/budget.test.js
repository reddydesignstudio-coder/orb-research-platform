/** Credit budget (TASK 012, D-027): per rolling minute and per UTC day, from recorded requests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBudget, limitsFrom, utcDayStart } from '../../supabase/functions/_shared/importer/budget.js';
import { runBalanced } from '../../supabase/functions/_shared/importer/balance.js';
import { verified } from '../../supabase/functions/_shared/providers/mod.js';
import { createFakeProvider, FAKE_ID } from '../providers/fixtures/fake-provider.js';
import { createMemoryStore } from './memory-store.js';

const T = Date.parse('2026-09-26T10:00:30Z');
const at = (sec) => new Date(T + sec * 1000).toISOString();

test('limitsFrom: Basic plan (8/min, 800/day) with a 20-credit reserve → 7 per minute, 780 per day', () => {
  assert.deepEqual(limitsFrom({ rateLimit: { creditsPerMinute: 8, creditsPerRequest: 1 }, quota: { creditsPerDay: 800 } }, 20), { perMinute: 7, perDay: 780 });
  assert.deepEqual(limitsFrom({ rateLimit: { creditsPerMinute: 1, creditsPerRequest: 1 }, quota: { creditsPerDay: 10 } }, 20), { perMinute: 1, perDay: 0 });
});

test('minute budget: the 8th request inside 60 s is refused until the oldest one is a minute old', async () => {
  let now = T;
  const b = createBudget({ startsToday: [], limits: { perMinute: 7, perDay: 780 }, now: () => now });
  for (let i = 0; i < 7; i++) {
    assert.equal(await b.take(), null);
    now += 1000;
  }
  const refused = await b.take();
  assert.deepEqual(refused, { code: 'MINUTE_BUDGET_REACHED', retryAtUtc: at(60) });
  now = T + 60_000; // the first request is now exactly 60 s old
  assert.equal(await b.take(), null);
});

test('requests recorded by earlier runs count (the database is the source)', async () => {
  const b = createBudget({ startsToday: [at(-50), at(-40), at(-30)], limits: { perMinute: 3, perDay: 780 }, now: () => T });
  const r = await b.take();
  assert.equal(r.code, 'MINUTE_BUDGET_REACHED');
  assert.equal(r.retryAtUtc, at(10));
});

test('daily budget: refused until 00:00 UTC; yesterday does not count', async () => {
  const yesterday = new Date(utcDayStart(T) - 3_600_000).toISOString();
  const today = Array.from({ length: 5 }, (_, i) => new Date(utcDayStart(T) + i * 120_000).toISOString());
  const b = createBudget({ startsToday: [yesterday, ...today], limits: { perMinute: 7, perDay: 5 }, now: () => T });
  assert.deepEqual(await b.take(), { code: 'DAILY_BUDGET_REACHED', retryAtUtc: '2026-09-27T00:00:00.000Z' });
  const u = b.usage();
  assert.deepEqual([u.usedToday, u.dailyBudget, u.dayResetsAtUtc, u.nextRequestAllowedAtUtc], [5, 5, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z']);
});

test('balanced run: a budget refusal stops the run before any request, with the time to resume', async () => {
  const provider = createFakeProvider({
    responses: new Proxy({}, { get: () => ({ more: false, rows: [] }) }),
    facts: { maxSafeRangeMinutes: verified(10, 't') },
  });
  const sym = (id, name) => ({ config: { id, symbol: name, provider: FAKE_ID, provider_symbol: name }, provider, answered: [], keep: null });
  const store = createMemoryStore();
  let now = T;
  const budget = createBudget({ startsToday: [], limits: { perMinute: 2, perDay: 780 }, now: () => now });
  const r = await runBalanced({
    runId: 'r', symbols: [sym(1, 'A'), sym(2, 'B'), sym(3, 'C')], historyStartIso: '2026-09-24T00:00:00.000Z',
    settledIso: '2026-09-24T01:00:00.000Z', maxJobs: 7, store, budget, now: () => now,
  });
  assert.equal(r.jobs.length, 2);
  assert.equal(r.stoppedReason, 'MINUTE_BUDGET_REACHED');
  assert.equal(r.retryAtUtc, at(60));
  assert.equal(store.jobs.size, 2, 'no job is created for a refused request');
});
