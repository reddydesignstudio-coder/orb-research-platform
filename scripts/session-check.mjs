#!/usr/bin/env node
/**
 * Session check (TASK 013, D-028) — read-only.
 *
 * Runs the session validator over the candles actually stored in Supabase for
 * every enabled symbol and a date range, and reports per symbol:
 *   open sessions (expected 90) → complete / incomplete / no data / not yet imported,
 *   closed sessions (weekend, holiday, special closure) → and whether any candles exist on them,
 *   candles outside the research window or not on a whole minute.
 * A session counts as "not yet imported" when its window is not fully answered by
 * succeeded import jobs — it is not reported as missing data.
 *
 * It reads only (PostgREST GET) and changes nothing. No provider call, no credits.
 *
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… FROM=2025-09-26 TO=2026-01-03 node scripts/session-check.mjs
 *   (TO is exclusive; dates are local session dates in each symbol's session time zone.)
 */
import { appendFile } from 'node:fs/promises';
import { createRestClient } from '../supabase/functions/_shared/server/rest.js';
import { loadEnabledSymbols } from '../supabase/functions/_shared/server/symbols.js';
import { createImportStore } from '../supabase/functions/_shared/importer/store.js';
import { mergeCoverage, missingRanges } from '../supabase/functions/_shared/importer/coverage.js';
import { checkSessionCandles, sessionDateOf, sessionsBetween } from '../supabase/functions/_shared/sessions/validator.js';

const PAGE = 1000;
const MAX_LISTED = 8;

/**
 * Summarise one symbol. Pure: sessions from the validator, stored timestamps, answered coverage.
 * @param {object} symbol   symbols row
 * @param {string} from     local date (inclusive)
 * @param {string} to       local date (exclusive)
 * @param {string[]} timestamps  stored candle timestamps (UTC ISO) between the first session start and last session end
 * @param {{start:string,end:string}[]} answered  answered coverage (merged or not)
 */
export function summariseSymbol(symbol, from, to, timestamps, answered) {
  const merged = mergeCoverage(answered);
  const byDate = new Map();
  for (const ts of timestamps) {
    const d = sessionDateOf(symbol, ts);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(ts);
  }
  const s = {
    symbol: symbol.symbol, market: symbol.market, openSessions: 0, closedSessions: 0,
    complete: 0, incomplete: 0, noData: 0, notYetImported: 0, missingCandles: 0,
    closedWithCandles: [], incompleteDays: [], noDataDays: [], outsideWindow: 0, notOnMinute: 0, closedDays: [],
  };
  for (const session of sessionsBetween(symbol, from, to)) {
    const r = checkSessionCandles(session, byDate.get(session.date) ?? []);
    s.outsideWindow += r.outsideWindow.length;
    s.notOnMinute += r.notOnMinute.length;
    if (!session.open) {
      s.closedSessions += 1;
      if (session.reason !== 'weekend') s.closedDays.push(`${session.date} ${session.closedFor}`);
      if (r.onClosedDay.length) s.closedWithCandles.push(`${session.date} (${r.onClosedDay.length})`);
      continue;
    }
    s.openSessions += 1;
    const answeredFully = missingRanges({ startUtc: session.startUtc, endUtc: session.endUtc }, merged).length === 0;
    if (r.status === 'complete') s.complete += 1;
    else if (!answeredFully) s.notYetImported += 1;
    else if (r.status === 'no_data') {
      s.noData += 1;
      s.noDataDays.push(session.date);
    } else {
      s.incomplete += 1;
      s.missingCandles += r.missing.length;
      s.incompleteDays.push(`${session.date} (${r.present}/90)`);
    }
  }
  return s;
}

const list = (items) => (items.length ? items.slice(0, MAX_LISTED).join(', ') + (items.length > MAX_LISTED ? ` … +${items.length - MAX_LISTED}` : '') : '—');

/** Markdown report. */
export function formatSessionReport({ from, to, summaries }) {
  const lines = [
    `## Session check — ${from} → ${to} (exclusive)`,
    '',
    'Read-only. Research window 09:30–11:00 America/New_York; open sessions expect 90 candles, closed ones 0.',
    '',
    '| Symbol | Market | Open | Complete | Incomplete (missing) | No data | Not yet imported | Closed | Candles on closed days | Outside window |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...summaries.map((s) => `| ${s.symbol} | ${s.market} | ${s.openSessions} | ${s.complete} | ${s.incomplete} (${s.missingCandles}) | ${s.noData} | ${s.notYetImported} | ${s.closedSessions} | ${s.closedWithCandles.length} | ${s.outsideWindow + s.notOnMinute} |`),
    '',
  ];
  for (const s of summaries) {
    if (!s.incompleteDays.length && !s.noDataDays.length && !s.closedWithCandles.length && !s.closedDays.length) continue;
    lines.push(`**${s.symbol}** — holidays: ${list(s.closedDays)}; incomplete: ${list(s.incompleteDays)}; no data: ${list(s.noDataDays)}; candles on closed days: ${list(s.closedWithCandles)}`, '');
  }
  return lines.join('\n');
}

async function storedTimestamps(rest, symbolId, startUtc, endUtc) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest.select('candles', {
      symbol_id: `eq.${symbolId}`,
      interval: 'eq.1min',
      and: `(timestamp_utc.gte.${startUtc},timestamp_utc.lt.${endUtc})`,
      select: 'timestamp_utc',
      order: 'timestamp_utc.asc',
      limit: String(PAGE),
      offset: String(offset),
    });
    for (const r of rows) out.push(new Date(r.timestamp_utc).toISOString());
    if (rows.length < PAGE) return out;
  }
}

async function main() {
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = process.env;
  if (!base || !key?.startsWith('sb_secret_')) {
    console.error('SUPABASE_URL and a Supabase secret key (SUPABASE_SECRET_KEY, starts with sb_secret_) are required.');
    process.exit(2);
  }
  const from = process.env.FROM || '2025-09-26';
  const to = process.env.TO || '2026-01-03';
  const rest = createRestClient({ baseUrl: base, key });
  const store = createImportStore(rest);
  const summaries = [];
  for (const symbol of await loadEnabledSymbols(rest)) {
    const sessions = sessionsBetween(symbol, from, to);
    // Whole local days, so candles outside the window are seen too.
    const startUtc = new Date(Date.parse(sessions[0].startUtc) - 10 * 3_600_000).toISOString();
    const endUtc = new Date(Date.parse(sessions.at(-1).endUtc) + 13 * 3_600_000).toISOString();
    const [timestamps, answered] = await Promise.all([
      storedTimestamps(rest, symbol.id, startUtc, endUtc),
      store.answeredRanges(symbol.id, symbol.provider),
    ]);
    const inRange = timestamps.filter((ts) => {
      const d = sessionDateOf(symbol, ts);
      return d >= from && d < to;
    });
    summaries.push(summariseSymbol(symbol, from, to, inRange, answered));
    console.log(`${symbol.symbol}: ${inRange.length} stored candles checked`);
  }
  const report = formatSessionReport({ from, to, summaries }).split(key).join('[REDACTED]');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(`Session check failed: ${e?.message ?? e}`);
  process.exit(1);
});
