/**
 * importer Edge Function — request handler (TASK 008).
 *
 *   POST /functions/v1/importer
 *   apikey: <a Supabase SECRET key>             server-to-server only (D-020)
 *   { "symbol": "SPY", "startUtc": "…Z", "endUtc": "…Z", "maxJobs"?: 1–7 }
 *   { "symbol": "SPY", "continue": true, "maxJobs"?: 1–7 }          (TASK 009)
 *
 * Starts one import run (new run_id) for one configured symbol and returns its
 * summary: jobs, counts, why it stopped, the checkpoint and import_progress.
 *
 * Checkpointing / resume (TASK 009, D-023):
 *   - windows already definitively answered are never requested again;
 *   - "continue" imports from the symbol's checkpoint (end of its answered
 *     history) up to the latest settled minute;
 *   - jobs left "running" by an interrupted run are closed as INTERRUPTED first;
 *   - only minutes that ended at least SETTLE_MINUTES ago are imported, so a bar
 *     the provider has not published yet can never be recorded as answered.
 * Balance across symbols is TASK 011; the Admin "GET DATA" button is TASK 015.
 */

import { ProviderError, defineRange, redactSecrets, requireVerified } from '../providers/mod.js';
import { failure, guardServerRequest, parseSecretKeys, reply } from '../server/http.js';
import { createRestClient } from '../server/rest.js';
import { loadSymbolWithProvider, providerSecretNames } from '../server/symbols.js';
import { providerFailure } from '../market-data/handler.js';
import { runImport } from './engine.js';
import { checkpointOf, mergeCoverage } from './coverage.js';
import { createImportStore } from './store.js';

export const DEFAULT_MAX_JOBS = 4;
/** Only minutes that ended at least this long ago are imported (D-023). */
export const SETTLE_MINUTES = 30;
/** A job still "running" this long after it started was interrupted (functions time out far sooner). */
export const INTERRUPTED_AFTER_MINUTES = 15;

const MINUTE_MS = 60_000;

/**
 * @param {object} deps
 * @param {(name: string) => string | undefined} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {() => string} [deps.newRunId]
 * @param {(msg: string) => void} [deps.log]
 */
export function createImporterHandler({ env, fetchImpl = globalThis.fetch, now = Date.now, newRunId = () => crypto.randomUUID(), log = console.error }) {
  return async function handle(req) {
    const secretKeys = parseSecretKeys(env('SUPABASE_SECRET_KEYS'));
    const allSecrets = [...secretKeys, ...providerSecretNames().map((n) => env(n)).filter(Boolean)];
    const redact = (text) => redactSecrets(text, allSecrets);

    try {
      const refused = guardServerRequest(req, secretKeys);
      if (refused) return refused;

      let body;
      try {
        body = await req.json();
      } catch {
        return failure(400, 'BAD_REQUEST', 'Body must be JSON: { symbol, startUtc, endUtc, maxJobs? }.');
      }
      const { symbol, startUtc, endUtc, maxJobs = DEFAULT_MAX_JOBS } = body ?? {};
      const continuing = body?.continue === true;
      if (typeof symbol !== 'string' || symbol.trim() === '') return failure(400, 'BAD_REQUEST', '"symbol" is required.');
      const nowMs = now();
      const settledMs = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS - SETTLE_MINUTES * MINUTE_MS;
      const settledIso = new Date(settledMs).toISOString();
      let explicitRange = null;
      if (!continuing) {
        try {
          explicitRange = defineRange(startUtc, endUtc);
        } catch (e) {
          return failure(400, 'BAD_REQUEST', `${e.message} (or send "continue": true)`);
        }
        if (explicitRange.endUtc > settledIso) {
          return failure(400, 'BAD_REQUEST', `endUtc must be at or before ${settledIso}: only minutes that ended at least ${SETTLE_MINUTES} minutes ago are imported.`);
        }
      } else if (startUtc !== undefined || endUtc !== undefined) {
        return failure(400, 'BAD_REQUEST', 'Send either "continue": true or startUtc/endUtc, not both.');
      }

      const baseUrl = env('SUPABASE_URL');
      if (!baseUrl) return failure(500, 'SERVER_MISCONFIGURED', 'SUPABASE_URL is not available to the function.');
      const rest = createRestClient({ baseUrl, key: secretKeys[0], fetchImpl });

      const loaded = await loadSymbolWithProvider({ rest, env, fetchImpl, now, symbol });
      if (!loaded.ok) return failure(loaded.status, loaded.code, redact(loaded.message));
      const { config, provider } = loaded;

      // Stay inside the plan's per-minute request limit (verified; pacing proper is TASK 012).
      const perMinute = requireVerified(provider.capabilities(), 'rateLimit').creditsPerMinute;
      const cap = Math.max(1, perMinute - 1);
      if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > cap) {
        return failure(400, 'BAD_REQUEST', `"maxJobs" must be an integer from 1 to ${cap} for this provider plan.`);
      }

      const store = createImportStore(rest);
      const nowIso = new Date(nowMs).toISOString();
      const interruptedJobsClosed = await store.closeInterruptedJobs(
        config.id,
        new Date(nowMs - INTERRUPTED_AFTER_MINUTES * MINUTE_MS).toISOString(),
        nowIso,
      );
      const answeredRaw = await store.answeredRanges(config.id, provider.id);
      const answered = mergeCoverage(answeredRaw);

      let range = explicitRange;
      if (continuing) {
        const cp = checkpointOf(answered);
        if (!cp) {
          return failure(409, 'NO_HISTORY_YET', `"${symbol}" has no answered history yet: start with an explicit startUtc/endUtc.`);
        }
        if (cp.checkpoint >= settledIso) {
          return reply(200, { ok: true, symbol: config.symbol, provider: provider.id, upToDate: true, checkpointUtc: cp.checkpoint, settledUntilUtc: settledIso, interruptedJobsClosed, jobs: [], windows: 0 });
        }
        range = defineRange(cp.historyStart, settledIso);
      }

      const summary = await runImport({
        runId: newRunId(),
        symbolRow: config,
        config,
        provider,
        range,
        answered,
        store,
        maxJobs,
        now,
        secrets: allSecrets,
      });

      // Checkpoint after this run, and the refreshed history summary.
      const after = mergeCoverage([
        ...answered,
        ...summary.jobs.filter((j) => j.status === 'succeeded').map((j) => ({ start: j.startUtc, end: j.endUtc })),
      ]);
      const cp = checkpointOf(after);
      let progress = null;
      let progressError = null;
      try {
        if (summary.totals.inserted > 0) await store.refreshProgress(config.id, provider.id);
        progress = await store.progress(config.id, provider.id);
      } catch (e) {
        progressError = redact(e?.message ?? String(e));
      }
      Object.assign(summary, {
        mode: continuing ? 'continue' : 'range',
        interruptedJobsClosed,
        settledUntilUtc: settledIso,
        historyStartUtc: cp?.historyStart ?? null,
        checkpointUtc: cp?.checkpoint ?? null,
        progress,
        ...(progressError ? { progressError } : {}),
      });
      return reply(200, { ok: true, ...summary });
    } catch (e) {
      if (e instanceof ProviderError) return providerFailure(e, redact);
      log(`importer: unexpected error: ${redact(e?.stack ?? e)}`);
      return failure(500, 'INTERNAL_ERROR', redact(e?.message ?? String(e)));
    }
  };
}
