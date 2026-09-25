/**
 * market-data Edge Function — request handler (TASK 007, ARCHITECTURE.md §2–§5).
 *
 * One request = one provider call for one configured symbol and one explicit
 * UTC range. It stores nothing (storing is the importer's job, TASK 008+).
 *
 *   POST /functions/v1/market-data
 *   apikey: <a Supabase SECRET key>          server-to-server only (D-020)
 *   { "symbol": "SPY", "startUtc": "…Z", "endUtc": "…Z" }
 *
 * → 200 { ok: true,  symbol, market, provider, completeness, result }
 * → 4xx/5xx { ok: false, error: { code, message, retryPolicy?, retryAfterMs? } }
 *
 * Security (PROVIDERS.md §13): secret-key callers only; the provider key is read
 * from the function's secrets and never appears in responses or logs; no CORS.
 */

import { ProviderError, ProviderNotRegisteredError, assessCompleteness, defineRange, defineRequest, redactSecrets } from '../providers/mod.js';
import { failure, guardServerRequest, parseSecretKeys, reply, safeEqual } from '../server/http.js';
import { createRestClient } from '../server/rest.js';
import { loadSymbolWithProvider, providerSecretNames } from '../server/symbols.js';

export { parseSecretKeys, safeEqual }; // kept for existing callers/tests

/** Map a ProviderError to an HTTP failure response (shared with the importer). */
export function providerFailure(e, redact) {
  const status = e.code === 'RATE_LIMITED' || e.code === 'QUOTA_EXHAUSTED' ? 429 : 502;
  return failure(status, e.code, redact(e.message), {
    provider: e.providerId,
    retryPolicy: e.retryPolicy,
    ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
  });
}

/**
 * @param {object} deps
 * @param {(name: string) => string | undefined} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {(msg: string) => void} [deps.log]
 */
export function createMarketDataHandler({ env, fetchImpl = globalThis.fetch, now = Date.now, log = console.error }) {
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
        return failure(400, 'BAD_REQUEST', 'Body must be JSON: { symbol, startUtc, endUtc }.');
      }
      const { symbol, startUtc, endUtc } = body ?? {};
      if (typeof symbol !== 'string' || symbol.trim() === '') return failure(400, 'BAD_REQUEST', '"symbol" is required.');
      let range;
      try {
        range = defineRange(startUtc, endUtc);
      } catch (e) {
        return failure(400, 'BAD_REQUEST', e.message);
      }

      const baseUrl = env('SUPABASE_URL');
      if (!baseUrl) return failure(500, 'SERVER_MISCONFIGURED', 'SUPABASE_URL is not available to the function.');
      const rest = createRestClient({ baseUrl, key: secretKeys[0], fetchImpl });

      const loaded = await loadSymbolWithProvider({ rest, env, fetchImpl, now, symbol });
      if (!loaded.ok) return failure(loaded.status, loaded.code, redact(loaded.message));
      const { config, provider } = loaded;

      const request = defineRequest({ symbol: provider.resolveSymbol(config), range });
      const result = await provider.fetchCandles(request);
      const completeness = assessCompleteness(result, provider.capabilities());

      return reply(200, { ok: true, symbol: config.symbol, market: config.market, provider: provider.id, completeness, result });
    } catch (e) {
      if (e instanceof ProviderError) return providerFailure(e, redact);
      if (e instanceof ProviderNotRegisteredError) return failure(422, 'PROVIDER_NOT_REGISTERED', redact(e.message));
      log(`market-data: unexpected error: ${redact(e?.stack ?? e)}`);
      return failure(500, 'INTERNAL_ERROR', redact(e?.message ?? String(e)));
    }
  };
}
