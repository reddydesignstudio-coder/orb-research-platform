/** Balanced import (TASK 011, D-026): the symbol furthest behind always goes next. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontierOf, pickNext, runBalanced } from '../../supabase/functions/_shared/importer/balance.js';
import { runImport } from '../../supabase/functions/_shared/importer/engine.js';
import { researchWindow } from '../../supabase/functions/_shared/importer/session.js';
import { defineRange, verified } from '../../supabase/functions/_shared/providers/mod.js';
import { createFakeProvider, FAKE_ID } from '../providers/fixtures/fake-provider.js';
import { createMemoryStore } from './memory-store.js';

const H0 = '2026-09-24T00:00:00.000Z';
const iso = (min) => new Date(Date.parse(H0) + min * 60_000).toISOString();
const SETTLED = iso(40); // 4 windows of 10 minutes

/** Fake provider answering every window with no candles (or a failure for chosen windows). */
function provider(failures = {}) {
  const responses = new Proxy({}, {
    get: (_, start) => (failures[start] ? { failure: failures[start] } : { more: false, rows: [] }),
  });
  return createFakeProvider({ responses, facts: { maxSafeRangeMinutes: verified(10, 'test fixture') } });
}

const sym = (id, name, answered = [], failures = {}) => ({
  config: { id, symbol: name, provider: FAKE_ID, provider_symbol: name, market: 'us_stock', enabled: true },
  provider: provider(failures),
  answered,
  keep: null,
});

const run = (symbols, maxJobs = 7, store = createMemoryStore()) =>
  runBalanced({ runId: 'r', symbols, historyStartIso: H0, settledIso: SETTLED, maxJobs, store, now: () => Date.parse('2026-09-25T00:00:00Z') });

// ------------------------------------------------------------------ pure parts
test('frontierOf: first unanswered minute from the history start; null when complete', () => {
  assert.equal(frontierOf([], H0, SETTLED), H0);
  assert.equal(frontierOf([{ start: H0, end: iso(20) }], H0, SETTLED), iso(20));
  assert.equal(frontierOf([{ start: iso(10), end: SETTLED }], H0, SETTLED), H0, 'a hole before later history comes first');
  assert.equal(frontierOf([{ start: H0, end: SETTLED }], H0, SETTLED), null);
});

test('pickNext: earliest frontier, ties by symbol, skipping complete and set-aside symbols', () => {
  const s = (symbol, frontier, setAside = null) => ({ symbol, frontier, setAside });
  assert.equal(pickNext([s('QQQ', iso(10)), s('SPY', iso(0)), s('AAPL', iso(20))]).symbol, 'SPY');
  assert.equal(pickNext([s('SPY', iso(10)), s('AAPL', iso(10))]).symbol, 'AAPL');
  assert.equal(pickNext([s('SPY', null), s('AAPL', iso(0), 'SYMBOL_NOT_FOUND')]), null);
});

// ------------------------------------------------------------------ runs
test('round-robin by progress: no symbol gets more than one window ahead', async () => {
  const r = await run([sym(1, 'SPY'), sym(2, 'QQQ'), sym(3, 'AAPL')], 6);
  assert.deepEqual(r.jobs.map((j) => `${j.symbol}@${j.startUtc.slice(11, 16)}`), [
    'AAPL@00:00', 'QQQ@00:00', 'SPY@00:00', 'AAPL@00:10', 'QQQ@00:10', 'SPY@00:10',
  ]);
  assert.equal(r.stoppedReason, 'JOB_LIMIT_REACHED');
  assert.equal(r.commonAnsweredThroughUtc, iso(20));
  assert.ok(r.perSymbol.every((p) => p.answeredThroughUtc === iso(20)));
});

