/**
 * Answered coverage (TASK 009; PROVIDERS.md §6.1, §12).
 *
 * Progress is tracked by REQUESTED RANGES that were definitively answered —
 * the requested windows of `succeeded` import jobs — never by the last candle
 * received (a weekend or a quiet market has no candles but is answered).
 * These pure functions merge that coverage, find what is still missing, and
 * give the checkpoint: where a continuing import must resume.
 *
 * All times are ISO UTC strings; ranges are half-open [start, end).
 */

const toMs = (iso) => Date.parse(iso);
const toIso = (ms) => new Date(ms).toISOString();

/**
 * Merge overlapping or touching ranges into sorted, disjoint intervals.
 * @param {{ start: string, end: string }[]} ranges
 * @returns {{ start: string, end: string }[]}
 */
export function mergeCoverage(ranges) {
  const sorted = ranges
    .map((r) => [toMs(r.start), toMs(r.end)])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.map(([s, e]) => ({ start: toIso(s), end: toIso(e) }));
}

/**
 * Parts of [startUtc, endUtc) NOT covered by the merged coverage, oldest first.
 * @returns {{ start: string, end: string }[]}
 */
export function missingRanges(range, merged) {
  const gaps = [];
  let cursor = toMs(range.startUtc);
  const end = toMs(range.endUtc);
  for (const c of merged) {
    const cs = toMs(c.start);
    const ce = toMs(c.end);
    if (ce <= cursor) continue;
    if (cs >= end) break;
    if (cs > cursor) gaps.push({ start: toIso(cursor), end: toIso(Math.min(cs, end)) });
    cursor = Math.max(cursor, ce);
    if (cursor >= end) break;
  }
  if (cursor < end) gaps.push({ start: toIso(cursor), end: toIso(end) });
  return gaps;
}

/**
 * Checkpoint: end of the contiguous answered block that starts at the first
 * answered minute — everything before it is done; the next import resumes here.
 * @returns {{ historyStart: string, checkpoint: string } | null}  null when nothing is answered yet
 */
export function checkpointOf(merged) {
  if (!merged.length) return null;
  return { historyStart: merged[0].start, checkpoint: merged[0].end };
}

/** Total minutes in a list of ranges. */
export const minutesIn = (ranges) => ranges.reduce((n, r) => n + (toMs(r.end) - toMs(r.start)) / 60_000, 0);
