# TASK QUEUE

## PHASE 0 — FOUNDATION

### TASK 001 — Repository Foundation

Create repository structure and project documentation.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: specification at root, folder skeleton, `.gitignore`, `README.md`,
`CHANGELOG.md`, `docs/SPEC_REVIEW.md`, `docs/DECISIONS.md`,
`scripts/verify-foundation.sh`.

Verified: `sh scripts/verify-foundation.sh` → PASS; negative tests confirmed it fails on a
planted API key, a planted JWT, a committed `.env`, a missing spec file, a missing folder,
an incomplete task list and a duplicated `PROVIDERS.md`.

Carry-forward: `PROVIDERS.md` is provisional (SR-01) and must be replaced before TASK 005.
Open questions for later tasks are listed in `docs/SPEC_REVIEW.md`.

---

### TASK 002 — Development Environment

Create required package configuration, frontend structure and development scripts.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: `package.json` (scripts only, no dependencies), frontend shell with the seven
sections, hash router, public-config guard, CSP, `scripts/serve.mjs`, 27 unit tests,
`supabase/functions/.env.example`. Decisions D-003–D-006.

Verified: `npm run check` → PASS (27/27 tests). Headless Chromium with device emulation at
iPhone (390px), iPad (820px) and desktop (1280px): no horizontal overflow, active tab visible,
touch targets ≥ 44px on touch devices, no console errors. A service-role key in the config
produced the error banner.

Carry-forward: `supabase/config.toml` moves to TASK 003 (D-006). New open items SR-16–SR-18.

---

## PHASE 1 — DATABASE

### TASK 003 — Supabase Schema

Create:

* symbols
* candles
* import_jobs
* import_progress
* data_quality
* orb_events
* backtest_runs
* trades
* orb_relationships

Add constraints and indexes.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: `supabase/migrations/20260925120000_initial_schema.sql` (9 tables, constraints,
indexes, triggers, RLS), `supabase/config.toml`, 75 database checks (`npm run test:db`),
migration guard test, CI database job, automatic deploy workflow. Decisions D-009 – D-013.

