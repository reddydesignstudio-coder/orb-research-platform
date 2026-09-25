/**
 * Shared provider contract checks (PROVIDERS.md §15).
 *
 * Every adapter's test file (Twelve Data in TASK 006, later others) calls
 * checkProviderContract() with its own recorded/synthetic fixtures and asserts
 * that the returned list of violations is empty. No live provider is called.
 *
 * Returns violations instead of throwing, so the checker itself can be tested
 * against deliberately broken providers.
 */

import {
  CAPABILITY_KEYS,
  ProviderError,
  ProviderErrorCode,
  ProviderMismatchError,
  assertMarketDataProvider,
  defineRange,
  defineRequest,
} from '../../supabase/functions/_shared/providers/mod.js';

const ISO_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * @typedef {object} ContractScenario
 * @property {string} name
 * @property {[string, string]} range                 [startUtc, endUtc)
 * @property {'ok'|'error'} expect
 * @property {number} [candles]                       expected accepted candles (expect: ok)
 * @property {number} [rejected]                      expected rejected rows (expect: ok)
 * @property {string} [truncation]                    expected truncation value (expect: ok)
 * @property {string} [errorCode]                     expected ProviderErrorCode (expect: error)
 */

/**
 * @param {object} p
 * @param {object} p.provider              the adapter under test
 * @param {object} p.symbolConfig          a symbols-table row for this provider
 * @param {ContractScenario[]} p.scenarios
 * @param {string[]} [p.secrets]           values that must never appear in any output
 * @returns {Promise<string[]>} violations (empty = contract satisfied)
 */
