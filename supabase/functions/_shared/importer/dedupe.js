/**
 * Duplicate handling before and after storage (TASK 010; RULES.md — DATA 7;
 * PROVIDERS.md §6 rule 5). Three cases, none of which is ever resolved by guessing:
 *
 *  1. The same minute repeated INSIDE one response with identical values
 *     → stored once; the repeats are counted as duplicates.
 *  2. The same minute repeated inside one response with DIFFERENT values
 *     → no version is stored (choosing one would be a guess); every row is
 *       rejected as CONFLICTING_DUPLICATE and reported. PostgreSQL's
 *       ON CONFLICT DO NOTHING would otherwise silently keep the first.
 *  3. A minute that is ALREADY STORED
 *     → skipped by the unique key and counted as a duplicate; if the provider
 *       now sends different values, the stored candle is kept (candles are
 *       immutable) and the difference is reported as REVISED_BY_PROVIDER.
 */

import { compareDecimal } from './validate.js';

export const DuplicateReason = Object.freeze({ CONFLICTING_DUPLICATE: 'CONFLICTING_DUPLICATE' });

const sameDecimal = (a, b) => (a === null || b === null ? a === b : compareDecimal(a, b) === 0);

/** Exact value equality of two candles (prices and volume as decimals; "10.50" = "10.5"). */
export function sameValues(a, b) {
  return ['open', 'high', 'low', 'close', 'volume'].every((f) => sameDecimal(a[f] ?? null, b[f] ?? null));
}

/**
 * Cases 1 and 2 for one response.
 * @param {object[]} candles  normalized + validated candles
 * @returns {{ unique: object[], repeats: number, conflicting: { reason: string, candle: object }[] }}
 */
export function dedupeResponse(candles) {
  const byTime = new Map();
  for (const c of candles) {
    const list = byTime.get(c.timestampUtc);
    if (list) list.push(c);
    else byTime.set(c.timestampUtc, [c]);
  }
  const unique = [];
  const conflicting = [];
  let repeats = 0;
  for (const list of byTime.values()) {
    if (list.every((c) => sameValues(c, list[0]))) {
      unique.push(list[0]);
      repeats += list.length - 1;
    } else {
      for (const c of list) conflicting.push({ reason: DuplicateReason.CONFLICTING_DUPLICATE, candle: c });
    }
  }
  unique.sort((a, b) => (a.timestampUtc < b.timestampUtc ? -1 : 1));
  return { unique, repeats, conflicting };
}

/**
 * Case 3: compare candles that were already stored with what the provider sent now.
 * @param {object[]} sent     candles the provider sent that were not inserted
 * @param {object[]} stored   the stored candles for those minutes
 * @returns {string[]} minutes (ISO UTC) whose stored values differ
 */
export function revisedMinutes(sent, stored) {
  const byTime = new Map(stored.map((s) => [s.timestampUtc, s]));
  return sent.filter((c) => byTime.has(c.timestampUtc) && !sameValues(c, byTime.get(c.timestampUtc))).map((c) => c.timestampUtc);
}
