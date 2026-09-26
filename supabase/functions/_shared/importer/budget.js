/**
 * Provider credit budget (TASK 012; PROVIDERS.md §7–§8; RULES.md — IMPORTER 3–4).
 *
 * Requests are paced by the importer itself instead of relying on the provider
 * to reject them. Before every provider request the budget is asked; it counts
 * the importer's own recorded requests (import_jobs.started_at) for the provider:
 *
 *   per minute  at most `perMinute` requests in any rolling 60 seconds
 *   per day     at most `perDay` requests per UTC day (the quota resets at
 *               00:00 UTC — a verified capability); a reserve below the plan
 *               quota is left for manual checks outside the importer
 *
 * A refusal says why and when requests may resume (`retryAtUtc`). Because the
 * count comes from the database, the limit holds across separate runs
 * (scheduled and manual) — runs are also serialized by the workflows.
 * A job is recorded for every request, so every request is counted.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export const BudgetStop = Object.freeze({
  MINUTE: 'MINUTE_BUDGET_REACHED',
  DAY: 'DAILY_BUDGET_REACHED',
});

/** Start of the UTC day containing `ms`. */
export const utcDayStart = (ms) => ms - (ms % DAY_MS);

/**
 * Budget limits from the provider's VERIFIED capabilities.
 * @param {{ rateLimit: { creditsPerMinute: number, creditsPerRequest: number }, quota: { creditsPerDay: number } }} caps
 * @param {number} reservePerDay  credits per day left for use outside the importer
 */
export function limitsFrom({ rateLimit, quota }, reservePerDay) {
  const perRequest = rateLimit.creditsPerRequest ?? 1;
  return {
    // One request of headroom per minute: other callers (live checks) share the same key.
    perMinute: Math.max(1, Math.floor(rateLimit.creditsPerMinute / perRequest) - 1),
    perDay: Math.max(0, Math.floor((quota.creditsPerDay - reservePerDay) / perRequest)),
  };
}

/**
 * @param {object} p
 * @param {string[]} p.startsToday   ISO start times of today's (UTC) requests, from the database
 * @param {{ perMinute: number, perDay: number }} p.limits
 * @param {() => number} p.now
 */
export function createBudget({ startsToday, limits, now }) {
  const starts = startsToday.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);

  function state() {
    const t = now();
    const dayStart = utcDayStart(t);
    const today = starts.filter((s) => s >= dayStart);
    const lastMinute = today.filter((s) => s > t - MINUTE_MS);
    return { t, dayStart, today, lastMinute };
  }

  return Object.freeze({
    limits,
    /**
     * Ask for one request. Records it when allowed.
     * @returns {Promise<null | { code: string, retryAtUtc: string }>}
     */
    async take() {
      const { t, dayStart, today, lastMinute } = state();
      if (today.length >= limits.perDay) {
        return { code: BudgetStop.DAY, retryAtUtc: new Date(dayStart + DAY_MS).toISOString() };
      }
      if (lastMinute.length >= limits.perMinute) {
        return { code: BudgetStop.MINUTE, retryAtUtc: new Date(lastMinute[0] + MINUTE_MS).toISOString() };
      }
      starts.push(t);
      return null;
    },
    /** Usage right now, for reports. */
    usage() {
      const { t, dayStart, today, lastMinute } = state();
      const nextMinute = lastMinute.length >= limits.perMinute ? new Date(lastMinute[0] + MINUTE_MS).toISOString() : new Date(t).toISOString();
      return {
        usedToday: today.length,
        dailyBudget: limits.perDay,
        usedLastMinute: lastMinute.length,
        minuteBudget: limits.perMinute,
        dayResetsAtUtc: new Date(dayStart + DAY_MS).toISOString(),
        nextRequestAllowedAtUtc: today.length >= limits.perDay ? new Date(dayStart + DAY_MS).toISOString() : nextMinute,
      };
    },
  });
}
