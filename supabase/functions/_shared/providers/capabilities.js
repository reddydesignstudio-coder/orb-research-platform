/**
 * Provider capability contract (PROVIDERS.md §11, §3).
 *
 * Every capability is a "fact" that is either VERIFIED (with a source — where
 * and when it was confirmed) or NOT VERIFIED. PROVIDERS.md marks most provider
 * facts "TO BE VERIFIED"; this module makes that rule enforceable: code that
 * needs a capability calls requireVerified(), which throws for an unverified
 * fact instead of letting the importer rely on a guess.
 *
 * Capabilities are configuration data supplied by each adapter, not constants
 * in shared code. Nothing here knows any provider's actual values.
 */

import { PROVIDER_ID_PATTERN } from './candle.js';

/**
 * @template T
 * @typedef {{ verified: true, value: T, source: string, note?: string }
 *         | { verified: false, value?: T, note?: string }} Fact
 * A verified fact needs a source (e.g. documentation URL + date checked, or
 * "owner's plan page, 2026-10-01"). An unverified fact may carry a candidate
 * value for reference, but it can never be required by code.
 */

/** Capability names every adapter must declare (all may start unverified). */
export const CAPABILITY_KEYS = Object.freeze([
  'markets', //            which markets the adapter can serve (compared with symbols.market)
  'oneMinuteData', //      whether historical 1-minute data is available
  'historyDepth', //       how far back 1-minute history goes
  'pageSize', //           maximum candles one response can contain
  'resultOrder', //        'ascending' | 'descending' — order of candles in a response
  'truncationSignal', //   'explicit' when the provider says "more data exists", else 'none'
  'timestampSemantics', // provider timezone + whether a timestamp labels bar start or end
  'maxSafeRangeMinutes', // largest range that cannot be truncated undetected (§6 rule 2)
  'rateLimit', //          request pacing limits on the owner's plan
  'quota', //              daily quota, how usage is counted, reset time
  'volume', //             whether volume is provided (per market)
]);

export class CapabilityNotVerifiedError extends Error {
  /** @param {string} providerId @param {string} key @param {string} [note] */
  constructor(providerId, key, note) {
    super(
      `Capability "${key}" of provider "${providerId}" is not verified` +
        (note ? ` (${note})` : '') +
        '. It must be confirmed from official documentation and the owner\'s plan before it is relied on (PROVIDERS.md).',
    );
    this.name = 'CapabilityNotVerifiedError';
    this.providerId = providerId;
    this.key = key;
  }
}

/**
 * @template T
 * @param {T} value
 * @param {string} source  where/when this was confirmed
 * @param {string} [note]
 * @returns {Fact<T>}
 */
export function verified(value, source, note) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new TypeError('A verified capability needs a non-empty source');
  }
  return Object.freeze({ verified: true, value, source, ...(note ? { note } : {}) });
}

/**
 * @param {string} [note]  e.g. "TO BE VERIFIED against official documentation"
 * @returns {Fact<never>}
 */
export function unverified(note = 'TO BE VERIFIED') {
  return Object.freeze({ verified: false, note });
}

function isFact(f) {
  if (!f || typeof f !== 'object' || typeof f.verified !== 'boolean') return false;
  if (f.verified) return 'value' in f && typeof f.source === 'string' && f.source.trim() !== '';
  return true;
}

/** Shape checks for values that code will compute with, when verified. */
const VALUE_CHECKS = Object.freeze({
  pageSize: (v) => Number.isInteger(v) && v > 0,
  maxSafeRangeMinutes: (v) => Number.isInteger(v) && v > 0,
  resultOrder: (v) => v === 'ascending' || v === 'descending',
  truncationSignal: (v) => v === 'explicit' || v === 'none',
  oneMinuteData: (v) => typeof v === 'boolean' || (v && typeof v === 'object'),
  markets: (v) => Array.isArray(v) && v.every((m) => typeof m === 'string' && m !== ''),
});

/**
 * Validate and freeze an adapter's capability declaration.
 * @param {object} decl
 * @param {string} decl.providerId
 * @param {Record<string, Fact<any>>} decl.facts  one entry per CAPABILITY_KEYS name
 */
export function defineCapabilities({ providerId, facts }) {
  if (typeof providerId !== 'string' || !PROVIDER_ID_PATTERN.test(providerId)) {
    throw new TypeError(`Invalid provider id: ${providerId}`);
  }
  if (!facts || typeof facts !== 'object') throw new TypeError('facts must be an object');

  const problems = [];
  for (const key of CAPABILITY_KEYS) {
    if (!(key in facts)) problems.push(`missing capability "${key}"`);
    else if (!isFact(facts[key])) problems.push(`capability "${key}" is not a valid fact`);
    else if (facts[key].verified && VALUE_CHECKS[key] && !VALUE_CHECKS[key](facts[key].value)) {
      problems.push(`capability "${key}" has an invalid verified value`);
    }
  }
  for (const key of Object.keys(facts)) {
    if (!CAPABILITY_KEYS.includes(key)) problems.push(`unknown capability "${key}"`);
  }
  if (problems.length) {
    throw new TypeError(`Invalid capabilities for "${providerId}": ${problems.join('; ')}`);
  }

  return Object.freeze({ providerId, facts: Object.freeze({ ...facts }) });
}

/**
 * Return a capability's value, or throw if it has not been verified.
 * @param {{ providerId: string, facts: Record<string, Fact<any>> }} caps
 * @param {string} key
 */
export function requireVerified(caps, key) {
  const fact = caps?.facts?.[key];
  if (!fact) throw new TypeError(`Unknown capability "${key}"`);
  if (!fact.verified) throw new CapabilityNotVerifiedError(caps.providerId, key, fact.note);
  return fact.value;
}

/** @returns {boolean} */
export function isVerified(caps, key) {
  return Boolean(caps?.facts?.[key]?.verified);
}

/** Keys still waiting for verification — for the Admin "provider status" view later. */
export function unverifiedKeys(caps) {
  return CAPABILITY_KEYS.filter((k) => !caps.facts[k].verified);
}
