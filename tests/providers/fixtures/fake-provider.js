/**
 * A fixture-driven FAKE provider used to test the shared contract.
 * It is not a real adapter and makes no network calls. It shows how an adapter
 * is expected to use the shared helpers:
 *   resolveSymbolExactly, buildRetrievalResult, ProviderError, classifyGenericError.
 */

import {
  ProviderError,
  ProviderErrorCode,
  Truncation,
  buildRetrievalResult,
  classifyGenericError,
  defineCapabilities,
  resolveSymbolExactly,
  unverified,
  verified,
} from '../../../supabase/functions/_shared/providers/mod.js';
import { RESPONSES } from './synthetic-responses.js';

export const FAKE_ID = 'fake_provider';

/**
 * @param {object} [opts]
 * @param {string} [opts.apiKey]          a fake secret; it must never leak
 * @param {Record<string, any>} [opts.responses]
 * @param {Record<string, any>} [opts.facts]  capability overrides
 */
export function createFakeProvider({ apiKey = '', responses = RESPONSES, facts = {} } = {}) {
  const secrets = [apiKey];

  const caps = defineCapabilities({
    providerId: FAKE_ID,
    facts: {
      markets: verified(['us_stock'], 'synthetic fixture'),
      oneMinuteData: verified(true, 'synthetic fixture'),
      historyDepth: unverified(),
      pageSize: unverified(),
      resultOrder: verified('ascending', 'synthetic fixture'),
      truncationSignal: verified('explicit', 'synthetic fixture'),
      timestampSemantics: verified({ zone: 'explicit offset', label: 'bar start' }, 'synthetic fixture'),
      maxSafeRangeMinutes: unverified(),
      rateLimit: unverified(),
      quota: unverified(),
      volume: unverified(),
      ...facts,
    },
  });

  function mapFailure(failure) {
    const byStatus = {
      401: ProviderErrorCode.AUTH_FAILED,
      404: ProviderErrorCode.SYMBOL_NOT_FOUND,
      429: ProviderErrorCode.RATE_LIMITED,
      503: ProviderErrorCode.PROVIDER_UNAVAILABLE,
    };
    return new ProviderError({
      code: byStatus[failure.status] ?? ProviderErrorCode.UNKNOWN,
      // Include the key on purpose: redaction must remove it.
      message: `${failure.message} (request key=${apiKey})`,
      providerId: FAKE_ID,
      retryAfterMs: failure.retryAfterSeconds ? failure.retryAfterSeconds * 1000 : undefined,
      detail: { status: failure.status },
      secrets,
    });
  }

  return {
    id: FAKE_ID,
    displayName: 'Fake provider (tests only)',
    capabilities: () => caps,
    resolveSymbol: (config) => resolveSymbolExactly(FAKE_ID, config),
    classifyError: (error) => classifyGenericError(error, FAKE_ID, secrets),

    async fetchCandles(request) {
      const response = responses[request.range.startUtc];
      if (!response) {
        throw new ProviderError({ code: ProviderErrorCode.UNKNOWN, message: 'no fixture', providerId: FAKE_ID });
      }
      if (response.failure) throw mapFailure(response.failure);
      if (response.malformed !== undefined) {
        throw new ProviderError({ code: ProviderErrorCode.MALFORMED_RESPONSE, message: 'response is not the expected format', providerId: FAKE_ID });
      }

      const rows = response.rows.map((r) => ({ timestamp: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
      const truncation =
        response.more === true ? Truncation.DETECTED : response.more === false ? Truncation.NONE : Truncation.UNKNOWN;

      return buildRetrievalResult({
        request,
        rows,
        truncation,
        providerNotes: [`served from fixture with key ${apiKey}`], // must be redacted
        secrets,
      });
    },
  };
}
