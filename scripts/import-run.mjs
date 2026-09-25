#!/usr/bin/env node
/**
 * Import run (TASK 008): calls the deployed importer function once and writes a
 * report (stdout and the GitHub run summary). Inputs come from environment
 * variables so workflow inputs are never interpolated into shell code.
 *
 *   SUPABASE_URL, SUPABASE_SECRET_KEY, IMPORT_SYMBOL, IMPORT_START, IMPORT_END, IMPORT_MAX_JOBS
 */
import { appendFile } from 'node:fs/promises';

/** Markdown report of an importer response. Never includes request headers. */
export function formatReport(status, json, request) {
  const lines = [`## Import run — ${request.symbol} ${request.startUtc} → ${request.endUtc}`, '', `HTTP ${status}`, ''];
  if (!json?.ok) {
    const e = json?.error ?? {};
    lines.push(`**Refused / failed** \`${e.code ?? 'unknown'}\`: ${e.message ?? '(no message)'}`);
    return lines.join('\n');
  }
  lines.push(
    `Run id: \`${json.runId}\` · provider: ${json.provider} · windows planned: ${json.windows}`,
    `Totals: received ${json.totals.received}, inserted ${json.totals.inserted}, duplicates ${json.totals.duplicates}`,
    json.stoppedReason ? `Stopped: **${json.stoppedReason}** — resume from \`${json.nextStartUtc}\`` : 'Completed the whole range.',
    '',
    '| Job | Window (UTC) | Status | Received | Inserted | Duplicates | Code | Note |',
    '|---|---|---|---|---|---|---|---|',
    ...json.jobs.map((j) =>
      `| ${j.jobId} | ${j.startUtc} → ${j.endUtc} | ${j.status} | ${j.received_count ?? 0} | ${j.inserted_count ?? 0} | ${j.duplicate_count ?? 0} | ${j.error_code ?? ''} | ${(j.error_message ?? '').replace(/\|/g, '/')} |`),
  );
  return lines.join('\n');
}

async function main() {
  const { SUPABASE_URL: base, SUPABASE_SECRET_KEY: key } = process.env;
  const request = {
    symbol: process.env.IMPORT_SYMBOL,
    startUtc: process.env.IMPORT_START,
    endUtc: process.env.IMPORT_END,
    maxJobs: Number(process.env.IMPORT_MAX_JOBS ?? 4),
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
