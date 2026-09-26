/** Deduplication (TASK 010): repeats, conflicting versions, already stored, provider revisions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeResponse, revisedMinutes, sameValues } from '../../supabase/functions/_shared/importer/dedupe.js';
import { runImport } from '../../supabase/functions/_shared/importer/engine.js';
import { defineRange, verified } from '../../supabase/functions/_shared/providers/mod.js';
import { createFakeProvider, FAKE_ID } from '../providers/fixtures/fake-provider.js';
import { createMemoryStore } from './memory-store.js';

const c = (t, o = '10', h = '11', l = '9', cl = '10.5', v = '100') => ({ timestampUtc: t, open: o, high: h, low: l, close: cl, volume: v, provider: FAKE_ID, interval: '1min' });
const T1 = '2026-09-24T13:30:00.000Z';
const T2 = '2026-09-24T13:31:00.000Z';

// ------------------------------------------------------------------ pure functions
test('sameValues: exact decimal equality, trailing zeros ignored, null volume only equals null', () => {
  assert.ok(sameValues(c(T1, '10.50'), c(T1, '10.5')));
  assert.ok(!sameValues(c(T1, '10.5'), c(T1, '10.500001')));
  assert.ok(sameValues(c(T1, '10', '11', '9', '10.5', null), c(T1, '10', '11', '9', '10.5', null)));
  assert.ok(!sameValues(c(T1, '10', '11', '9', '10.5', null), c(T1, '10', '11', '9', '10.5', '0')), 'absent volume is not zero');
});

test('dedupeResponse: identical repeats stored once and counted; conflicting versions all rejected', () => {
  const r = dedupeResponse([c(T2), c(T1), c(T1, '10.00'), c(T2, '10', '12'), c(T1)]);
  assert.deepEqual(r.unique.map((x) => x.timestampUtc), [T1], 'only the consistent minute survives');
  assert.equal(r.repeats, 2);
  assert.deepEqual(r.conflicting.map((x) => [x.reason, x.candle.timestampUtc]), [['CONFLICTING_DUPLICATE', T2], ['CONFLICTING_DUPLICATE', T2]]);
  assert.deepEqual(dedupeResponse([]), { unique: [], repeats: 0, conflicting: [] });
});

test('revisedMinutes: reports only minutes whose stored values differ', () => {
  assert.deepEqual(revisedMinutes([c(T1), c(T2, '10', '11', '9', '10.4')], [c(T1, '10.0'), c(T2)]), [T2]);
  assert.deepEqual(revisedMinutes([c(T1)], []), [], 'nothing stored → nothing to compare');
});

// ------------------------------------------------------------------ engine
const row = (t, o = '10', h = '10.5', l = '9.5', cl = '10.2', v = '1') => ({ t, o, h, l, c: cl, v });

function run(responses, store = createMemoryStore()) {
  const provider = createFakeProvider({ responses, facts: { maxSafeRangeMinutes: verified(10, 'test fixture') } });
  const SYMBOL = { id: 7, symbol: 'SPY', provider: FAKE_ID, provider_symbol: 'SPY', market: 'us_stock', enabled: true };
  return runImport({
    runId: 'r', symbolRow: SYMBOL, config: SYMBOL, provider, store, maxJobs: 7, now: () => Date.parse('2026-09-25T12:00:00Z'),
    range: defineRange(T1, '2026-09-24T13:40:00Z'),
  }).then((summary) => ({ summary, store, job: summary.jobs[0] }));
}

test('engine: identical repeats inside one response → stored once, counted as duplicates, job succeeded', async () => {
  const { job, store } = await run({ [T1]: { more: false, rows: [row(T1), row(T1), row(T2)] } });
  assert.deepEqual([job.status, job.received_count, job.inserted_count, job.duplicate_count, job.error_code], ['succeeded', 3, 2, 1, null]);
  assert.equal(store.candles.size, 2);
});

test('engine: two different versions of one minute → neither stored, warning code and note, rest kept', async () => {
  const { job, store } = await run({ [T1]: { more: false, rows: [row(T1), row(T1, '10.1'), row(T2)] } });
  assert.deepEqual([job.status, job.inserted_count, job.duplicate_count, job.error_code], ['succeeded', 1, 0, 'CONFLICTING_DUPLICATE']);
  assert.match(job.error_message, /2 row\(s\) not stored: CONFLICTING_DUPLICATE ×2/);
  assert.deepEqual([...store.candles.values()].map((x) => x.timestampUtc), [T2]);
});

test('engine: provider revises a stored minute → stored value kept (immutable), REVISED_BY_PROVIDER reported', async () => {
  const store = createMemoryStore();
  await run({ [T1]: { more: false, rows: [row(T1), row(T2)] } }, store);
  // Same window re-imported as an explicit repeat (engine called without answered coverage).
  const { job } = await run({ [T1]: { more: false, rows: [row(T1, '10.00'), row(T2, '10', '10.6')] } }, store);
  assert.deepEqual([job.status, job.inserted_count, job.duplicate_count, job.error_code], ['succeeded', 0, 2, 'REVISED_BY_PROVIDER']);
  assert.match(job.error_message, /1 stored candle\(s\) differ from the provider's current values; stored values kept \(immutable\): 2026-09-24T13:31:00.000Z/);
  assert.equal([...store.candles.values()].find((x) => x.timestampUtc === T2).high, '10.5', 'stored candle unchanged');
});

test('engine: re-import with identical values → pure duplicates, no warning', async () => {
  const store = createMemoryStore();
  await run({ [T1]: { more: false, rows: [row(T1)] } }, store);
  const { job } = await run({ [T1]: { more: false, rows: [row(T1, '10.0')] } }, store);
  assert.deepEqual([job.inserted_count, job.duplicate_count, job.error_code], [0, 1, null]);
  assert.doesNotMatch(job.error_message ?? '', /differ|not stored/);
});