export async function checkProviderContract({ provider, symbolConfig, scenarios, secrets = [] }) {
  const v = [];
  const leak = (where, value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    for (const s of secrets) if (s && text.includes(s)) v.push(`secret leaked in ${where}`);
  };

  // 1. Shape
  try {
    assertMarketDataProvider(provider);
  } catch (e) {
    return [`not a MarketDataProvider: ${e.message}`];
  }

  // 2. Capabilities (§11)
  try {
    const caps = provider.capabilities();
    if (caps?.providerId !== provider.id) v.push('capabilities().providerId does not match id');
    for (const key of CAPABILITY_KEYS) {
      if (!caps?.facts?.[key]) v.push(`capability "${key}" missing`);
    }
    leak('capabilities', caps);
  } catch (e) {
    v.push(`capabilities() threw: ${e.message}`);
  }

  // 3. Symbol mapping is exact and never crosses providers (§5, §14)
  let resolved;
  try {
    resolved = provider.resolveSymbol(symbolConfig);
    if (resolved.providerSymbol !== symbolConfig.provider_symbol) {
      v.push(`resolveSymbol changed "${symbolConfig.provider_symbol}" to "${resolved.providerSymbol}"`);
    }
    if (resolved.provider !== provider.id) v.push('resolveSymbol returned a different provider');
  } catch (e) {
    v.push(`resolveSymbol threw for its own symbol: ${e.message}`);
  }
  try {
    provider.resolveSymbol({ ...symbolConfig, provider: `${provider.id}_other` });
    v.push('resolveSymbol accepted a symbol configured for another provider');
  } catch (e) {
    if (!(e instanceof ProviderMismatchError)) v.push(`wrong error for foreign symbol: ${e.name}`);
  }
  if (!resolved) return v;

  // 4. classifyError always yields a ProviderError with a known code (§10)
  for (const probe of [new Error('boom'), new TypeError('fetch failed'), 'plain string']) {
    try {
      const pe = provider.classifyError(probe);
      if (!(pe instanceof ProviderError)) v.push('classifyError did not return a ProviderError');
      else if (pe.providerId !== provider.id) v.push('classifyError providerId mismatch');
      leak('classifyError', pe.message);
    } catch (e) {
      v.push(`classifyError threw: ${e.message}`);
    }
  }

  // 5. Retrieval scenarios (§1.1, §2, §6, §12, §13)
  for (const sc of scenarios) {
    const tag = `scenario "${sc.name}"`;
    const request = defineRequest({ symbol: resolved, range: defineRange(sc.range[0], sc.range[1]) });
    const before = JSON.stringify(request);
    let result;
    try {
      result = await provider.fetchCandles(request);
    } catch (e) {
      if (sc.expect !== 'error') {
        v.push(`${tag}: unexpected error ${e?.code ?? e?.name}: ${e?.message}`);
      } else if (!(e instanceof ProviderError)) {
        v.push(`${tag}: failure was not a ProviderError (${e?.name})`);
      } else {
        if (e.code !== sc.errorCode) v.push(`${tag}: error code ${e.code}, expected ${sc.errorCode}`);
        if (e.providerId !== provider.id) v.push(`${tag}: error providerId mismatch`);
        if (!Object.values(ProviderErrorCode).includes(e.code)) v.push(`${tag}: unknown error code`);
        leak(`${tag} error`, `${e.message} ${e.detail ?? ''}`);
      }
      continue;
    }
    if (JSON.stringify(request) !== before) v.push(`${tag}: request was modified`);
    if (sc.expect === 'error') {
      v.push(`${tag}: expected error ${sc.errorCode}, got a result`);
      continue;
    }
    leak(tag, result);

    if (result.provider !== provider.id) v.push(`${tag}: result.provider mismatch`);
    if (result.providerSymbol !== symbolConfig.provider_symbol) v.push(`${tag}: result.providerSymbol mismatch`);
    if (result.requestedRange?.startUtc !== request.range.startUtc || result.requestedRange?.endUtc !== request.range.endUtc) {
      v.push(`${tag}: requestedRange does not echo the request`);
    }
    if (!['detected', 'none', 'unknown'].includes(result.truncation)) v.push(`${tag}: invalid truncation value`);
    if (sc.truncation && result.truncation !== sc.truncation) {
      v.push(`${tag}: truncation ${result.truncation}, expected ${sc.truncation}`);
    }

    const candles = result.candles ?? [];
    const rejected = result.rejected ?? [];
    if (result.receivedCount !== candles.length + rejected.length) {
      v.push(`${tag}: receivedCount ${result.receivedCount} ≠ accepted ${candles.length} + rejected ${rejected.length} (rows silently dropped?)`);
    }
    if (sc.candles !== undefined && candles.length !== sc.candles) v.push(`${tag}: ${candles.length} candles, expected ${sc.candles}`);
    if (sc.rejected !== undefined && rejected.length !== sc.rejected) v.push(`${tag}: ${rejected.length} rejected, expected ${sc.rejected}`);
    for (const r of rejected) if (!r.reason) v.push(`${tag}: rejected row without a reason`);

    let prev = '';
    for (const c of candles) {
      if (!ISO_MINUTE.test(c.timestampUtc)) v.push(`${tag}: timestamp not UTC whole-minute: ${c.timestampUtc}`);
      if (!(c.timestampUtc >= request.range.startUtc && c.timestampUtc < request.range.endUtc)) {
        v.push(`${tag}: candle ${c.timestampUtc} outside requested range`);
      }
      if (c.timestampUtc < prev) v.push(`${tag}: candles not in ascending order`);
      prev = c.timestampUtc;
      for (const f of ['open', 'high', 'low', 'close']) {
        if (typeof c[f] !== 'string' || !DECIMAL.test(c[f])) v.push(`${tag}: ${f} is not an exact decimal string`);
      }
      if (c.volume !== null && (typeof c.volume !== 'string' || !DECIMAL.test(c.volume))) {
        v.push(`${tag}: volume must be a decimal string or null`);
      }
      if (c.interval !== '1min') v.push(`${tag}: interval must be 1min`);
      if (c.provider !== provider.id) v.push(`${tag}: candle provider mismatch`);
    }
    const expectCovered = candles.length ? { first: candles[0].timestampUtc, last: candles.at(-1).timestampUtc } : null;
    if (JSON.stringify(result.coveredRange) !== JSON.stringify(expectCovered)) v.push(`${tag}: coveredRange inconsistent with candles`);
  }

  return v;
}
