# MARKET DATA PROVIDERS

> **STATUS: APPROVED — revision 2 (approved by the project owner, 2026-09-25)**
>
> The original PROVIDERS.md is unavailable. This document is derived only from the original
> project files: PROJECT.md, INSTRUCTIONS.md, CLAUDE.md, RULES.md, ARCHITECTURE.md,
> DATABASE.md, TASKS.md and ROADMAP.md. Sources are cited in *(italics)*.
>
> * **TO BE VERIFIED**: not established by the project files. It must be confirmed from the
>   provider's official documentation and the owner's account before any code depends on it.
> * **(proposed)**: an engineering proposal that is not in the original specification. It
>   needs separate approval.
>
> DATABASE.md remains authoritative for storage. This document adds no database fields or
> constraints.

---

## 1. PROVIDER ABSTRACTION

Provider support must use an abstraction layer. *(PROJECT.md §6)*

```text
MarketDataProvider
│
├── TwelveDataProvider
├── FinnhubProvider
├── AlphaVantageProvider
└── FMPProvider
```

*(ARCHITECTURE.md §4)*

* Provider calls are made server-side through Supabase Edge Functions. The frontend never calls
  a provider. *(ARCHITECTURE.md §2, §3, §5; PROJECT.md §5)*
* Everything outside an adapter works only through the `MarketDataProvider` abstraction.
  Provider-specific details — URLs, parameters, response formats, error formats — stay inside
  that provider's adapter.
* The provider layer retrieves and normalizes. Validation, deduplication and storage follow in
  the data flow. *(ARCHITECTURE.md §5: Provider → Normalize candles → Validate → Deduplicate → PostgreSQL)*

### 1.1 Responsibilities of every adapter

The exact function signatures are an implementation choice for TASK 005. Every adapter must be
able to:

1. **Identify itself** with a stable provider identifier, which is recorded as the provider on
   candles and import jobs. *(DATABASE.md — candles.provider, import_jobs.provider)*
2. **Report its capabilities** (§11).
3. **Resolve the provider symbol** for a configured symbol (§5).
4. **Retrieve historical 1-minute candles** for one symbol over one explicit UTC time range.
5. **Report what it actually returned** for that range:
   * the number of rows received;
   * the time span covered;
   * any rows it could not normalize, with the reason;
   * whether the provider indicated there is **more data in the same range** (truncation), when
     the provider exposes that (§6).
6. **Classify failures** into project error categories (§10).

---

## 2. NORMALIZED 1-MINUTE CANDLES

Historical 1-minute candles are the source of truth. *(RULES.md — DATA 1; PROJECT.md §3)*

* Only 1-minute candles are retrieved. The 3, 5, 10 and 15-minute ORB periods are derived later
  from stored 1-minute candles and are never requested from a provider. *(PROJECT.md §3)*
* Adapters normalize every provider response into the candle fields defined in DATABASE.md
  (`timestamp_utc`, `open`, `high`, `low`, `close`, `volume`, `provider`, `interval`).
  *(DATABASE.md — candles)*
* **Timestamps:** the provider layer is responsible for converting every timestamp to **UTC**.
  Converting to or displaying America/New_York time is done by the application, not the
  provider layer. Timezone handling uses named timezones, never fixed UTC offsets.
  *(RULES.md — TIMEZONE; PROJECT.md §4)*
* **TO BE VERIFIED per provider:**
  * the timezone the provider's timestamps are expressed in;
  * whether a timestamp marks the start or the end of the 1-minute bar.
* **Prices** are carried without loss of precision.
* **Missing values** are never invented. If a provider supplies no volume, it is recorded as
  absent, not as zero. *(RULES.md — DATA 2; CLAUDE.md — MARKET DATA)*
* **Unparseable rows** are not dropped silently. They are reported with a reason.
  *(RULES.md — DATA 5)*
* Never fabricate, interpolate, estimate, artificially shift or silently delete market data.
  *(CLAUDE.md — MARKET DATA; RULES.md — DATA 2–5)*

---

## 3. TWELVE DATA — PRIMARY PROVIDER

