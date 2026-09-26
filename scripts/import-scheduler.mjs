#!/usr/bin/env node
/**
 * Import scheduler (TASK 012, D-027) — run hourly by .github/workflows/import-scheduler.yml.
 *
 * Repeats balanced GET DATA runs through the deployed importer for up to
 * RUN_MINUTES, obeying what the importer reports:
 *   - minute budget / job limit reached → wait until the next request is allowed;
 *   - provider rate limit               → wait until the provider's retry time;
 *   - daily budget / quota reached      → stop (the next hourly run after 00:00 UTC continues);
 *   - outage, network, database errors  → exponential backoff with jitter, stop after
 *                                         MAX_FAILURES in a row (PROVIDERS.md §9);
 *   - authentication / configuration    → stop and fail loudly (needs the owner);
 *   - everything answered               → stop.
 * The importer enforces the credit budget itself; this loop only paces and retries.
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, RUN_MINUTES (default 50).
 */
import { appendFile } from 'node:fs/promises';

export const MAX_JOBS_PER_CALL = 7;
export const MAX_FAILURES = 4;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 120_000;

const TRANSIENT = new Set(['PROVIDER_UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT', 'DATABASE_ERROR', 'INTERNAL_ERROR', 'FUNCTION_UNREACHABLE']);
const WAIT_FOR_BUDGET = new Set(['JOB_LIMIT_REACHED', 'MINUTE_BUDGET_REACHED']);
const DAY_DONE = new Set(['DAILY_BUDGET_REACHED', 'QUOTA_EXHAUSTED']);

/** Exponential backoff with full jitter: base·2^(n−1), capped. `rand` in [0,1). */
export function backoffMs(failures, rand = Math.random()) {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * rand);
}

const msUntil = (iso, nowMs, minMs = 1_000) => Math.max(minMs, (Date.parse(iso) || nowMs) - nowMs + 1_000);

/**
 * Decide what to do after one importer call. Pure.
 * @param {number} status          HTTP status (0 = no response)
 * @param {object|null} json       importer response
 * @param {{ failures: number, nowMs: number, rand?: number }} s
 * @returns {{ action: 'continue'|'wait'|'stop', ms?: number, reason: string, failed?: boolean, failures: number }}
 */
export function decide(status, json, { failures, nowMs, rand }) {
  const transient = (reason) => {
    const n = failures + 1;
    return n >= MAX_FAILURES
      ? { action: 'stop', reason: `${reason} (${n} times in a row)`, failed: true, failures: n }
      : { action: 'wait', ms: backoffMs(n, rand), reason, failures: n };
  };

  if (!json || typeof json.ok !== 'boolean') return transient('FUNCTION_UNREACHABLE');
  if (!json.ok) {
    const code = json.error?.code ?? `HTTP_${status}`;
    if (status === 429 || status >= 500) return transient(code);
    return { action: 'stop', reason: code, failed: true, failures }; // 401, 400, 409…: needs the owner
  }
  if (json.upToDate) return { action: 'stop', reason: 'UP_TO_DATE', failures: 0 };

  const code = json.stoppedReason;
  if (!code) {
    // Nothing more this run can do: remaining symbols are complete or set aside (reported).
    return { action: 'stop', reason: 'NOTHING_MORE_THIS_RUN', failures: 0 };
  }
  if (WAIT_FOR_BUDGET.has(code)) {
    const at = json.budget?.nextRequestAllowedAtUtc ?? json.retryAtUtc;
    return { action: 'wait', ms: msUntil(at, nowMs), reason: code, failures: 0 };
  }
  if (code === 'RATE_LIMITED') {
    const n = failures + 1;
    if (n >= MAX_FAILURES) return { action: 'stop', reason: 'RATE_LIMITED (repeatedly)', failed: true, failures: n };
    return { action: 'wait', ms: msUntil(json.retryAtUtc, nowMs, 5_000), reason: code, failures: n };
  }
  if (DAY_DONE.has(code)) return { action: 'stop', reason: `${code} — resumes after ${json.retryAtUtc ?? '00:00 UTC'}`, failures: 0 };
  if (TRANSIENT.has(code)) return transient(code);
  return { action: 'stop', reason: code, failed: true, failures }; // AUTH_FAILED and anything unexpected
}

