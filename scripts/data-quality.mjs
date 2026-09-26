#!/usr/bin/env node
/**
 * Data quality run (TASK 014, D-029) — calls the deployed data-quality function.
 *
 *   pending (default): repeats { pending: true } until every answered session has a
 *     data_quality row (or MAX_CALLS is reached), then reports.
 *   range: { symbol, from, to } re-checks one symbol's sessions and lists them.
 *
 * Also used by the import scheduler after its import loop (import-scheduler.mjs).
 * Reads stored candles only: no provider call, no credits.
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, QUALITY_MODE (pending | range), QUALITY_SYMBOL, FROM, TO.
 */
import { appendFile } from 'node:fs/promises';

export const MAX_CALLS = 20;
const PER_SYMBOL = 30;
const MAX_PROBLEMS = 8;

export async function callQuality(base, key, body) {
  try {
    const res = await fetch(`${base}/functions/v1/data-quality`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status, json: null };
    }
  } catch {
    return { status: 0, json: null };
  }
}

/** Repeat pending calls; merge per-symbol results. `call` is injectable for tests. */
export async function runPending(call, { maxCalls = MAX_CALLS } = {}) {
  const merged = new Map();
  let calls = 0;
  let last = null;
  let error = null;
  while (calls < maxCalls) {
    const { status, json } = await call({ pending: true, perSymbol: PER_SYMBOL });
    calls += 1;
    if (!json?.ok) {
      error = json?.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${status}: no response`;
      break;
    }
    last = json;
    for (const p of json.perSymbol) {
      const m = merged.get(p.symbol) ?? { symbol: p.symbol, checked: 0, byStatus: {}, problems: [], skipped: p.skipped ?? null };
      m.checked += p.checked ?? 0;
      for (const [k, v] of Object.entries(p.byStatus ?? {})) m.byStatus[k] = (m.byStatus[k] ?? 0) + v;
      m.problems.push(...(p.problems ?? []));
      m.checkedThrough = p.checkedThrough ?? m.checkedThrough ?? null;
      m.waitingForImportFrom = p.waitingForImportFrom ?? null;
      merged.set(p.symbol, m);
    }
    if (!json.more) break;
  }
  return { calls, error, more: Boolean(last?.more) && !error, perSymbol: [...merged.values()] };
}

const STATUSES = ['complete', 'incomplete', 'no_data', 'invalid', 'market_closed'];

export function formatQualityReport({ calls, error, more, perSymbol }) {
  const checked = perSymbol.reduce((n, p) => n + p.checked, 0);
  const lines = [
    '## Data quality',
    '',
    error ? `**Stopped with a problem:** ${error}` : `Checked ${checked} session(s) in ${calls} call(s)${more ? ' — more remain (next run continues)' : ''}.`,
    '',
    '| Symbol | Checked | Complete | Incomplete | No data | Invalid | Closed | Waiting for import from |',
    '|---|---|---|---|---|---|---|---|',
    ...perSymbol.map((p) => (p.skipped
      ? `| ${p.symbol} | skipped: ${p.skipped} |  |  |  |  |  |  |`
      : `| ${p.symbol} | ${p.checked} | ${STATUSES.map((s) => p.byStatus[s] ?? 0).join(' | ')} | ${p.waitingForImportFrom ?? '—'} |`)),
  ];
  const withProblems = perSymbol.filter((p) => p.problems.length);
  if (withProblems.length) {
    lines.push('', '**Sessions that are not complete** (New York time):', '');
    for (const p of withProblems) {
      lines.push(`* **${p.symbol}** (${p.problems.length}): ${p.problems.slice(0, MAX_PROBLEMS).join('; ')}${p.problems.length > MAX_PROBLEMS ? ` … +${p.problems.length - MAX_PROBLEMS}` : ''}`);
    }
  }
  return lines.join('\n');
}

export function formatRangeReport(json) {
  const lines = [
    `## Data quality — ${json.symbol} ${json.from} → ${json.to} (exclusive)`,
    '',
    `Checked ${json.checked}; not yet imported: ${json.notYetImported.length ? json.notYetImported.join(', ') : '—'}`,
    '',
    '| Date | Status | Candles | Missing | Invalid | Notes |',
    '|---|---|---|---|---|---|',
    ...json.sessions.map((s) => `| ${s.session_date} | ${s.status} | ${s.actual_candles}/${s.expected_candles} | ${s.missing_candles} | ${s.duplicate_candles + s.invalid_ohlc_candles + s.invalid_timestamp_candles} | ${[
      s.details.closedReason, s.details.missing ? `missing ${s.details.missing.slice(0, 6).join(', ')}${s.details.missing.length > 6 ? ' …' : ''}` : null,
    ].filter(Boolean).join('; ')} |`),
  ];
  return lines.join('\n');
}

async function main() {
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = process.env;
  if (!base || !key?.startsWith('sb_secret_')) {
    console.error('SUPABASE_URL and a Supabase secret key (SUPABASE_SECRET_KEY, starts with sb_secret_) are required.');
    process.exit(2);
  }
  const mode = process.env.QUALITY_MODE || 'pending';
  let report;
  let failed = false;
  if (mode === 'range') {
    const { status, json } = await callQuality(base, key, { symbol: process.env.QUALITY_SYMBOL, from: process.env.FROM, to: process.env.TO });
    if (!json?.ok) {
      report = `## Data quality\n\n**Stopped with a problem:** ${json?.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${status}`}`;
      failed = true;
    } else report = formatRangeReport(json);
  } else {
    const r = await runPending((body) => callQuality(base, key, body));
    report = formatQualityReport(r);
    failed = Boolean(r.error);
  }
  report = report.split(key).join('[REDACTED]');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
