# CHANGELOG

## TASK 014 — Data Quality Engine — 2026-09-26

Added

* `supabase/functions/_shared/quality/` (`assess.js`, `run.js`, `store.js`, `handler.js`) and the
  `data-quality` Edge Function (`supabase/functions/data-quality/`, `config.toml`).
* Migration `20260926140000_data_quality_details.sql`: `data_quality.checked_at`, `details`
  (jsonb object), `actual + missing ≥ expected` check.
* `scripts/data-quality.mjs` + `.github/workflows/data-quality.yml` (manual: pending / range).
* Tests: `tests/quality/assess.test.js`, `tests/quality/handler.test.js`,
  `tests/data-quality-script.test.js`, `tests/db/30_quality.test.sql`. Decision D-029.

Changed

* `scripts/import-scheduler.mjs`: after its import loop, checks the quality of newly imported
  sessions and adds the result to the run report.

## TASK 013 — Session Validator — 2026-09-26

Added

* `supabase/functions/_shared/sessions/`: `calendar.js` (NYSE holiday rules + special closures,
  FX/gold weekdays except 25 Dec and 1 Jan, crypto every day), `time.js` (IANA/Intl time-zone
  helpers, DST-safe local → UTC), `validator.js` (`sessionFor`, `sessionsBetween`,
  `expectedMinutes`, `sessionDateOf`, `checkSessionCandles`).
* `scripts/session-check.mjs` + `.github/workflows/session-check.yml`: read-only report of stored
  candles against the validator (no provider call).
* Tests: `tests/sessions/calendar.test.js`, `tests/sessions/validator.test.js`,
  `tests/session-check.test.js`. Decision D-028; SR-10 resolved.

Changed

* `_shared/importer/session.js` uses the shared time helpers (behaviour unchanged).

Verified live: *Session check* #2 — 0 weekend candles for stocks/forex; findings for TASK 014
(AUD/USD 45/90 per day, XAU/USD candles on two Saturdays, a few incomplete days).

## TASK 012 — Rate Limit Handling — 2026-09-26

Added

* `supabase/functions/_shared/importer/budget.js`; `CREDIT_RESERVE_PER_DAY` in `config.js`; the
  importer checks the budget before every request (all modes) and reports `budget`, `retryAtUtc`.
* `.github/workflows/import-scheduler.yml` + `scripts/import-scheduler.mjs` (hourly, paced).
* Tests: `tests/importer/budget.test.js`, `tests/import-scheduler.test.js`, budget tests through
  the importer function. Decision D-027; SR-15 resolved.

## TASK 011 — Balanced Import — 2026-09-26

Added

* Research window for every market: migration `20260926100000_research_window_all_markets.sql`;
  `_shared/importer/session.js`; the importer stores only 09:30–11:00 America/New_York.
* Balanced GET DATA mode: `_shared/importer/balance.js`, `config.js` (history start 26 Sep 2025);
  `_shared/server/symbols.js` loads all enabled symbols.
* *Import run* workflow: mode `balanced` (default); balanced report.
* Tests: `tests/importer/session.test.js`, `tests/importer/balance.test.js`, balanced function
  tests, universe/migration checks. Decisions D-025, D-026; SR-09 resolved.

## TASK 010 — Deduplication — 2026-09-26

Added

* `supabase/functions/_shared/importer/dedupe.js`; the engine deduplicates each response,
  compares minutes already stored and records `CONFLICTING_DUPLICATE` / `REVISED_BY_PROVIDER`.
* `store.insertCandles` returns the inserted minutes; `store.storedCandles` reads exact values.
* Tests: `tests/importer/dedupe.test.js`, a handler test, 5 database checks. Decision D-024.

## TASK 009 — Checkpointing — 2026-09-26

Added

* `supabase/functions/_shared/importer/coverage.js`; importer skips answered windows, `continue`
  mode, closes interrupted jobs, only imports settled minutes, refreshes `import_progress`.