Twelve Data is the initial provider. *(PROJECT.md §6; ARCHITECTURE.md §4)*

Verification of this table: TASK 006, 2026-09-25 (D-019). Sources:
[DOCS] twelvedata.com/docs · [PRICING] twelvedata.com/pricing ·
[CREDITS] support.twelvedata.com "Credits" · [HISTORY] support.twelvedata.com "Historical data" ·
[LIVE] provider live check with the owner's key, 2026-09-25 (D-021).
Plan values are for the owner's plan, **Basic**, confirmed by the owner.

| Item | Status |
|------|--------|
| Provider identifier | `twelve_data` **(proposed)** — used by the seeded symbols |
| Secret name for the API key | `TWELVE_DATA_API_KEY` **(proposed)** |
| Symbol formats | Verified [DOCS]: stocks as the ticker (`AAPL`); forex, crypto and commodities with a slash (`EUR/USD`, `BTC/USD`, `XAU/USD`) |
| 1-minute data availability | Verified [DOCS]: `interval=1min`. Basic covers US equities/ETFs, forex and crypto [PRICING]. [LIVE]: XAU/USD also returned 1-minute data on Basic |
| Historical depth of 1-minute data | **TO BE VERIFIED** per symbol. [HISTORY] says only "a couple of months to a year" (US intraday) and "a year" (forex/crypto intraday). The `earliest_timestamp` endpoint reports it per symbol (1 credit) [DOCS] |
| Maximum candles per request (page size) | Verified [DOCS]: `outputsize` 1–5000 |
| Pagination / range requests; result order | Verified [DOCS]: `start_date` / `end_date` bound the range; `order=asc` or `desc` (default desc). [LIVE]: `end_date` is **inclusive** — the adapter sends the range's last bar. **TO BE VERIFIED:** which end of a range a truncated response keeps (the adapter never relies on it) |
| Rate limits | Verified [PRICING, CREDITS]: Basic 8 API credits per minute; credits reset every clock minute |
| Daily quota and how usage is counted | Verified [PRICING, CREDITS, DOCS]: Basic 800 credits/day; `time_series` costs 1 credit per symbol; responses carry `api-credits-used` / `api-credits-left` headers |
| Quota reset time | Verified [CREDITS]: 00:00:00 UTC (Basic) |
| How the API key is sent | Verified [DOCS]: header `Authorization: apikey <key>` (recommended) or `apikey` query parameter. The adapter uses the header only |
| Timestamp timezone and bar convention | Verified [DOCS]: `timezone=UTC` returns UTC datetimes and applies to `start_date` / `end_date`; datetime is when the bar opened (bar start). [LIVE]: SPY 09:30 ET bar labelled 13:30Z (EDT); 90 of 90 opening-window candles |
| Volume availability | Verified [LIVE]: US stocks have volume; forex (EUR/USD), crypto (BTC/USD) and gold (XAU/USD) have none. Absent volume is stored as null, never 0 |
| Truncation / "more data" signal | Verified [DOCS]: none — the response has only `meta`, `values` and `status` |
| Error and rate-limit formats | Verified [DOCS]: JSON `{code, message, status: "error"}`; codes 400, 401, 403, 404, 414, 429, 500. [LIVE]: a range with no bars answers code 400 "No data is available on the specified dates…". **TO BE VERIFIED:** wording of the daily-limit 429 (falls back safely) |
| Price adjustment | Verified [DOCS]: `adjust` defaults to `splits`. The adapter sends `adjust=none` (owner decision, D-018) |
| Licensing | Basic is "internal non-display usage" [PRICING]; Grow adds "internal display". **Owner to confirm** that showing results in this private app fits the plan's terms |

---

## 4. FUTURE PROVIDER ADAPTERS

Finnhub, Alpha Vantage and Financial Modeling Prep may be added later. *(PROJECT.md §6)*

* All of their capabilities, limits, formats and terms are **TO BE VERIFIED** when an adapter is
  proposed.
* A new adapter must satisfy this document and pass the provider contract tests (§15) before any
  of its data is imported.
