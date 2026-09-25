/**
 * importer Edge Function — request handler (TASK 008).
 *
 *   POST /functions/v1/importer
 *   apikey: <a Supabase SECRET key>             server-to-server only (D-020)
 *   { "symbol": "SPY", "startUtc": "…Z", "endUtc": "…Z", "maxJobs"?: 1–7 }
 *
 * Starts one import run (new run_id) for one configured symbol and range and
 * returns its summary: jobs, counts, why it stopped and where to resume.
 * Deciding WHAT to import (missing history, balance across symbols) is
 * TASK 009/011; the Admin "GET DATA" button is TASK 015.
 */

import { ProviderError, defineRange, redactSecrets, requireVerified } from '../providers/mod.js';
import { failure, guardServerRequest, parseSecretKeys, reply } from '../server/http.js';
import { createRestClient } from '../server/rest.js';
import { loadSymbolWithProvider, providerSecretNames } from '../server/symbols.js';
import { providerFailure } from '../market-data/handler.js';
import { runImport } from './engine.js';
import { createImportStore } from './store.js';

export const DEFAULT_MAX_JOBS = 4;

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
      if (typeof symbol !== 'string' || symbol.trim() === '') return failure(400, 'BAD_REQUEST', '"symbol" is required.');
      let range;
      try {
        range = defineRange(startUtc, endUtc);
      } catch (e) {
        return failure(400, 'BAD_REQUEST', e.message);
      }
      if (range.endUtc > new Date(now()).toISOString()) {
        return failure(400, 'BAD_REQUEST', 'endUtc must not be in the future: only completed minutes are imported.');
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

      const summary = await runImport({
        runId: newRunId(),
        symbolRow: config,
        config,
        provider,
        range,
        store: createImportStore(rest),
        maxJobs,
        now,
        secrets: allSecrets,
      });
      return reply(200, { ok: true, ...summary });
    } catch (e) {
      if (e instanceof ProviderError) return providerFailure(e, redact);
      log(`importer: unexpected error: ${redact(e?.stack ?? e)}`);
      return failure(500, 'INTERNAL_ERROR', redact(e?.message ?? String(e)));
    }
  };
}
