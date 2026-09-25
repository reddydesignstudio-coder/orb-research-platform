/**
 * Market-data provider layer — public entry point (TASK 005, PROVIDERS.md).
 *
 * Provider-neutral only. No provider adapter lives here; each adapter
 * (the first one arrives in TASK 006) imports from this module.
 */

export {
  INTERVAL_1MIN,
  PROVIDER_ID_PATTERN,
  RejectReason,
  normalizeCandle,
  normalizeCandles,
  toDecimalString,
  toUtcMinute,
} from './candle.js';

export {
  CAPABILITY_KEYS,
  CapabilityNotVerifiedError,
  defineCapabilities,
  isVerified,
  requireVerified,
  unverified,
  unverifiedKeys,
  verified,
} from './capabilities.js';

export {
  ProviderError,
  ProviderErrorCode,
  RetryPolicy,
  classifyGenericError,
  redactSecrets,
  retryPolicyFor,
} from './errors.js';

export {
  REQUIRED_MEMBERS,
  ProviderMismatchError,
  assertMarketDataProvider,
  resolveSymbolExactly,
} from './provider.js';

export { ProviderNotRegisteredError, createProviderRegistry } from './registry.js';

export {
  Truncation,
  assessCompleteness,
  buildRetrievalResult,
  defineRange,
  defineRequest,
  rangeContains,
  remainingRange,
  splitRange,
} from './retrieval.js';
