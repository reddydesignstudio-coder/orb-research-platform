#!/usr/bin/env node
/**
 * Provider live check (TASK 007, PROVIDERS.md §15 / open item P-5).
 *
 * Calls the deployed market-data Edge Function a few times — paced well under
 * the Basic plan's 8 requests/minute — and writes a readable report of what
 * Twelve Data actually returned. It stores nothing and changes nothing.
 * Not part of automated tests: it needs the live function and a key.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=… node scripts/live-check.mjs
 *
 * The secret key is only sent in the apikey header; it is never printed.
 * Output: Markdown on stdout (and appended to $GITHUB_STEP_SUMMARY when set).
 */
import { appendFile } from 'node:fs/promises';

const PACE_MS = 10_000; // ≤ 6 calls per minute (Basic allows 8)
const NY = 'America/New_York';

/** Offset of a timezone at an instant, in minutes (e.g. −240 for EDT). */
function offsetMinutes(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - ms) / 60_000);
}

/** Local wall time in a named timezone → UTC ISO. DST handled by the tz database. */
export function zonedToUtc(date, time, timeZone) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  let ms = guess - offsetMinutes(guess, timeZone) * 60_000;
  ms = guess - offsetMinutes(ms, timeZone) * 60_000; // second pass settles DST edges
  return new Date(ms).toISOString();
}

/** Most recent weekday strictly before `nowMs`'s New York date (YYYY-MM-DD). */
export function previousWeekday(nowMs) {
  const ny = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(new Date(nowMs)); // YYYY-MM-DD
  let d = new Date(`${ny}T12:00:00Z`);
  do d = new Date(d.getTime() - 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Most recent Saturday before `nowMs` (YYYY-MM-DD). */
export function previousSaturday(nowMs) {
  let d = new Date(new Date(nowMs).toISOString().slice(0, 10) + 'T12:00:00Z');
  do d = new Date(d.getTime() - 86_400_000);
  while (d.getUTCDay() !== 6);
  return d.toISOString().slice(0, 10);
}

/** The probes, each answering one open question from PROVIDERS.md §3 / P-5. */
export function buildProbes(nowMs) {
  const day = previousWeekday(nowMs);
  const sat = previousSaturday(nowMs);
  const open = zonedToUtc(day, '09:30', NY);
  const close = zonedToUtc(day, '11:00', NY);
  const utcHour = (h) => `${day}T${h}:00:00.000Z`;
  return [
    { id: 'us-window', question: `SPY opening window ${day} 09:30–11:00 ET: format, 90 candles, volume, end_date inclusive?`, body: { symbol: 'SPY', startUtc: open, endUtc: close } },
    { id: 'forex', question: 'EUR/USD 60 min: 1-minute data and volume for forex', body: { symbol: 'EUR/USD', startUtc: utcHour('14'), endUtc: utcHour('15') } },
    { id: 'crypto', question: 'BTC/USD 60 min: 1-minute data and volume for crypto', body: { symbol: 'BTC/USD', startUtc: utcHour('14'), endUtc: utcHour('15') } },
    { id: 'gold', question: 'XAU/USD 60 min: is gold available on the Basic plan?', body: { symbol: 'XAU/USD', startUtc: utcHour('14'), endUtc: utcHour('15') } },
    { id: 'no-data', question: `SPY on Saturday ${sat}: wording of a "no data" answer`, body: { symbol: 'SPY', startUtc: zonedToUtc(sat, '09:30', NY), endUtc: zonedToUtc(sat, '11:00', NY) } },
  ];
}

/** One Markdown section per probe. Never includes request headers. */
export function describe(probe, status, json) {
  const lines = [`### ${probe.id} — ${probe.question}`, '', `Request: \`${JSON.stringify(probe.body)}\` → HTTP ${status}`, ''];
  if (!json?.ok) {
    const e = json?.error ?? {};
    lines.push(`**Error** \`${e.code ?? 'unknown'}\`: ${e.message ?? '(no message)'}`);
    if (e.retryPolicy) lines.push(`Retry policy: ${e.retryPolicy}${e.retryAfterMs !== undefined ? `, wait ${e.retryAfterMs} ms` : ''}`);
    return lines.join('\n');
  }
  const r = json.result;
  const c = r.candles ?? [];
  const withVolume = c.filter((x) => x.volume !== null).length;
  const reasons = {};
  for (const x of r.rejected ?? []) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
  const boundary = (r.rejected ?? []).some((x) => x.reason === 'OUTSIDE_REQUESTED_RANGE' && x.raw?.timestampUtc === r.requestedRange.endUtc);
  lines.push(
    `| | |`, `|---|---|`,
    `| Rows received | ${r.receivedCount} |`,
    `| Candles accepted | ${c.length} (expected slots: ${r.requestedRange.minutes}) |`,
    `| First / last | ${r.coveredRange ? `${r.coveredRange.first} / ${r.coveredRange.last}` : '—'} |`,
    `| Candles with volume | ${withVolume} of ${c.length} |`,
    `| Rejected | ${Object.keys(reasons).length ? Object.entries(reasons).map(([k, v]) => `${k} ×${v}`).join(', ') : 'none'} |`,
    `| Bar at the (exclusive) range end returned | ${boundary ? 'yes — rejected, belongs to the next range' : 'no'} |`,
    `| Truncation / completeness | ${r.truncation} / ${json.completeness.state} |`,
    `| Provider notes | ${(r.providerNotes ?? []).join(' · ') || '—'} |`,
  );
  if (c.length) lines.push('', `Sample first candle: \`${JSON.stringify(c[0])}\``);
  return lines.join('\n');
}

async function main() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) {
    console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (GitHub secret SUPABASE_SECRET_KEY).');
    process.exit(2);
  }
  if (!key.startsWith('sb_secret_')) {
    console.error('SUPABASE_SECRET_KEY must be a Supabase secret key (starts with sb_secret_). Its value is not shown.');
    process.exit(2);
  }
  const probes = buildProbes(Date.now());
  const out = [`## Provider live check — ${new Date().toISOString()}`, '', 'Function: market-data · provider calls paced 10 s apart', ''];
  let reachedFunction = true;
  for (const [i, probe] of probes.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
    let status = 0;
    let json;
    try {
      const res = await fetch(`${base}/functions/v1/market-data`, {
        method: 'POST',
        headers: { apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify(probe.body),
      });
      status = res.status;
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = { ok: false, error: { code: 'NOT_JSON', message: text.slice(0, 300) } };
      }
    } catch (e) {
      json = { ok: false, error: { code: 'NETWORK_ERROR', message: e.message } };
    }
    // Our function always answers JSON with "ok"; anything else means it was not reached or refused us.
    if (status === 0 || status === 401 || typeof json?.ok !== 'boolean' || json?.error?.code === 'NOT_JSON') reachedFunction = false;
    out.push(describe(probe, status, json), '');
  }
  const report = out.join('\n').split(key).join('[REDACTED]');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  if (!reachedFunction) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