* Adding an adapter never changes the provider of an existing symbol (§14).

---

## 5. PROVIDER SYMBOL MAPPING

* Symbols are configurable and must not be hard-coded. *(PROJECT.md §2)*
* Each configured symbol has a `provider` and a `provider_symbol`. *(DATABASE.md — symbols)*
* The adapter requests exactly the configured `provider_symbol`. It never guesses or rewrites the
  symbol, and never substitutes a different instrument.
* If the provider does not recognise the symbol, that is reported as an error (§10). There is no
  fallback to a similar instrument.

---

## 6. PAGINATION AND RANGE COMPLETENESS

The importer must paginate and must never skip data. *(PROJECT.md §7; CLAUDE.md — IMPORTER)*

There are two different situations, and they must not be confused:

* **A. Truncated response (pagination).** The provider returned only part of the candles that
  exist in the requested range, because of its page size or similar limit. More data exists in
  that range and must be requested.
* **B. Genuinely incomplete history.** The provider returned everything it has for the range, but
  some minutes are absent. The cause may be a closed market, no trading, a gap in the provider's
  data, or the limit of available history. There is nothing more to request.

Rules:

1. **Progress is tracked by requested ranges, not by the last candle received.** A range counts as
   done only when the provider has definitively answered it. The next range starts at the end of
   the previous *requested* range, not after the last candle that happened to be returned.
2. **Truncation must be ruled out, not assumed away.** A range is treated as fully answered only
   when one of these holds:
   * the provider explicitly indicates that nothing more exists in the range; or
   * A requested range must be sized conservatively enough that, based on the provider's
     verified page-size and timestamp semantics, the provider cannot truncate the response
     without the adapter detecting it. **(proposed)**

   The page limit and any truncation signal are **TO BE VERIFIED** (§3). Until they are verified,
   ranges must be sized conservatively.
3. **If truncation is detected or cannot be ruled out,** the remaining part of the same range is
   requested again. Which part remains depends on the order the provider returns results in
   (**TO BE VERIFIED**), so the adapter must know that order. Otherwise the range is split into
   smaller ranges. It is never marked as done.
4. **A range that failed** — an error, timeout or rate limit — is never marked as done. It is
   retried later. Checkpoints never move past it.
5. **Overlapping requests are safe.** A candle received twice is detected as a duplicate and
   counted, never stored twice. *(RULES.md — DATA 7; DATABASE.md — candles unique key,
   import_jobs.duplicate_count)*

---

## 7. RATE LIMITS

The importer must respect provider rate limits. *(PROJECT.md §7; RULES.md — IMPORTER 3)*

* Limit values are **TO BE VERIFIED** for the owner's plan. They are configuration, not hard-coded
  values.
* Requests are paced to stay within the configured limit, rather than relying on the provider to
  reject excess requests.
* When the provider signals a rate limit, the affected work is recorded as rate-limited and a
  retry time is set (`import_jobs.next_retry_at`). *(DATABASE.md — import_jobs)* Any wait time the
  provider signals is honoured.

---

## 8. QUOTAS

The importer must respect provider quotas and must not bypass them. *(PROJECT.md §7; RULES.md — IMPORTER 3–4)*

* Quota values, how usage is counted, and the reset time are **TO BE VERIFIED**. They are
  configuration.
* When the quota is exhausted, requests to that provider stop, the condition is recorded, and work
  continues after the reset.
* Quota usage must support balanced progress across enabled symbols. *(PROJECT.md §8; RULES.md — IMPORTER 8)*

### 8.1 Multiple API keys

Multiple API keys may only be used where explicitly permitted by the provider's terms and the
owner's account configuration. They must never be used to bypass quotas or rate limits.

---

## 9. RETRY AND BACKOFF

Retry is required. *(CLAUDE.md — IMPORTER)* Errors must be recoverable where possible. *(INSTRUCTIONS.md §7)*

* Transient failures, such as network errors, timeouts, provider outages and rate limits, are
  retried with backoff.
* Failures that need human action, such as authentication errors, plan restrictions or unknown
  symbols, are not retried automatically. They are shown to the owner.
