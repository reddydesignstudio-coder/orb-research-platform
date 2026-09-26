#!/usr/bin/env node
/**
 * Import run (TASK 008, 009): calls the deployed importer function once and writes
 * a report (stdout and the GitHub run summary). Inputs come from environment
 * variables so workflow inputs are never interpolated into shell code.
 *
 *   SUPABASE_URL, SUPABASE_SECRET_KEY, IMPORT_SYMBOL, IMPORT_MODE (balanced | range | continue),
 *   IMPORT_START, IMPORT_END (range mode only), IMPORT_MAX_JOBS
 */
import { appendFile } from 'node:fs/promises';

/** Markdown report of an importer response. Never includes request headers. */
/** Report for a balanced (GET DATA) run: per-symbol progress and the common frontier. */
export function formatBalancedReport(status, json) {
  const lines = ['## Import run — balanced, all enabled symbols (GET DATA)', '', `HTTP ${status}`, ''];
  if (!json?.ok) {
    const e = json?.error ?? {};
    lines.push(`**Refused / failed** \`${e.code ?? 'unknown'}\`: ${e.message ?? '(no message)'}`);
    return lines.join('\n');
  }
  const excluded = json.commonScope?.excluded ?? [];
  lines.push(
    json.upToDate
      ? `Up to date: every enabled symbol is answered from ${json.historyStartUtc} to ${json.settledUntilUtc}.`
      : `Run id: \`${json.runId}\` · jobs: ${json.jobs.length} · received ${json.totals.received}, stored ${json.totals.inserted}, duplicates ${json.totals.duplicates}`,
    `History: ${json.historyStartUtc} → ${json.settledUntilUtc}`,
    `**Common frontier** (all ${json.commonScope?.symbols ?? '?'} importable symbols answered through): \`${json.commonAnsweredThroughUtc}\`` +
      (excluded.length ? ` — not importable: ${excluded.join(', ')}` : ''),
    json.stoppedReason ? `Stopped: **${json.stoppedReason}**` : '',
    json.interruptedJobsClosed ? `Interrupted jobs closed: ${json.interruptedJobsClosed}` : '',
    json.progressError ? `Progress refresh failed: ${json.progressError}` : '',
    '',
    '| Symbol | Answered through (UTC) | Complete | Jobs | Stored | Set aside |',
    '|---|---|---|---|---|---|',
    ...json.perSymbol.map((p) =>
      `| ${p.symbol} | ${p.answeredThroughUtc ?? '—'} | ${p.complete ? 'yes' : 'no'} | ${p.jobs ?? 0} | ${p.inserted ?? 0} | ${p.setAside ?? ''} |`),
  );
  if (json.jobs.length) {
    lines.push('', '| Job | Symbol | Window (UTC) | Status | Received | Stored | Duplicates | Code | Note |', '|---|---|---|---|---|---|---|---|---|',
      ...json.jobs.map((j) =>
        `| ${j.jobId} | ${j.symbol} | ${j.startUtc} → ${j.endUtc} | ${j.status} | ${j.received_count ?? 0} | ${j.inserted_count ?? 0} | ${j.duplicate_count ?? 0} | ${j.error_code ?? ''} | ${(j.error_message ?? '').replace(/\|/g, '/')} |`));
  }
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}

export function formatReport(status, json, request) {
  if (request.balanced) return formatBalancedReport(status, json);
  const what = request.continue ? 'continue from checkpoint' : `${request.startUtc} → ${request.endUtc}`;
  const lines = [`## Import run — ${request.symbol} (${what})`, '', `HTTP ${status}`, ''];
  if (!json?.ok) {
    const e = json?.error ?? {};
    lines.push(`**Refused / failed** \`${e.code ?? 'unknown'}\`: ${e.message ?? '(no message)'}`);
    return lines.join('\n');
  }
  if (json.upToDate) {
    lines.push(`Up to date: answered through \`${json.checkpointUtc}\` (settled until \`${json.settledUntilUtc}\`). Nothing requested.`);
    return lines.join('\n');
  }
  const p = json.progress;
  lines.push(
    `Run id: \`${json.runId}\` · provider: ${json.provider} · windows planned: ${json.windows}` +
      (json.alreadyAnsweredMinutes ? ` · already answered (skipped): ${json.alreadyAnsweredMinutes} min` : ''),
    `Totals: received ${json.totals.received}, inserted ${json.totals.inserted}, duplicates ${json.totals.duplicates}`,
    json.stoppedReason ? `Stopped: **${json.stoppedReason}** — resume from \`${json.nextStartUtc}\`` : 'Completed the requested range.',
    `Checkpoint (answered through): \`${json.checkpointUtc ?? '—'}\` · history starts \`${json.historyStartUtc ?? '—'}\``,
    json.interruptedJobsClosed ? `Interrupted jobs closed: ${json.interruptedJobsClosed}` : '',
    p ? `Stored history: ${p.candle_count} candles, ${p.first_timestamp_utc} → ${p.last_timestamp_utc} · common dataset: ${p.common_dataset_timestamp ?? 'not yet (some enabled symbols have no data)'}` : '',
    json.progressError ? `Progress refresh failed: ${json.progressError}` : '',
    '',
    '| Job | Window (UTC) | Status | Received | Inserted | Duplicates | Code | Note |',
    '|---|---|---|---|---|---|---|---|',
    ...json.jobs.map((j) =>
      `| ${j.jobId} | ${j.startUtc} → ${j.endUtc} | ${j.status} | ${j.received_count ?? 0} | ${j.inserted_count ?? 0} | ${j.duplicate_count ?? 0} | ${j.error_code ?? ''} | ${(j.error_message ?? '').replace(/\|/g, '/')} |`),
  );
  return lines.filter((l, i) => l !== '' || i < 4 || lines[i - 1] !== '').join('\n');
}

async function main() {
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = process.env;
  const mode = process.env.IMPORT_MODE ?? 'range';
  const maxJobs = Number(process.env.IMPORT_MAX_JOBS ?? 4);
  const request =
    mode === 'balanced'
      ? { balanced: true, maxJobs }
      : {
          symbol: process.env.IMPORT_SYMBOL,
          ...(mode === 'continue' ? { continue: true } : { startUtc: process.env.IMPORT_START, endUtc: process.env.IMPORT_END }),
          maxJobs,
        };
  if (!base || !key?.startsWith('sb_secret_')) {
    console.error('SUPABASE_URL and a Supabase secret key (SUPABASE_SECRET_KEY, starts with sb_secret_) are required.');
    process.exit(2);
  }
  let status = 0;
  let json;
  try {
    const res = await fetch(`${base}/functions/v1/importer`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(request),
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
  const report = formatReport(status, json, request).split(key).join('[REDACTED]');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  if (!json?.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