/** Markdown report of the whole scheduled run. */
export function formatSchedulerReport({ startedAt, calls, stopReason, failed, last }) {
  const stored = calls.reduce((n, c) => n + (c.inserted ?? 0), 0);
  const jobs = calls.reduce((n, c) => n + (c.jobs ?? 0), 0);
  const lines = [
    `## Import scheduler — ${startedAt}`,
    '',
    `${failed ? '**Stopped with a problem:**' : 'Stopped:'} ${stopReason}`,
    `Calls: ${calls.length} · provider requests: ${jobs} · candles stored: ${stored}`,
  ];
  const b = last?.budget;
  if (b) lines.push(`Budget: ${b.usedToday} / ${b.dailyBudget} requests today (resets ${b.dayResetsAtUtc}), ${b.usedLastMinute} / ${b.minuteBudget} in the last minute`);
  if (last?.commonAnsweredThroughUtc) {
    lines.push(`Common frontier: \`${last.commonAnsweredThroughUtc}\` (history ${last.historyStartUtc} → ${last.settledUntilUtc})`);
  }
  lines.push('', '| # | HTTP | Jobs | Stored | Result | Next |', '|---|---|---|---|---|---|');
  calls.forEach((c, i) => lines.push(`| ${i + 1} | ${c.status} | ${c.jobs ?? 0} | ${c.inserted ?? 0} | ${c.result} | ${c.next} |`));
  if (last?.perSymbol?.length) {
    lines.push('', '| Symbol | Answered through (UTC) | Complete | Set aside |', '|---|---|---|---|',
      ...last.perSymbol.map((p) => `| ${p.symbol} | ${p.answeredThroughUtc ?? '—'} | ${p.complete ? 'yes' : 'no'} | ${p.setAside ?? ''} |`));
  }
  return lines.join('\n');
}

async function callImporter(base, key) {
  try {
    const res = await fetch(`${base}/functions/v1/importer`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ balanced: true, maxJobs: MAX_JOBS_PER_CALL }),
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

async function main() {
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = process.env;
  if (!base || !key?.startsWith('sb_secret_')) {
    console.error('SUPABASE_URL and a Supabase secret key (SUPABASE_SECRET_KEY, starts with sb_secret_) are required.');
    process.exit(2);
  }
  const runMs = Number(process.env.RUN_MINUTES ?? 50) * 60_000;
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + runMs;
  const calls = [];
  let failures = 0;
  let last = null;
  let stop = { reason: 'TIME_UP (the next scheduled run continues)', failed: false };

  while (Date.now() < deadline) {
    const { status, json } = await callImporter(base, key);
    if (json?.ok) last = json;
    const d = decide(status, json, { failures, nowMs: Date.now() });
    failures = d.failures;
    const inserted = json?.totals?.inserted ?? 0;
    const jobs = json?.jobs?.length ?? 0;
    const next = d.action === 'wait' ? `wait ${Math.round(d.ms / 1000)} s` : d.action;
    calls.push({ status, jobs, inserted, result: json?.ok ? (json.stoppedReason ?? (json.upToDate ? 'UP_TO_DATE' : 'done')) : (json?.error?.code ?? 'no response'), next });
    console.log(`call ${calls.length}: HTTP ${status}, ${jobs} job(s), ${inserted} stored → ${d.reason}; ${next}`);
    if (d.action === 'stop') {
      stop = { reason: d.reason, failed: Boolean(d.failed) };
      break;
    }
    if (d.action === 'wait') {
      if (Date.now() + d.ms >= deadline) break;
      await new Promise((r) => setTimeout(r, d.ms));
    }
  }

  const report = formatSchedulerReport({ startedAt, calls, stopReason: stop.reason, failed: stop.failed, last }).split(key).join('[REDACTED]');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  if (stop.failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