* A retry never changes the symbol, range, interval or provider.
* Every failed attempt is recorded.
* **(proposed)** Exponential backoff with jitter. Attempt limits and delays are configuration. An
  example setting is 3 attempts, starting at about 2 seconds and capped at about 60 seconds.
  These values are illustrative, not requirements.

---

## 10. ERROR CLASSIFICATION

Errors must be logged, classified, understandable and recoverable where possible. They must never
be silently swallowed. *(INSTRUCTIONS.md §7; RULES.md — FAIL LOUDLY)*

Errors are recorded with the import job (`error_code`, `error_message`). *(DATABASE.md — import_jobs)*

**(proposed)** categories:

| Code | Meaning |
|------|---------|
| `AUTH_FAILED` | Key missing, invalid or revoked |
| `PLAN_RESTRICTED` | Account plan does not cover the symbol, interval or history requested |
| `SYMBOL_NOT_FOUND` | Provider does not recognise the provider symbol |
| `INTERVAL_UNSUPPORTED` | 1-minute data not available for the symbol |
| `NO_DATA_RETURNED` | Provider answered the range successfully but returned no candles (see §12) |
| `RATE_LIMITED` | Rate limit reached |
| `QUOTA_EXHAUSTED` | Quota reached |
| `PROVIDER_UNAVAILABLE` | Provider outage or server error |
| `NETWORK_ERROR` | Connection failure |
| `TIMEOUT` | No response in time |
| `MALFORMED_RESPONSE` | Response could not be parsed or understood |
| `UNKNOWN` | Anything else, with full detail in the message |

How each provider's errors map onto these categories is **TO BE VERIFIED** per adapter. Error
messages never contain API keys (§13).

---

## 11. CAPABILITY VALIDATION

* Each adapter declares its capabilities as configuration:
  * supported markets;
  * whether 1-minute data is available;
  * history depth;
  * page size;
  * rate limit;
  * quota;
  * whether volume is available.

  Every value is **TO BE VERIFIED** before it is relied on.
* Before importing a symbol, the importer confirms that the provider can supply 1-minute data for
  it. A capability gap is reported, not worked around. When the alternatives would materially
  change the system, the owner decides. *(CLAUDE.md — DO NOT ASK UNNECESSARY QUESTIONS)*
* Validation never changes the symbol, interval or provider to make a request succeed.

---

## 12. CHECKPOINT, RESUME AND INCOMPLETE RESPONSES

The importer must checkpoint, resume after interruption, and continue building the dataset over
later runs when a provider cannot supply a complete range. It must never fabricate missing candles.
*(PROJECT.md §7; RULES.md — IMPORTER 1–2)*

* Progress is recorded per symbol, provider and interval. *(DATABASE.md — import_progress)* Each
  request is recorded as an import job with its requested range, counts, status and error.
  *(DATABASE.md — import_jobs)*
* A checkpoint advances only after:
  * the candles for a range have been stored; and
  * the range has been definitively answered (§6).

  An interruption can therefore cause a range to be requested again, which is harmless, but can
  never cause a range to be skipped.
* Resuming continues from the recorded progress. It never deletes or re-imports existing candles.
  *(RULES.md — DEPLOYMENT)*
* **Incomplete or empty responses:**
  * The provider layer stores exactly what was legitimately returned and records the facts: the
    requested range, the rows received, the span covered, and the provider's response or
    indication.
  * The provider layer and importer **do not decide** why data is absent — holiday, market
    closure, unavailable history or provider failure — unless the provider states it explicitly.
  * Interpreting gaps is the job of the session validation and data-quality layers.
    *(TASKS.md — TASK 013, TASK 014)* Weekends and holidays are not missing data.
    *(RULES.md — DATA QUALITY)*
* Individual invalid rows are reported and counted. One bad row does not cause the rest of a valid
  response to be discarded.

---

## 13. API-KEY SECURITY