Verified: all database checks pass on PostgreSQL 16 locally; `supabase db push` (CLI
2.117.0) tested against a stand-in database — dry run, apply, and idempotent re-run.
CI repeats the tests on PostgreSQL 17 (Supabase's version).

Production: "Deploy database migrations" succeeded on 2026-09-25. Verified live through the
Supabase API with the publishable key: all 9 tables exist (an unknown table returns 404),
anonymous reads return no rows (RLS) and an anonymous insert is rejected (42501).

---

### TASK 004 — Seed Symbols

Create initial 15-symbol configurable seed universe.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: `supabase/migrations/20260925150000_seed_initial_universe.sql` (approved list, D-014),
`tests/db/05_universe.test.sql` (12 checks).

Verified: all 87 database checks pass locally; incremental `supabase db push` rehearsal
applied only the new migration (8 US / 4 forex / 2 crypto / 1 gold).

Production: applied through the update package (D-015) on 2026-09-25. "Deploy database
migrations" log shows the tests passing and "Applying migration
20260925150000_seed_initial_universe.sql"; repository verified identical to the tested
project.

---

## PHASE 2 — PROVIDER

### TASK 005 — Provider Interface

Create market-data provider abstraction.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: `supabase/functions/_shared/providers/` (normalized candle, capability facts, error
classification, symbol resolution, historical retrieval result, range-completeness rule,
provider registry) and `tests/providers/` (53 tests incl. the shared contract checker used by
every future adapter). Decision D-017. No provider adapter and no provider-specific values.

Verified: 95/95 unit tests and all database tests pass; the provider tests also pass under
Deno 2.9.7 (the Edge Functions runtime) and `deno check` passes.

---

### TASK 006 — Twelve Data Adapter

Implement historical 1-minute candle retrieval.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: `supabase/functions/_shared/adapters/twelve_data/` (request building, UTC
normalization, range completeness, error mapping, Basic-plan capabilities) and
`tests/adapters/` (21 tests incl. the shared provider contract). PROVIDERS.md §3 verified
against the official documentation. Decisions D-018 (raw prices, `adjust=none`), D-019.

Verified: 116/116 unit tests pass in Node and the provider/adapter tests pass in Deno 2.9.7;
mutation checks confirmed the tests catch a wrong adjustment, zero-filled volume, a missed
full page, an accepted foreign instrument and a missing auth header.

Carry-forward to TASK 007: the live check with the owner's key (PROVIDERS.md P-5). Gold
(XAU/USD) is expected to be refused on the Basic plan; it will be reported as
PLAN_RESTRICTED, never worked around.

---

### TASK 007 — Supabase Market Data Function

Create secure Edge Function for provider access.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: `supabase/functions/market-data/` + `_shared/market-data/` (secret-key-only access,
symbol lookup, configured provider only, no storage), `functions.yml` deploy workflow,
`live-check.yml` + `scripts/live-check.mjs`, 16 tests. Decisions D-020, D-021.

Verified: 132/132 unit tests (Node), function tests in Deno, `deno check`, local Deno run of
the entry point. Deployed to Supabase by *Deploy Edge Functions*. *Provider live check* #1
against Twelve Data (Basic plan): SPY opening window 90/90 candles, EUR/USD, BTC/USD and
XAU/USD 60/60 each, weekend answered as "no data" — see D-021 for the findings, which were
applied to the adapter (`end_date` is inclusive) and to PROVIDERS.md §3. Live check #2 after
that change: exactly 90 / 60 / 60 / 60 rows, nothing rejected, weekend answered as no data.

---

### TASK 008 — Import Job Engine

Implement import jobs and run IDs.

Status:

```text
COMPLETE — 2026-09-25
```

Delivered: `supabase/functions/importer/` + `_shared/importer/` (runs with run ids, safe windows,
one job per window, validation, duplicate-safe storage, stopping rule with resume point),
`_shared/server/` (shared by both functions), `import-run.yml` + `scripts/import-run.mjs`,
23 tests + 10 database checks. Decision D-022.

Verified so far: 153/153 unit tests (Node), 105 in Deno, all database tests incl. the importer's
SQL on PostgreSQL, `deno check`, local Deno run of the entry point.

Production: deployed by *Deploy Edge Functions* (1-year scoped token). *Import run* #1: SPY
2026-09-24 09:30–11:00 ET → run `1d5e34a0…`, 1 job, received 90, inserted 90, duplicates 0.
Re-run over the same range → run `bbddb0f3…`, received 90, inserted 0, duplicates 90: nothing
stored twice.

---

### TASK 009 — Checkpointing

Implement resumable imports.

Status:

```text
COMPLETE — 2026-09-26
```

Delivered: answered-coverage checkpoint (`_shared/importer/coverage.js`), skip of answered
windows, `continue` mode, interrupted-job recovery, settled-minutes rule, database function
`refresh_import_progress` (migration `20260925190000`), updated *Import run* workflow.
Decision D-023.

Verified: 164/164 unit tests, all database tests incl. 6 new progress checks, Supabase CLI
rehearsal of the incremental migration (dry run + apply). Deployed: migration applied by
*Deploy database migrations*, functions by *Deploy Edge Functions* (2026-09-26).

Production: *Import run* #2, SPY, mode `continue` → run `75119828…`: the 90 answered minutes of
24 Sep were skipped; one window 2026-09-24 15:00Z → 2026-09-26 07:06Z (settled limit) returned
690 candles (24 Sep 11:00–16:00 ET = 300 + 25 Sep 09:30–16:00 ET = 390), all inserted.
Checkpoint 2026-09-26 07:06Z although the last candle is 2026-09-25 19:59Z (15:59 ET): the
closed-market hours are answered, not missing. import_progress: 780 candles, 24 Sep 13:30Z →
25 Sep 19:59Z; common dataset null (other enabled symbols have no data yet).

---

### TASK 010 — Deduplication

Implement database/application duplicate prevention.

Status:

```text
COMPLETE — 2026-09-26
```

Delivered: `_shared/importer/dedupe.js` (identical repeats stored once; conflicting versions
rejected; stored minutes compared, provider revisions reported, never written), store returns
inserted minutes and reads stored values as exact text. Decision D-024.

Verified so far: 172/172 unit tests (8 new dedupe tests + 1 through the importer function), 5
new database checks (incl. proof that PostgreSQL alone would keep a conflicting version
silently), and the live Supabase API accepts the read-back query.

Production: deployed 2026-09-26 (all workflows green). *Import run* #3, QQQ 2026-09-24
09:30–11:00 ET → run `ac9e7128…`: received 90, inserted 90 (counted from the minutes the
database returned), duplicates 0; import_progress 90 candles. The duplicate / conflict /
revision paths only occur on repeated or recovered windows; they are covered by the tests above,
and their database query was accepted by the live API.

---

### TASK 011 — Balanced Import

Implement fair progress across enabled symbols.

Status:

```text
COMPLETE — 2026-09-26
```

Delivered: research window for every market (migration `20260926100000`, `session.js`: only
09:30–11:00 America/New_York stored), history start 26 Sep 2025 (`config.js`), balanced GET DATA
mode (`balance.js`: furthest-behind symbol first, common frontier, set-aside vs run-stopping
failures), *Import run* workflow mode `balanced`. Decisions D-025, D-026; SR-09 resolved.

Verified so far: all unit tests incl. 6 window and 8 balance tests and 4 balanced function tests;
database tests incl. the migration never overwriting an owner-set session; Supabase CLI
rehearsal of the migration (all 15 symbols → 09:30–11:00 America/New_York).

Production: deployed 2026-09-26 (migration applied, all workflows green). *Import run* #4, mode
`balanced`, 7 jobs → run `e2f98e4a…`: history 2025-09-26 → 2026-09-26 12:04Z; the 7 symbols first
by name (AAPL … GBP/USD) each got window 2025-09-26 00:00Z → 09-29 11:19Z. Stored: stocks and
EUR/USD, GBP/USD 90 (Fri 26 Sep 09:30–10:59 ET), BTC/USD and ETH/USD 270 (Fri–Sun × 90), AUD/USD
45 (the provider returned 1 015 rows for the block vs ≈ 2 000 for the other pairs — a provider gap,
recorded as received, never filled). 14 910 rows outside the window counted, not stored. Common
frontier 2025-09-26 00:00Z (8 symbols not yet started); BTC/ETH blocks returned 4 999 rows = one
per minute, inside the safe size.

---

### TASK 012 — Rate Limit Handling

Implement quota/rate-limit handling and retry scheduling.

Status:

```text
IN PROGRESS — built and tested; waiting for deployment and the first scheduled runs
```

Delivered: credit budget in the importer (`budget.js`: ≤ 7 requests per rolling minute, ≤ 780 per
UTC day, counted from recorded requests; refusals create no job), `retryAtUtc` and `budget` in
every response, hourly *Import scheduler* workflow + `scripts/import-scheduler.mjs` (waits,
exponential backoff with jitter, clean stop at the daily limit, loud stop on auth/config).
Decision D-027; SR-15 resolved.

Verified so far: all unit tests incl. 5 budget, 3 budget-through-the-function and 8 scheduler
tests; a local run of the scheduler loop against a stand-in importer (waited for the budget,
backed off after a 502, stopped at the daily limit, exit 0).

---

## PHASE 4 — DATA QUALITY

### TASK 013 — Session Validator

Implement timezone-aware trading session validation.

Status:

```text
TODO
```

---

### TASK 014 — Data Quality Engine

Implement missing/duplicate/OHLC/session validation.

Status:

```text
TODO
```

---

## PHASE 5 — ADMIN

### TASK 015 — Admin Dashboard

Implement:

* GET DATA
* import progress
* provider status
* data health
* logs

Status:

```text
TODO
```

---

## PHASE 6 — ORB

### TASK 016 — ORB Engine

Implement 1/3/5/10/15-minute ORB calculations.

Status:

```text
TODO
```

---

### TASK 017 — Breakout Detection

Implement first valid breakout detection.

Status:

```text
TODO
```

---

### TASK 018 — ORB Event Storage

Store ORB events.

Status:

```text
TODO
```

---

## PHASE 7 — BACKTEST

### TASK 019 — Backtest Engine

Implement deterministic historical trade simulation.

Status:

```text
TODO
```

---

### TASK 020 — Performance Metrics

Implement:

* win rate
* R
* profit factor
* drawdown
* averages
* breakdowns

Status:

```text
TODO
```

---

### TASK 021 — Backtest UI

Create backtest controls and results dashboard.

Status:

```text
TODO
```

---

## PHASE 8 — RELATIONSHIPS

### TASK 022 — Relationship Engine

Implement cross-symbol ORB matching.

Status:

```text
TODO
```

---

### TASK 023 — Lead/Lag Analysis

Implement delay analysis.

Status:

```text
TODO
```

---

### TASK 024 — Relationship Dashboard

Create relationship matrix and filters.

Status:

```text
TODO
```

---

## PHASE 9 — FINALIZATION

### TASK 025 — Automated Tests

Implement full test suite.

Status:

```text
TODO
```

---

### TASK 026 — Mobile Optimization

Optimize iPhone/iPad experience.

Status:

```text
TODO
```

---

### TASK 027 — Security Review

Review:

* secrets
* RLS
* Edge Functions
* frontend exposure

Status:

```text
TODO
```

---

### TASK 028 — Performance Review

Review:

* database indexes
* queries
* pagination
* frontend performance

Status:

```text
TODO
```

---

### TASK 029 — Documentation

Complete setup/deployment documentation.

Status:

```text
TODO
```

---

### TASK 030 — Final Validation

Perform complete end-to-end validation.

Status:

```text
TODO
```

---

# TASK RULE

Only mark a task COMPLETE after:

1. implementation
2. testing
3. verification
4. documentation
