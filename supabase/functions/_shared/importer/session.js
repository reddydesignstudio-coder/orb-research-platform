/**
 * Research-window filter (TASK 011, D-025).
 *
 * The owner decided to store only candles inside each symbol's configured
 * research window (symbols.session_timezone / session_start / session_end):
 * 09:30 → 11:00 America/New_York for every symbol, 11:00 excluded, so a
 * complete window is 90 one-minute candles (PROJECT.md §4). Days are not
 * filtered: a market that is closed simply has no candles (crypto trades daily).
 *
 * Local time comes from the IANA time-zone database (Intl), never from a fixed
 * offset, so EST/EDT changes are handled automatically (RULES.md — TIMEZONE).
 */

import { localParts, minutesOf, zoneFormatter } from '../sessions/time.js';

/**
 * @param {{ session_timezone: string, session_start: string|null, session_end: string|null }} symbol
 * @returns {null | { label: string, contains: (isoUtc: string) => boolean }}
 *          null when the symbol has no research window configured
 */
export function researchWindow(symbol) {
  if (!symbol?.session_start || !symbol?.session_end) return null;
  const tz = symbol.session_timezone;
  const start = minutesOf(symbol.session_start);
  const end = minutesOf(symbol.session_end);
  if (!(end > start)) throw new RangeError(`Session end must be after start for ${symbol.symbol ?? 'symbol'}`);
  try {
    zoneFormatter(tz);
  } catch {
    throw new RangeError(`Unknown session_timezone "${tz}"`);
  }
  const hhmm = (s) => s.slice(0, 5);
  return Object.freeze({
    label: `${hhmm(symbol.session_start)}–${hhmm(symbol.session_end)} ${tz}`,
    contains(isoUtc) {
      const local = localParts(isoUtc, tz).minutes;
      return local >= start && local < end; // end is exclusive: 11:00 is not in the window
    },
  });
}
