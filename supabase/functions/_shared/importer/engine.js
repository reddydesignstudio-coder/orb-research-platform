/**
 * Import job engine (TASK 008; PROVIDERS.md §6, §9, §12; RULES.md — IMPORTER).
 *
 * One RUN (run_id) imports one symbol over one requested UTC range:
 *   1. parts already definitively answered (TASK 009 coverage) are skipped;
 *      the missing parts are split into windows no larger than the provider's
 *      VERIFIED safe size, so no response can be truncated unnoticed (§6.2);
 *   2. windows are processed oldest first, one import_jobs row per window;
 *   3. each job: fetch → validate → store (duplicates skipped by the unique
 *      key) → record counts, status and errors;
 *   4. the run STOPS at the first window that is not definitively answered
 *      (error, rate limit, incomplete range), so no range is ever skipped.
 *      `nextStartUtc` says where the next run must resume.
 *
 * Job status (DATABASE.md — import_jobs.status):
 *   succeeded     the window was definitively answered and its candles stored
 *                 (it may legitimately contain no candles: weekend, holiday…)
 *   partial       the provider answered, but completeness could not be
 *                 established; whatever arrived is stored, the window is NOT done
 *   rate_limited  rate limit / quota; next_retry_at = when to try again
 *   failed        any other error (error_code, error_message)
 *
 * Resume (TASK 009): because answered windows are skipped, repeating a run —
 * or continuing from the checkpoint — requests exactly what is still missing.
 * Balancing and pacing are TASK 011 and 012. Candles are never deleted or modified.
 */

import { ProviderError, ProviderErrorCode, assessCompleteness, defineRange, defineRequest, redactSecrets, requireVerified } from '../providers/mod.js';
import { validateCandles } from './validate.js';
import { minutesIn, missingRanges } from './coverage.js';

const MINUTE_MS = 60_000;

/**
 * Split [start, end) into consecutive half-open windows of at most `maxMinutes`.
 * @returns {import('../providers/retrieval.js').TimeRange[]}
 */
export function planWindows(range, maxMinutes) {
  if (!Number.isInteger(maxMinutes) || maxMinutes < 1) throw new RangeError('maxMinutes must be a positive integer');
  const windows = [];
  let start = Date.parse(range.startUtc);
  const end = Date.parse(range.endUtc);
  while (start < end) {
    const stop = Math.min(start + maxMinutes * MINUTE_MS, end);
    windows.push(defineRange(new Date(start), new Date(stop)));
    start = stop;
  }
  return windows;
}

const countBy = (items, key) => {
  const out = {};
  for (const i of items) out[i[key]] = (out[i[key]] ?? 0) + 1;
  return Object.entries(out).map(([k, v]) => `${k} ×${v}`).join(', ');
};

/** Human-readable facts recorded with a job (the provider's indication, rejected rows). */
function jobNotes(result, invalid) {
  const notes = [];
  const rejected = [...result.rejected, ...invalid];
  if (rejected.length) notes.push(`${rejected.length} row(s) not stored: ${countBy(rejected, 'reason')}`);
  for (const n of result.providerNotes) if (!/^api-credits-/.test(n)) notes.push(n);
  return notes.length ? notes.join(' · ').slice(0, 2000) : null;
}

/**
 * @param {object} p
 * @param {string} p.runId
 * @param {{ id: number, symbol: string }} p.symbolRow       from the symbols table
 * @param {object} p.config                                   the same row, for resolveSymbol()
 * @param {object} p.provider                                 the symbol's configured adapter
 * @param {import('../providers/retrieval.js').TimeRange} p.range
 * @param {{ start: string, end: string }[]} [p.answered]   merged answered coverage (skipped)
 * @param {ReturnType<import('./store.js').createImportStore>} p.store
 * @param {number} p.maxJobs                                  windows to process in this run
 * @param {() => number} [p.now]
 * @param {string[]} [p.secrets]
 */
export async function runImport({ runId, symbolRow, config, provider, range, answered = [], store, maxJobs, now = Date.now, secrets = [] }) {
  const caps = provider.capabilities();
  const maxMinutes = requireVerified(caps, 'maxSafeRangeMinutes');
  const gaps = missingRanges(range, answered);
  const windows = gaps.flatMap((g) => planWindows(defineRange(g.start, g.end), maxMinutes));
  const resolved = provider.resolveSymbol(config);
  const iso = (ms) => new Date(ms).toISOString();
  const jobs = [];
  let stoppedReason = null;
  let nextStartUtc = null;

  for (const [index, window] of windows.entries()) {
    if (index >= maxJobs) {
      stoppedReason = 'JOB_LIMIT_REACHED';
      nextStartUtc = window.startUtc;
      break;
    }

    const jobId = await store.createJob({
      run_id: runId,
      symbol_id: symbolRow.id,
      provider: provider.id,
      interval: '1min',
      requested_start: window.startUtc,
      requested_end: window.endUtc,
      status: 'running',
      started_at: iso(now()),
    });
    const summary = { jobId, startUtc: window.startUtc, endUtc: window.endUtc };

    let patch;
    try {
      const result = await provider.fetchCandles(defineRequest({ symbol: resolved, range: window }));
      const { valid, invalid } = validateCandles(result.candles);
      const inserted = await store.insertCandles(symbolRow.id, valid);
      const completeness = assessCompleteness(result, caps);
      const answered = completeness.state === 'answered';
      patch = {
        status: answered ? 'succeeded' : 'partial',
        received_count: result.receivedCount,
        inserted_count: inserted,
        duplicate_count: valid.length - inserted,
        error_code: answered ? null : 'RANGE_NOT_COMPLETE',
        error_message: answered ? jobNotes(result, invalid) : completeness.reason,
      };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      const limited = pe && (pe.code === ProviderErrorCode.RATE_LIMITED || pe.code === ProviderErrorCode.QUOTA_EXHAUSTED);
      patch = {
        status: limited ? 'rate_limited' : 'failed',
        error_code: pe ? pe.code : e?.name === 'RestError' ? 'DATABASE_ERROR' : 'INTERNAL_ERROR',
        error_message: redactSecrets(e?.message ?? String(e), secrets).slice(0, 2000),
        next_retry_at: limited && pe.retryAfterMs !== undefined ? iso(now() + pe.retryAfterMs) : null,
      };
    }
    patch.completed_at = iso(now());
    await store.updateJob(jobId, patch);
    jobs.push({ ...summary, ...patch });

    if (patch.status !== 'succeeded') {
      stoppedReason = patch.status === 'partial' ? 'RANGE_NOT_COMPLETE' : patch.error_code;
      nextStartUtc = window.startUtc; // this window was not done: resume here
      break;
    }
  }

  const totals = jobs.reduce(
    (t, j) => ({ received: t.received + (j.received_count ?? 0), inserted: t.inserted + (j.inserted_count ?? 0), duplicates: t.duplicates + (j.duplicate_count ?? 0) }),
    { received: 0, inserted: 0, duplicates: 0 },
  );
  return {
    runId,
    symbol: symbolRow.symbol,
    provider: provider.id,
    requested: range,
    alreadyAnsweredMinutes: range.minutes - minutesIn(gaps),
    windows: windows.length,
    jobs,
    totals,
    stoppedReason,
    nextStartUtc,
  };
}
