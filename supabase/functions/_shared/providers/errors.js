/**
 * Provider error classification (PROVIDERS.md §9, §10, §13).
 *
 * The categories are the "(proposed)" list in PROVIDERS.md §10. Each adapter maps
 * its provider's own errors onto them; how that mapping works for a specific
 * provider is TO BE VERIFIED in that adapter's task.
 *
 * Plain ES module: runs unchanged in Deno (Edge Functions) and Node (tests).
 */

/** @enum {string} */
export const ProviderErrorCode = Object.freeze({
  AUTH_FAILED: 'AUTH_FAILED',
  PLAN_RESTRICTED: 'PLAN_RESTRICTED',
  SYMBOL_NOT_FOUND: 'SYMBOL_NOT_FOUND',
  INTERVAL_UNSUPPORTED: 'INTERVAL_UNSUPPORTED',
  NO_DATA_RETURNED: 'NO_DATA_RETURNED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  UNKNOWN: 'UNKNOWN',
});

/**
 * What the caller should do next (PROVIDERS.md §9).
 *   retry_with_backoff  transient: retried with backoff
 *   wait_then_retry     rate limit: retried, not before the signalled/configured wait
 *   wait_for_quota      quota: no requests to this provider until the quota resets
 *   needs_human         not retried automatically; shown to the owner
 *   not_an_error        the range was answered; nothing to retry (see §12)
 * @enum {string}
 */
export const RetryPolicy = Object.freeze({
  RETRY_WITH_BACKOFF: 'retry_with_backoff',
  WAIT_THEN_RETRY: 'wait_then_retry',
  WAIT_FOR_QUOTA: 'wait_for_quota',
  NEEDS_HUMAN: 'needs_human',
  NOT_AN_ERROR: 'not_an_error',
});

const POLICY = Object.freeze({
  [ProviderErrorCode.NETWORK_ERROR]: RetryPolicy.RETRY_WITH_BACKOFF,
  [ProviderErrorCode.TIMEOUT]: RetryPolicy.RETRY_WITH_BACKOFF,
  [ProviderErrorCode.PROVIDER_UNAVAILABLE]: RetryPolicy.RETRY_WITH_BACKOFF,
  [ProviderErrorCode.RATE_LIMITED]: RetryPolicy.WAIT_THEN_RETRY,
  [ProviderErrorCode.QUOTA_EXHAUSTED]: RetryPolicy.WAIT_FOR_QUOTA,
  [ProviderErrorCode.AUTH_FAILED]: RetryPolicy.NEEDS_HUMAN,
  [ProviderErrorCode.PLAN_RESTRICTED]: RetryPolicy.NEEDS_HUMAN,
  [ProviderErrorCode.SYMBOL_NOT_FOUND]: RetryPolicy.NEEDS_HUMAN,
  [ProviderErrorCode.INTERVAL_UNSUPPORTED]: RetryPolicy.NEEDS_HUMAN,
  // An unparseable response is not automatically retried: it is recorded and
  // shown, because retrying cannot fix a format the adapter does not understand.
  [ProviderErrorCode.MALFORMED_RESPONSE]: RetryPolicy.NEEDS_HUMAN,
  [ProviderErrorCode.UNKNOWN]: RetryPolicy.NEEDS_HUMAN,
  [ProviderErrorCode.NO_DATA_RETURNED]: RetryPolicy.NOT_AN_ERROR,
});

/**
 * @param {string} code
 * @returns {string} RetryPolicy value
 */
export function retryPolicyFor(code) {
  const policy = POLICY[code];
  if (!policy) throw new TypeError(`Unknown provider error code: ${code}`);
  return policy;
}

/**
 * Replace every occurrence of each secret in `text` with "[REDACTED]".
 * Used for messages, notes and any recorded request URL (PROVIDERS.md §13).
 * @param {unknown} text
 * @param {Array<string | null | undefined>} secrets
 * @returns {string}
 */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    out = out.split(secret).join('[REDACTED]');
    // Also catch the URL-encoded form, in case a key was placed in a query string.
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join('[REDACTED]');
  }
  return out;
}

/**
 * The only error type adapters throw for provider problems.
 * `message` is always redacted with the secrets the adapter passes in.
 */
export class ProviderError extends Error {
  /**
   * @param {object} p
   * @param {string} p.code              one of ProviderErrorCode
   * @param {string} p.message           human-readable explanation
   * @param {string} p.providerId        adapter id
   * @param {number} [p.retryAfterMs]    provider-signalled wait, when the provider gives one
   * @param {unknown} [p.detail]         extra non-secret detail (e.g. provider status code)
   * @param {string[]} [p.secrets]       values to redact from message/detail
   */
  constructor({ code, message, providerId, retryAfterMs, detail, secrets = [] }) {
    if (!Object.values(ProviderErrorCode).includes(code)) {
      throw new TypeError(`Unknown provider error code: ${code}`);
    }
    if (typeof providerId !== 'string' || providerId === '') {
      throw new TypeError('ProviderError requires providerId');
    }
    super(redactSecrets(message, secrets));
    this.name = 'ProviderError';
    this.code = code;
    this.providerId = providerId;
    this.retryPolicy = retryPolicyFor(code);
    this.retryAfterMs =
      Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.round(retryAfterMs) : undefined;
    this.detail = detail === undefined ? undefined : redactSecrets(JSON.stringify(detail), secrets);
  }

  /** Values suitable for import_jobs.error_code / error_message (DATABASE.md). */
  toRecord() {
    return { error_code: this.code, error_message: this.message };
  }
}

/**
 * Last-resort classification for anything that is not already a ProviderError.
 * Adapters call this from their own classifyError() for failures they do not
 * specifically recognise. It never guesses a provider-specific meaning.
 * @param {unknown} error
 * @param {string} providerId
 * @param {string[]} [secrets]
 * @returns {ProviderError}
 */
export function classifyGenericError(error, providerId, secrets = []) {
  if (error instanceof ProviderError) return error;
  const name = /** @type {any} */ (error)?.name;
  const message = /** @type {any} */ (error)?.message ?? String(error);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ProviderError({ code: ProviderErrorCode.TIMEOUT, message, providerId, secrets });
  }
  if (error instanceof TypeError && /fetch|network|connect|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new ProviderError({ code: ProviderErrorCode.NETWORK_ERROR, message, providerId, secrets });
  }
  return new ProviderError({ code: ProviderErrorCode.UNKNOWN, message, providerId, secrets });
}
