/**
 * Twelve Data capabilities (PROVIDERS.md §3, §11) — TASK 006.
 *
 * Every value marked verified() cites where it was confirmed. Anything the
 * official documentation does not state is left unverified(), so shared code
 * (requireVerified) refuses to rely on it. See PROVIDERS.md §3 for the table.
 *
 * Checked on 2026-09-25 against:
 *   DOCS     https://twelvedata.com/docs  (time_series, authentication, errors)
 *   PRICING  https://twelvedata.com/pricing
 *   CREDITS  https://support.twelvedata.com/en/articles/5615854-credits
 *   HISTORY  https://support.twelvedata.com/en/articles/5194454-historical-data
 */

import { defineCapabilities, unverified, verified } from '../../providers/mod.js';

export const TWELVE_DATA_ID = 'twelve_data';

const CHECKED = '2026-09-25';
const DOCS = `twelvedata.com/docs, checked ${CHECKED}`;
const PRICING = `twelvedata.com/pricing, checked ${CHECKED}`;
const CREDITS = `support.twelvedata.com "Credits", checked ${CHECKED}`;

/** Maximum rows in one time_series response: "outputsize … from 1 to 5000" (DOCS). */
export const PAGE_SIZE = 5000;

/**
 * Largest range (minutes) that cannot be truncated without detection (§6 rule 2).
 * A half-open range of N minutes holds at most N one-minute bars. The adapter
 * sends end_date = the exclusive range end, and whether Twelve Data treats
 * end_date as inclusive is not documented, so the response may contain one
 * extra boundary bar: N + 1 ≤ PAGE_SIZE  →  N ≤ PAGE_SIZE − 1.
 */
export const MAX_SAFE_RANGE_MINUTES = PAGE_SIZE - 1;

/**
 * Plan-dependent limits. Only the plan the owner has confirmed is verified;
 * others stay unverified until the owner moves to them and they are checked.
 * Owner's plan: Basic (confirmed by the owner, 2026-09-25).
 */
const PLANS = Object.freeze({
  basic: {
    markets: verified(['us_stock', 'forex', 'crypto'], `${PRICING} (Basic: US equities/ETFs, forex, crypto)`,
      'Commodities (gold, XAU/USD) are listed from the Grow plan upwards; not verified for Basic.'),
    rateLimit: verified({ creditsPerMinute: 8, creditsPerRequest: 1, minuteResets: 'every clock minute' },
      `${PRICING}; ${CREDITS}; time_series "API credits cost 1 per symbol" (${DOCS})`),
    quota: verified({ creditsPerDay: 800, resetsAtUtc: '00:00:00' }, `${PRICING}; ${CREDITS}`),
  },
});

export const SUPPORTED_PLANS = Object.freeze(Object.keys(PLANS));

/** @param {string} plan  owner's Twelve Data plan (configuration, not a constant) */
export function twelveDataCapabilities(plan) {
  const limits = PLANS[plan] ?? {
    markets: unverified(`Plan "${plan}" not verified — TO BE VERIFIED`),
    rateLimit: unverified(`Plan "${plan}" not verified — TO BE VERIFIED`),
    quota: unverified(`Plan "${plan}" not verified — TO BE VERIFIED`),
  };
  return defineCapabilities({
    providerId: TWELVE_DATA_ID,
    facts: {
      ...limits,
      oneMinuteData: verified(true, `${DOCS} (time_series interval "1min")`),
      historyDepth: unverified(
        'Not stated precisely: intraday US equities "a couple of months to a year", forex/crypto "a year" (HISTORY). ' +
          'Varies per symbol; the earliest_timestamp endpoint reports it.',
      ),
      pageSize: verified(PAGE_SIZE, `${DOCS} (outputsize 1–5000)`),
      resultOrder: unverified(
        'Rows are requested with order=asc (DOCS), but which end of a range a truncated response keeps is not documented. ' +
          'Truncation is avoided by range sizing instead.',
      ),
      truncationSignal: verified('none', `${DOCS} (response has only meta, values, status — no "more data" indicator)`),
      timestampSemantics: verified(
        { zone: 'UTC (the adapter always sends timezone=UTC)', label: 'bar start' },
        `${DOCS} (timezone=UTC returns UTC datetimes and applies to start_date/end_date; datetime is "when the bar … was opened")`,
      ),
      maxSafeRangeMinutes: verified(MAX_SAFE_RANGE_MINUTES, `derived from pageSize (${DOCS}); see MAX_SAFE_RANGE_MINUTES`),
      volume: unverified('Docs: volume is "available not for all instrument types". Recorded as absent when not sent.'),
    },
  });
}