test('a symbol that is behind is caught up first', async () => {
  const r = await run([sym(1, 'SPY', [{ start: H0, end: iso(30) }]), sym(2, 'QQQ')], 3);
  assert.deepEqual(r.jobs.map((j) => j.symbol), ['QQQ', 'QQQ', 'QQQ']);
  assert.equal(r.commonAnsweredThroughUtc, iso(30));
});

test('everything answered → up to date, no provider call', async () => {
  const store = createMemoryStore();
  const r = await run([sym(1, 'SPY', [{ start: H0, end: SETTLED }])], 7, store);
  assert.equal(r.upToDate, true);
  assert.equal(r.jobs.length, 0);
  assert.equal(store.jobs.size, 0);
  assert.equal(r.commonAnsweredThroughUtc, SETTLED);
});

test('symbol-specific failure: that symbol is set aside, the others continue', async () => {
  const r = await run([sym(1, 'SPY'), sym(2, 'AAA', [], { [H0]: { status: 404, message: 'unknown' } })], 3);
  assert.deepEqual(r.jobs.map((j) => [j.symbol, j.status]), [['AAA', 'failed'], ['SPY', 'succeeded'], ['SPY', 'succeeded']]);
  const aaa = r.perSymbol.find((p) => p.symbol === 'AAA');
  assert.deepEqual([aaa.setAside, aaa.answeredThroughUtc], ['SYMBOL_NOT_FOUND', H0]);
  assert.equal(r.commonAnsweredThroughUtc, H0, 'the common frontier waits for the set-aside symbol');
});

test('provider-wide failure (rate limit): the whole run stops', async () => {
  const r = await run([sym(1, 'SPY'), sym(2, 'AAA', [], { [H0]: { status: 429, message: 'slow down', retryAfterSeconds: 30 } })], 5);
  assert.deepEqual(r.jobs.map((j) => [j.symbol, j.status]), [['AAA', 'rate_limited']]);
  assert.equal(r.stoppedReason, 'RATE_LIMITED');
});

test('one run id for every job of a balanced run; windows never exceed the safe size', async () => {
  const store = createMemoryStore();
  await run([sym(1, 'SPY'), sym(2, 'QQQ')], 4, store);
  const jobs = [...store.jobs.values()];
  assert.ok(jobs.every((j) => j.run_id === 'r'));
  assert.ok(jobs.every((j) => (Date.parse(j.requested_end) - Date.parse(j.requested_start)) / 60_000 <= 10));
});

// ------------------------------------------------------------------ research window in the engine
test('engine: candles outside the research window are counted, not stored, and noted', async () => {
  const W = researchWindow({ session_timezone: 'America/New_York', session_start: '09:30', session_end: '11:00' });
  const rows = ['2026-09-24T13:28:00Z', '2026-09-24T13:29:00Z', '2026-09-24T13:30:00Z', '2026-09-24T13:31:00Z']
    .map((t) => ({ t, o: '10', h: '10.5', l: '9.5', c: '10.2', v: '1' }));
  const store = createMemoryStore();
  const p = createFakeProvider({ responses: { '2026-09-24T13:28:00.000Z': { more: false, rows } }, facts: { maxSafeRangeMinutes: verified(10, 't') } });
  const s = { id: 1, symbol: 'SPY', provider: FAKE_ID, provider_symbol: 'SPY' };
  const out = await runImport({ runId: 'x', symbolRow: s, config: s, provider: p, range: defineRange('2026-09-24T13:28:00Z', '2026-09-24T13:32:00Z'), store, maxJobs: 1, keep: W });
  const j = out.jobs[0];
  assert.deepEqual([j.status, j.received_count, j.inserted_count, j.duplicate_count], ['succeeded', 4, 2, 0]);
  assert.match(j.error_message, /2 candle\(s\) outside the research window \(09:30–11:00 America\/New_York\) not stored/);
  assert.deepEqual([...store.candles.values()].map((c) => c.timestampUtc), ['2026-09-24T13:30:00.000Z', '2026-09-24T13:31:00.000Z']);
});