* Provider API keys are stored only in Supabase Edge Function secrets. *(PROJECT.md §14; CLAUDE.md — SECURITY)*
* They must never appear in:
  * source code, GitHub or committed configuration;
  * the frontend, HTML, JavaScript or CSS;
  * browser storage or localStorage;
  * the README. *(CLAUDE.md — SECURITY; RULES.md — SECURITY)*
* Never expose the Supabase service-role key to the browser. *(PROJECT.md §14)*
* The provider layer never writes an API key to logs, error messages, the database, or any
  recorded request URL. If a provider requires the key in the URL (**TO BE VERIFIED**), recorded
  URLs are redacted.
* Keys that need to be entered manually are added by the owner, never by putting them in source
  code. *(INSTRUCTIONS.md §5)*

---

## 14. PROVIDER TRACEABILITY AND NO SILENT SWITCHING

Every candle must be traceable to a provider, and the provider must be recorded. *(RULES.md — DATA 6, IMPORTER 6, PROVIDERS; PROJECT.md §1)*
Never silently change provider. *(RULES.md — PROVIDERS; PROJECT.md §15)*

* Every candle and every import job records its provider. *(DATABASE.md — candles.provider, import_jobs.provider)*
* A symbol is imported only from its configured provider. *(DATABASE.md — symbols.provider)*
* Changing a symbol's provider requires an explicit, documented owner decision. It is never
  automatic, never a fallback, and never part of retry.
* Progress is tracked per provider *(DATABASE.md — import_progress.provider)*, so data from a new
  provider is never presented as a continuation of another provider's history.
* If a symbol's data comes from more than one provider, that must be visible wherever the data or
  results derived from it are shown. *(PROJECT.md §15 — reproducibility)*

---

## 15. PROVIDER CONTRACT TESTS

Every meaningful implementation must include testing. *(INSTRUCTIONS.md §6; CLAUDE.md — TESTING)*

Every adapter passes one shared contract test suite **(proposed)**. The tests use recorded or
synthetic provider responses. Automated tests never call a live provider and never need a real key.

The suite covers:

* **Normalization:**
  * every candle field;
  * no loss of price precision;
  * missing volume recorded as absent, not zero.
* **Timestamps:**
  * conversion to UTC, including US daylight-saving transitions;
  * bar start/end handling;
  * whole-minute alignment.
* **Pagination vs incomplete history (§6):**
  * a truncated response is detected and continued, and no range is skipped;
  * a genuinely incomplete range is recorded as answered, with nothing fabricated;
  * a range that failed is never marked done;
  * overlapping responses produce duplicates that are counted, not stored twice.
* **Empty responses:** recorded as facts, not interpreted as holidays or closures.
* **Invalid rows:** reported with a reason; the valid rows are kept.
* **Error classification:** provider error examples map to the right category.
* **Retry/backoff:**
  * transient vs human-action errors are handled correctly;
  * provider-signalled waits are honoured;
  * tested with a simulated clock.
* **Rate limit and quota:** requests are paced; quota exhaustion stops requests and schedules
  continuation.
* **Checkpoint:** advances only after storage and a definitive answer; an interrupted run resumes
  without skipping.
* **Security:** the API key never appears in logs, errors, recorded URLs or results.
* **Symbol mapping:** exactly the configured provider symbol is requested.
* **No switching:** no code path uses a provider other than the symbol's configured one.

A manual check against the live provider, using the owner's key from Edge Function secrets, may
be run separately. It is not part of automated testing.

---

## OPEN ITEMS

| # | Item |
|---|------|
| P-1 | Done in TASK 006 except the items still marked **TO BE VERIFIED** in §3 |
| P-2 | Done: page limit, truncation signal and `end_date` inclusivity verified (§3). Which end a truncated response keeps stays unknown; the adapter never relies on it (D-019) |
| P-3 | Owner to confirm licensing for storing and displaying the data (Basic: "internal non-display") |
| P-5 | Done in TASK 007 (D-021), except the daily-limit 429 wording, which can only be observed when the limit is reached |
| P-4 | Approve or amend the **(proposed)** items: identifier and secret name (§3), range sizing rule (§6.2), backoff (§9), error categories (§10), contract test suite (§15) |
