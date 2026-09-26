/**
 * Data quality runs (TASK 014, D-029).
 *
 * pending — for every enabled symbol, check the sessions from the history start
 *   that have no data_quality row yet, in date order, stopping at the first
 *   session whose window has not been fully answered by succeeded import jobs
 *   (the import frontier): data not yet imported is never reported as missing.
 *   At most `perSymbol` sessions per symbol per call, so symbols stay balanced.
 * range — re-check (overwrite) the answered sessions of one symbol between two dates.
 *
 * Only already-stored data is read; nothing is fetched from a provider.
 */

import { mergeCoverage, missingRanges } from '../importer/coverage.js';
import { addDays } from '../sessions/calendar.js';
import { sessionDateOf, sessionFor } from '../sessions/validator.js';
import { assessSession } from './assess.js';

const isAnswered = (session, answered) => missingRanges({ startUtc: session.startUtc, endUtc: session.endUtc }, answered).length === 0;

/** First local session date whose window starts at or after the history start. */
export function firstSessionDate(symbol, historyStartUtc) {
  let d = sessionDateOf(symbol, historyStartUtc);
  if (sessionFor(symbol, d).startUtc < historyStartUtc) d = addDays(d, 1);
  return d;
}

/** Sessions to check for one symbol in pending mode. */
export function pendingSessions({ symbol, assessed, answered, historyStartUtc, todayDate, limit }) {
  const merged = mergeCoverage(answered);
  const out = [];
  let frontierDate = null;
  for (let d = firstSessionDate(symbol, historyStartUtc); d <= todayDate && out.length < limit; d = addDays(d, 1)) {
    if (assessed.has(d)) continue;
    const s = sessionFor(symbol, d);
    if (!isAnswered(s, merged)) {
      frontierDate = d;
      break;
    }
    out.push(s);
  }
  return { sessions: out, frontierDate, more: out.length >= limit };
}

/** Sessions of one symbol between two local dates (inclusive from, exclusive to), split by answered. */
export function rangeSessions({ symbol, answered, fromDate, toDate }) {
  const merged = mergeCoverage(answered);
  const sessions = [];
  const notImported = [];
  for (let d = fromDate; d < toDate; d = addDays(d, 1)) {
    const s = sessionFor(symbol, d);
    (isAnswered(s, merged) ? sessions : notImported).push(s);
  }
  return { sessions, notImported: notImported.map((s) => s.date) };
}

/** Assess sessions of one symbol using one candle read spanning them all. */
export async function assessAndStore({ symbol, sessions, store, nowIso }) {
  if (!sessions.length) return [];
  const startUtc = sessions.reduce((m, s) => (s.startUtc < m ? s.startUtc : m), sessions[0].startUtc);
  const endUtc = sessions.reduce((m, s) => (s.endUtc > m ? s.endUtc : m), sessions[0].endUtc);
  const candles = await store.candlesBetween(symbol.id, startUtc, endUtc);
  let i = 0;
  const sorted = [...sessions].sort((a, b) => (a.startUtc < b.startUtc ? -1 : 1));
  const rows = sorted.map((s) => {
    const inWindow = [];
    while (i < candles.length && candles[i].timestampUtc < s.startUtc) i += 1;
    for (let j = i; j < candles.length && candles[j].timestampUtc < s.endUtc; j += 1) inWindow.push(candles[j]);
    return { symbol_id: symbol.id, ...assessSession(s, inWindow), checked_at: nowIso };
  });
  await store.upsertRows(rows);
  return rows;
}

/** { complete: n, incomplete: n, … } */
export function countByStatus(rows) {
  const out = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}