* Migration `20260925190000_import_progress_refresh.sql` (function only, additive).
* *Import run* workflow: `mode` input (range | continue).
* Tests: `tests/importer/coverage.test.js`, `tests/importer/fake-backend.js`, extended handler,
  import-run and database tests. Decision D-023; DATABASE.md implementation notes.

## TASK 008 — Import Job Engine — 2026-09-25

Added

* `supabase/functions/importer/` and `supabase/functions/_shared/importer/` (engine, validation,
  store, handler); `supabase/functions/_shared/server/` (secret-key guard, PostgREST client,
  symbol + provider loading) — `market-data` now uses it too, behaviour unchanged.
* `.github/workflows/import-run.yml` + `scripts/import-run.mjs` (manual import run);
  `functions.yml` now deploys every function.
* Tests: `tests/importer/`, `tests/import-run.test.js`, `tests/db/20_importer.test.sql`.
* Decision D-022.

## TASK 007 — Supabase Market Data Function — 2026-09-25

Added

* `supabase/functions/market-data/index.ts` and `supabase/functions/_shared/market-data/`
  (handler, non-secret config); `[functions.market-data]` in `supabase/config.toml`.
* `.github/workflows/functions.yml` (deploy), `.github/workflows/live-check.yml` (manual),
  `scripts/live-check.mjs`; *Apply update package* now also starts the function deployment.
* Tests: `tests/market-data/handler.test.js`, `tests/live-check.test.js`.
* Decisions D-020, D-021. Live check applied: `end_date` sent as the range's last bar (it is
  inclusive); gold available on Basic; volume only for US stocks. PROVIDERS.md §3 updated.

## TASK 006 — Twelve Data Adapter — 2026-09-25

Added

* `supabase/functions/_shared/adapters/twelve_data/` — `adapter.js` (time_series request, key in
  header only, UTC dates, raw prices, meta check, completeness), `capabilities.js` (verified
  facts with sources; Basic plan), `errors.js` (error mapping, minute/daily waits), `mod.js`.
* `tests/adapters/` — 21 tests with synthetic responses in the documented format; no live calls.
* PROVIDERS.md §3 filled in from the official documentation; open items updated.
* Decisions D-018 (raw, unadjusted prices), D-019.

Not changed

* Shared provider layer, database, importer and frontend unchanged.

## TASK 005 — Provider Interface — 2026-09-25

Added

* `supabase/functions/_shared/providers/` — provider-neutral `MarketDataProvider` layer:
  `candle.js` (normalized 1-minute candle), `capabilities.js` (verified / unverified facts),
  `errors.js` (error categories, retry policy, secret redaction), `retrieval.js` (ranges,
  requests, results, range completeness), `provider.js` (contract, exact symbol resolution),
  `registry.js` (no fallback between providers), `mod.js` (entry point).
* `tests/providers/` — 53 tests incl. the shared contract checker, a synthetic fake provider,
  broken-provider cases and a provider-neutrality guard. Pass in Node and in Deno.
* Decision D-017.

Not changed

* No provider adapter; no Twelve Data values; no importer, ORB, backtest or frontend changes.

## One-file website updates — 2026-09-25

* `.github/workflows/apply-update.yml` + `scripts/make-update.sh`: updates arrive as one
  `orb-update.zip`, tested before it is applied, applied as an exact snapshot (D-015).

## TASK 004 — Seed Symbols — 2026-09-25

* `supabase/migrations/20260925150000_seed_initial_universe.sql` — 15 approved symbols (D-014),
  insert-if-missing; US sessions 09:30 → 11:00 ET; non-US sessions left undefined (SR-09).
* `tests/db/05_universe.test.sql` (12 checks, incl. idempotency and configurability);
  shared helpers moved to `tests/db/_helpers.sql`.
* `scripts/test-db.sh` reports clearly when it cannot connect to PostgreSQL.

## Deployment diagnostics — 2026-09-25

