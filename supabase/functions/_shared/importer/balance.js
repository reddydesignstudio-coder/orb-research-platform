/**
 * Balanced import across enabled symbols (TASK 011; PROJECT.md §7–§8; RULES.md — IMPORTER 8–9).
 *
 * Every enabled symbol is built forward from the same history start
 * (config.js, D-025) to the latest settled minute. A symbol's FRONTIER is the
 * start of its first missing (unanswered) range — everything before it is
 * answered. Each step imports ONE window for the symbol whose frontier is the
 * earliest, so no symbol can run ahead of the others by more than one window
 * (≤ 4 999 minutes for Twelve Data).
 *
 * Failures:
 *   provider-wide (rate limit, quota, auth, outage, network, database…)
 *     → the whole run stops; nothing else would succeed either;
 *   symbol-specific (unknown symbol, plan restriction, malformed data,
 *   incomplete range…) → that symbol is set aside for the rest of this run
 *     and reported; the others continue. Its frontier stays where it is, so it
 *     is first in line again next run.
 */

import { defineRange } from '../providers/mod.js';
import { mergeCoverage, missingRanges } from './coverage.js';
import { runImport } from './engine.js';

/** Codes after which no other symbol can succeed in this run either. */
export const RUN_STOPPING_CODES = Object.freeze(new Set([
  'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'AUTH_FAILED', 'PROVIDER_UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT', 'DATABASE_ERROR', 'INTERNAL_ERROR',
]));

/** First missing minute of [historyStart, settled), or null when complete. */
export function frontierOf(answered, historyStartIso, settledIso) {
  if (historyStartIso >= settledIso) return null;
  const gaps = missingRanges({ startUtc: historyStartIso, endUtc: settledIso }, answered);
  return gaps.length ? gaps[0].start : null;
}

/** Symbol to import next: earliest frontier, then symbol name (stable). */
export function pickNext(states) {
  let best = null;
  for (const s of states) {
    if (s.frontier === null || s.setAside) continue;
    if (!best || s.frontier < best.frontier || (s.frontier === best.frontier && s.symbol < best.symbol)) best = s;
  }
  return best;
}

/**
 * @param {object} p
 * @param {string} p.runId
 * @param {{ config: object, provider: object, answered: {start:string,end:string}[], keep: object|null }[]} p.symbols
 * @param {string} p.historyStartIso
 * @param {string} p.settledIso
 * @param {number} p.maxJobs
 * @param {object} p.store
 * @param {object} [p.budget]  credit budget (TASK 012, budget.js)
 * @param {() => number} [p.now]
 * @param {string[]} [p.secrets]
 */
export async function runBalanced({ runId, symbols, historyStartIso, settledIso, maxJobs, store, budget = null, now = Date.now, secrets = [] }) {
  const range = defineRange(historyStartIso, settledIso);
  const states = symbols.map((s) => ({
    ...s,
    symbol: s.config.symbol,
    answered: mergeCoverage(s.answered),
    frontierBefore: frontierOf(mergeCoverage(s.answered), historyStartIso, settledIso),
    setAside: null,
    jobs: [],
  }));
  for (const s of states) s.frontier = s.frontierBefore;

  const jobs = [];
  let stoppedReason = null;
  let retryAtUtc = null;
  while (jobs.length < maxJobs) {
    const next = pickNext(states);
    if (!next) break;
    const summary = await runImport({
      runId,
      symbolRow: next.config,
      config: next.config,
      provider: next.provider,
      range,
      answered: next.answered,
      store,
      maxJobs: 1,
      keep: next.keep,
      budget,
      now,
      secrets,
    });
    const job = summary.jobs[0];
    if (!job) {
      // Refused by the credit budget before any request (or, defensively, nothing left).
      if (summary.stoppedReason) {
        stoppedReason = summary.stoppedReason;
        retryAtUtc = summary.retryAtUtc;
      }
      break;
    }
    const entry = { symbol: next.symbol, ...job };
    jobs.push(entry);
    next.jobs.push(entry);
    if (job.status === 'succeeded') {
      next.answered = mergeCoverage([...next.answered, { start: job.startUtc, end: job.endUtc }]);
      next.frontier = frontierOf(next.answered, historyStartIso, settledIso);
    } else if (RUN_STOPPING_CODES.has(job.error_code)) {
      stoppedReason = job.error_code;
      retryAtUtc = job.next_retry_at ?? null;
      break;
    } else {
      next.setAside = job.error_code ?? job.status;
    }
  }
  if (!stoppedReason && jobs.length >= maxJobs && pickNext(states)) stoppedReason = 'JOB_LIMIT_REACHED';

  const perSymbol = states.map((s) => ({
    symbol: s.symbol,
    symbolId: s.config.id,
    answeredThroughBefore: s.frontierBefore ?? settledIso,
    answeredThroughUtc: s.frontier ?? settledIso,
    complete: s.frontier === null,
    jobs: s.jobs.length,
    inserted: s.jobs.reduce((n, j) => n + (j.inserted_count ?? 0), 0),
    setAside: s.setAside,
  }));
  // Every enabled symbol is answered at least this far: the balanced common frontier.
  const commonAnsweredThroughUtc = perSymbol.reduce((min, p) => (p.answeredThroughUtc < min ? p.answeredThroughUtc : min), settledIso);
  const totals = jobs.reduce(
    (t, j) => ({ received: t.received + (j.received_count ?? 0), inserted: t.inserted + (j.inserted_count ?? 0), duplicates: t.duplicates + (j.duplicate_count ?? 0) }),
    { received: 0, inserted: 0, duplicates: 0 },
  );
  return { runId, mode: 'balanced', historyStartUtc: historyStartIso, settledUntilUtc: settledIso, jobs, totals, perSymbol, commonAnsweredThroughUtc, stoppedReason, retryAtUtc, upToDate: perSymbol.every((p) => p.complete) };
}