* `scripts/check-db-url.mjs` + tests: checks the `SUPABASE_DB_URL` secret's format in the
  database workflow before connecting, without printing the password.

## TASK 003 — Supabase Schema — 2026-09-25

Added

* `supabase/migrations/20260925120000_initial_schema.sql` — 9 tables with constraints,
  indexes, triggers (updated_at, timezone validation, DST-aware `timestamp_et`, candle
  immutability) and Row Level Security.
* `supabase/config.toml` (Supabase CLI).
* Database tests: `tests/db/` (75 checks) and `scripts/test-db.sh` / `npm run test:db`.
* `tests/migrations.test.js` — destructive-migration guard and RLS check.
* CI job on PostgreSQL 17; `.github/workflows/database.yml` applies migrations to Supabase.
* DATABASE.md "APPROVED ADDITIONS"; decisions D-009 – D-013; SR-19, SR-20.

## Visual refresh — 2026-09-25

Changed

* Colourful design: gradient header with ORB breakout logo, per-section colour and icon,
  coloured page headers, "What this section will do" cards (from the spec), Dashboard module
  tiles, compact rows on phones, light and dark themes.
* Live "Database online / paused / unreachable" pill in the header (`frontend/js/health.js`).
* Green and red kept out of the section palette — reserved for bullish / bearish results.
* Tests: 33 (health status, section colours/icons).

## Supabase + GitHub setup — 2026-09-25

Added

* Supabase project URL and publishable key in `frontend/js/app-config.js` (public values).
* `scripts/check-supabase.mjs` / `npm run check:supabase` — connectivity check using public values.
* `.github/workflows/ci.yml` — checks on every push/PR.
* `.github/workflows/pages.yml` — deploy `frontend/` to GitHub Pages after checks pass.
* Decisions D-007, D-008. SR-18 resolved.

## TASK 002 — Development Environment — 2026-09-25

Added

* `package.json` — npm scripts `dev`, `test`, `verify`, `check`; no dependencies; Node ≥ 22.
  `.nvmrc`.
* Frontend shell (`frontend/`): responsive layout (phone tab bar, sidebar from 900px),
  seven sections from PROJECT.md §16 as "Not built yet" pages, hash router, not-found page,
  research disclaimer footer, light/dark theme, Content-Security-Policy, `.nojekyll`.
* Public config guard (`frontend/js/config.js`) — rejects service-role/secret keys and any
  extra field; UI shows an error banner.
* `scripts/serve.mjs` — zero-dependency local dev server bound to 127.0.0.1.
* Tests (27, `node:test`): router, routes, config guard, dev server, frontend security.
* `supabase/functions/.env.example` — variable names only.
* Decisions D-003 to D-006; spec review SR-16 to SR-18.

Not changed

* No methodology, database or architecture changes. No dependencies.

## TASK 001 — Repository Foundation — 2026-09-25

Added

* Specification at repository root: `CLAUDE.md`, `PROJECT.md`, `INSTRUCTIONS.md`, `RULES.md`,
  `ARCHITECTURE.md`, `DATABASE.md`, `ORB_SPEC.md`, `RELATIONSHIPS.md`, `ROADMAP.md`, `TASKS.md`
  (copied verbatim from the Claude Project).
* `PROVIDERS.md` — provisional; the uploaded version duplicated `RELATIONSHIPS.md` (SR-01).
* `README.md`, `CHANGELOG.md`.
* `docs/README.md`, `docs/SPEC_REVIEW.md` (15 findings), `docs/DECISIONS.md` (D-001, D-002).
* Folder skeleton: `frontend/`, `supabase/migrations/`, `supabase/functions/`, `tests/`, `scripts/`.
* `.gitignore` (secrets, Supabase local state, build output), `.editorconfig`, `.gitattributes`.
* `scripts/verify-foundation.sh` — structure and credential-hygiene check (POSIX sh).

Not changed

* No methodology, architecture or database design changes.
* No dependencies added.
