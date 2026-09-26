# DECISION LOG

Records decisions that interpret or extend the specification. Each entry states who decided,
when, what, and which spec file it affects. Methodology, database, security, provider,
timezone and deployment decisions require owner approval (INSTRUCTIONS.md §4).

---

## D-001 — Specification files live at the repository root

* **Date:** 2026-09-25
* **Task:** TASK 001
* **Type:** Repository organisation (no methodology impact)
* **Decision:** Keep all specification files (`CLAUDE.md`, `PROJECT.md`, `INSTRUCTIONS.md`,
  `RULES.md`, `ARCHITECTURE.md`, `DATABASE.md`, `ORB_SPEC.md`, `RELATIONSHIPS.md`,
  `PROVIDERS.md`, `ROADMAP.md`, `TASKS.md`) at the root.
* **Reason:** `CLAUDE.md` and `INSTRUCTIONS.md` reference them by bare file name. Moving them
  would require editing the specification's own read-list.
* **Engineering notes** (reviews, decisions) live in `docs/`.

## D-002 — No dependencies in TASK 001

* **Date:** 2026-09-25
* **Task:** TASK 001
* **Type:** Repository organisation
* **Decision:** TASK 001 adds no package manager, framework or runtime. The verification
  script is POSIX `sh`. Package configuration is TASK 002's scope.

## D-003 — Zero-dependency, no-build frontend and tooling

* **Date:** 2026-09-25
* **Task:** TASK 002
* **Type:** Development tooling (architecture unchanged: GitHub Pages + Supabase)
* **Decision:**
  * Frontend is plain HTML, CSS and native ES modules (`<script type="module">`), with no
    framework and no bundler. What is in `frontend/` is exactly what GitHub Pages serves.
  * Tests use Node's built-in runner (`node --test`, `node:assert`).
  * Local dev server is `scripts/serve.mjs` (Node standard library only).
  * `package.json` has no `dependencies` or `devDependencies`. Requires Node ≥ 22.
* **Reason:** CLAUDE.md asks to avoid unnecessary dependencies; the spec requires a static
  GitHub Pages site. No build step also means nothing can differ between what is tested and
  what is deployed. Plain ES modules also run unchanged in Deno (Supabase Edge Functions),
  which keeps the door open for sharing pure logic (see SR-16).
* **Reversible:** Standard ES modules can be moved under a bundler (e.g. Vite) later without
  rewriting. A future dependency should be added only when a task needs it, and recorded here.
* **Context:** the npm registry was not reachable from the build sandbox, so an npm-based
  toolchain could not have been installed and tested there.

## D-004 — Hash-based routing

* **Date:** 2026-09-25
* **Task:** TASK 002
* **Type:** Frontend implementation
* **Decision:** Section URLs are `#/data`, `#/backtest`, etc.
* **Reason:** GitHub Pages cannot rewrite unknown paths to `index.html`, so path routes
  (`/backtest`) would 404 on reload or when shared. Hash routes always work, on any repository
  name, without a 404.html workaround.

## D-005 — Frontend security guards

* **Date:** 2026-09-25
* **Task:** TASK 002
* **Type:** Security hardening (within existing security architecture)
* **Decision:**
  * `frontend/js/app-config.js` may contain only `supabaseUrl` and `supabaseAnonKey`.
    `validateConfig` rejects any other field, any service-role JWT and any `sb_secret_` key,
    and the UI shows a red error banner instead of connecting.
  * `index.html` sets a Content-Security-Policy: scripts and styles from the site only; network
    calls only to the site and `https://*.supabase.co`; no inline script, no `eval`.
  * `tests/frontend-security.test.js` fails the build if the frontend mentions provider key
    names, calls the provider API directly, uses browser storage, or loads third-party scripts.
* **Reason:** PROJECT.md §14, RULES.md — SECURITY, ARCHITECTURE.md §9.

## D-006 — Local Supabase CLI configuration deferred to TASK 003

* **Date:** 2026-09-25
* **Task:** TASK 002
* **Type:** Scope
* **Decision:** `supabase/config.toml` (from `supabase init`) is created in TASK 003, together
  with the first migration. TASK 002 adds only `supabase/functions/.env.example`
  (variable names, no values).
* **Reason:** the Supabase CLI could not be installed in the build sandbox, and a hand-written
  `config.toml` that was never run by the CLI would be unverified.

## D-007 — GitHub Actions: CI and Pages deployment

* **Date:** 2026-09-25
* **Task:** Between TASK 002 and TASK 003 (owner asked to push to GitHub and test there)
* **Type:** Deployment (implements the specified GitHub Pages hosting; resolves SR-18)
* **Decision:**
  * `.github/workflows/ci.yml` runs `npm run check` on every push and pull request, and
    `npm run check:supabase` as a separate job (visible failure, does not block deploys).
  * `.github/workflows/pages.yml` runs the checks, then publishes `frontend/` to GitHub Pages
    on every push to `main`. No build step; the published files are the tested files.
* **Manual step (owner):** repository Settings → Pages → Source: **GitHub Actions**.
* **Note:** GitHub Pages on a free GitHub plan requires a public repository.

## D-008 — Supabase project connected (public values only)

* **Date:** 2026-09-25
* **Type:** Configuration
* **Decision:** `frontend/js/app-config.js` holds the project URL and the publishable key
  (`sb_publishable_…`). Both are public by design. Data access is controlled by Row Level
  Security from TASK 003. No secret key, service-role key or database password is stored
  anywhere in the repository.

## D-009 — Database questions SR-04 to SR-07: recommended defaults approved

* **Date:** 2026-09-25 · **Task:** TASK 003 · **Approved by:** project owner
* SR-04: relationship index on `orb_relationships`.
* SR-05: `data_quality.invalid_ohlc_candles`, `invalid_timestamp_candles`.
* SR-06: `trades.exit_reason` (`take_profit`, `stop_loss`, `time_exit`, `ambiguous_stop`) and `trades.created_at`.
* SR-07: `candles.timestamp_et` kept for all symbols, derived from UTC by trigger.
* DATABASE.md updated ("APPROVED ADDITIONS").

## D-010 — Candle unique index column order

* **Date:** 2026-09-25 · **Task:** TASK 003 · **Type:** Implementation (same uniqueness rule)
* **Decision:** `unique (symbol_id, interval, timestamp_utc)` instead of a separate unique index
  plus `(symbol_id, timestamp_utc)` and `(symbol_id, interval, timestamp_utc)` indexes.
* **Reason:** one index serves all three purposes. At ~850 MB/year of candles, avoiding a
  redundant index matters on the free plan.

## D-011 — Row Level Security: signed-in read, nobody writes from the browser

* **Date:** 2026-09-25 · **Task:** TASK 003 · **Type:** Security (within ARCHITECTURE.md §9)
* **Decision:** RLS on every table. SELECT policies for `authenticated` only. No write
  policies; write privileges revoked from `anon` and `authenticated`. Edge Functions write
  with the service role.
* **Consequence:** the public website shows no data to anonymous visitors. Reading data will
  require sign-in (SR-14, decided before the first data page).
* **Reason:** secure by default; market data from a provider may not be licensed for public
  redistribution.

## D-012 — Automatic migration deployment through GitHub Actions

* **Date:** 2026-09-25 · **Type:** Deployment · **Approved by:** project owner ("Automatic via GitHub")
* **Decision:** `.github/workflows/database.yml` runs unit tests, full schema tests on a
  throwaway PostgreSQL 17, a dry run, then `supabase db push` using the `SUPABASE_DB_URL`
  repository secret (Session pooler connection string).
* **Safeguards:** `tests/migrations.test.js` fails any migration containing DROP, TRUNCATE,
  DELETE FROM, column drop/rename or disabling RLS unless it carries
  `-- approved-destructive: <reason>`. Candles are also protected by trigger (D-013).
* The database password lives only in GitHub Secrets — never in the repository.

## D-013 — Candles are immutable in the database

* **Date:** 2026-09-25 · **Task:** TASK 003 · **Type:** Data integrity (enforces RULES.md)
* **Decision:** triggers block UPDATE, DELETE and TRUNCATE on `candles`, and `timestamp_et`
  is always derived. Override only inside an explicitly approved transaction.
* **Reason:** RULES.md — never shift timestamps, never silently delete, no destructive
  operation without approval; research reproducibility.

## D-014 — Initial research universe (15 symbols)

* **Date:** 2026-09-25 · **Task:** TASK 004 · **Approved by:** project owner
* **Seeded by:** `supabase/migrations/20260925150000_seed_initial_universe.sql` (insert-if-missing;
  never overwrites later configuration changes).

| Market | Symbols (Twelve Data symbol = same) | Session |
|--------|-------------------------------------|---------|
| US (8) | SPY, QQQ, AAPL, MSFT, NVDA, AMD, TSLA, META | America/New_York 09:30 → 11:00 (exclusive; 90 candles) |
| Forex (4) | EUR/USD, GBP/USD, USD/JPY, AUD/USD | not defined yet (SR-09) |
| Crypto (2) | BTC/USD, ETH/USD | not defined yet (SR-09) |
| Gold (1) | XAU/USD | not defined yet (SR-09) |

* SPY and QQQ are index ETFs, stored with market `us_stock`; SPY is the reference symbol in
  RELATIONSHIPS.md. The owner considered adding the NASDAQ index and chose QQQ (tracks the
  Nasdaq-100, available on every plan) instead.
* Non-US symbols use timezone `UTC` as a placeholder with no session hours, so no ORB or
  backtest runs for them until their sessions are agreed.
* `session_end` is an exclusive boundary (documented on the column).

## D-015 — Updates delivered as one package, applied by a workflow

* **Date:** 2026-09-25 · **Type:** Development workflow · **Requested by:** owner (uses the GitHub website only)
* **Problem:** uploading many files through the GitHub website flattens folders when files
  are selected individually and skips hidden folders such as `.github`.
* **Decision:** each update is one file, `orb-update.zip` — a full, tested snapshot of the
  project without `.github/` (built by `scripts/make-update.sh`). The owner uploads the zip
  itself to the top level. `.github/workflows/apply-update.yml` validates it, runs
  `npm run check` on it (nothing is applied on failure), makes the repository match it
  exactly (except `.git/` and `.github/`), commits, and starts CI, Pages and database deploy.
* Workflow files (`.github/workflows/*`) still need a direct upload into that folder, because
  GitHub does not allow workflows to change workflow files.

## D-016 — PROVIDERS.md approved

* **Date:** 2026-09-25 · **Approved by:** project owner
* **Decision:** PROVIDERS.md revision 2 is approved and replaces the provisional file. The
  original PROVIDERS.md was unavailable; the approved text is derived from the original project
  files. The final change before approval was to §6 rule 2: the range-sizing rule now reads
  "A requested range must be sized conservatively enough that, based on the provider's verified
  page-size and timestamp semantics, the provider cannot truncate the response without the
  adapter detecting it."
* Items marked **(proposed)** and **TO BE VERIFIED** inside PROVIDERS.md keep that status.

## D-017 — Location and form of the shared provider layer (TASK 005)

* **Date:** 2026-09-25 · **Task:** TASK 005 · **Type:** Implementation
* **Decision:** the provider abstraction lives in `supabase/functions/_shared/providers/` as
  plain JavaScript ES modules with explicit `.js` imports and no dependencies. `_shared` is
  Supabase's convention for code used by Edge Functions (folders starting with `_` are not
  deployed as functions). The same files run in Deno (Edge Functions) and in Node (tests).
* **Verified:** all 53 provider tests pass under Node 22 and under Deno 2.9.7; `deno check`
  passes on the module.
* **Implementation choices inside the approved PROVIDERS.md:**
  * Capabilities are *facts*: verified (with a source) or unverified. `requireVerified()`
    throws for unverified facts, so code cannot rely on a TO BE VERIFIED value.
  * Timestamps without an explicit timezone are rejected by the shared normalizer; the adapter
    must convert provider timestamps (whose semantics are TO BE VERIFIED) explicitly.
  * Range completeness (§6) is decided in one function, `assessCompleteness()`: an adapter's
    "nothing more" is trusted only if the provider's explicit truncation signal is verified,
    and an unknown truncation state counts as answered only when the range fits a verified
    `maxSafeRangeMinutes`. Otherwise the range is "undetermined" and must be split.
  * A truncated result's remainder overlaps the boundary candle by one minute (duplicates are
    only counted, gaps would skip data), and returns null instead of looping when no progress
    is possible.
  * The shared contract checker (`tests/providers/provider-contract.js`) returns a list of
    violations; every adapter's tests must assert it is empty.

## D-018 — Import raw (unadjusted) prices

* **Date:** 2026-09-25 · **Approved by:** project owner · **Task:** TASK 006
* **Decision:** Twelve Data requests are sent with `adjust=none`. Twelve Data's default
  (`adjust=splits`) rewrites past prices after a split, which would make newly imported candles
  disagree with the immutable candles already stored. Raw prices never change afterwards.
  ORB levels, stops, targets and R-multiples are computed within one session, so a split between
  sessions does not affect them.

## D-019 — Twelve Data plan and adapter design (TASK 006)

* **Date:** 2026-09-25 · **Task:** TASK 006 · **Type:** Implementation
* **Owner's plan:** Basic (free), confirmed by the owner. Its limits (8 credits/min, 800/day,
  daily reset 00:00 UTC, 1 credit per time_series request) are verified capabilities. Other
  plans are refused by the adapter until they are verified.
* **Location:** `supabase/functions/_shared/adapters/twelve_data/`, outside the provider-neutral
  layer, which stays free of provider names (neutrality test).
* **Request:** API key in the `Authorization: apikey …` header (documented as recommended), never
  in the URL; `timezone=UTC` so dates sent and datetimes received are UTC; `order=asc`;
  `outputsize=5000`; `end_date` = the exclusive range end.
* **Range completeness:** Twelve Data has no "more data" signal and does not document whether
  `end_date` is inclusive. A range of at most 4 999 minutes therefore can never exceed the
  5 000-row page, even with one extra boundary bar, so it counts as answered (PROVIDERS.md §6.2).
  A full page is reported as truncated; because the documentation does not say which end of a
  range a truncated response keeps, the remainder is not guessed — the range is split.
* **Unverified behaviour kept safe:** the "no data" message wording and a daily-limit 429 wording
  are matched by patterns; if they don't match, the error falls back to UNKNOWN (shown to the
  owner) or RATE_LIMITED (retried next minute). Both are listed for the live check.

## D-020 — market-data Edge Function: access, deployment and live check (TASK 007)

* **Date:** 2026-09-25 · **Task:** TASK 007 · **Type:** Implementation (security-relevant)
* **Access:** server-to-server only for now. Callers must send a Supabase **secret key** in the
  `apikey` header; the function compares it (constant time) with `SUPABASE_SECRET_KEYS`, which
  Supabase provides to every function. The gateway JWT check is off (`verify_jwt = false`)
  because secret keys are not JWTs; the function itself fails closed. No CORS headers are sent,
  so no browser can call it. Browser access for the signed-in owner (the Admin "GET DATA" button)
  is decided in TASK 015; until then the provider quota cannot be used by anyone else.
* **Scope:** one provider call per request; nothing is stored. The symbol is read from the
  `symbols` table and only its configured provider is used (PROVIDERS.md §5, §14).
* **Configuration:** the plan (`basic`) and the secret's *name* are committed in
  `_shared/market-data/config.js`; the provider key is only in Supabase Edge Function secrets.
* **Deployment:** `.github/workflows/functions.yml` runs `npm run check`, then
  `supabase functions deploy market-data --use-api` with the GitHub secret
  `SUPABASE_ACCESS_TOKEN`. *Apply update package* also starts it (D-015).
* **Live check:** manual workflow `live-check.yml` → `scripts/live-check.mjs`, using a
  dedicated Supabase secret key stored as the GitHub secret `SUPABASE_SECRET_KEY`. It never sees
  the provider key. Five calls, 10 s apart.

## D-021 — Provider live check results (TASK 007)

* **Date:** 2026-09-25 · **Task:** TASK 007 · **Type:** Verification
* **Run:** *Provider live check* #1 on GitHub Actions against the deployed `market-data`
  function, owner's Basic plan, 5 calls. Trading day 2026-09-24, weekend 2026-09-19.
* **Results:**
  * SPY opening window 09:30–11:00 ET: 90 of 90 candles, first 13:30Z (EDT), all with volume,
    prices as exact decimals, nothing else rejected.
  * EUR/USD, BTC/USD, XAU/USD 14:00–15:00 UTC: 60 of 60 candles each, **no volume** (stored as
    null). **Gold is available on the Basic plan.**
  * Saturday: code 400 "No data is available on the specified dates…", recorded as an answered,
    empty range.
  * `end_date` is **inclusive**: each response carried one extra bar at the range end, which the
    shared layer rejected as outside the range (nothing stored twice, nothing lost).
  * `api-credits-used` / `api-credits-left` headers present.
* **Change made:** the adapter now sends `end_date` = the range's last bar (end − 1 minute), so
  no out-of-range bar is returned. Capabilities updated: markets include gold; volume per market
  verified. Still unverified: daily-limit 429 wording, history depth per symbol, which end a
  truncated response keeps (never relied on).

## D-022 — Import job engine (TASK 008)

* **Date:** 2026-09-25 · **Task:** TASK 008 · **Type:** Implementation
* **Where:** a second server-only Edge Function, `importer`, with the same access rule as
  `market-data` (Supabase secret key, no CORS; D-020). Logic in `_shared/importer/`; shared
  server helpers (`_shared/server/`) are now used by both functions.
* **Run:** one call = one run with a new `run_id` (UUID) = one symbol + one requested UTC range.
  The range is split into windows of at most the provider's verified safe size (4 999 min for
  Twelve Data), processed oldest first, one `import_jobs` row per window.
* **Per window:** fetch → validate (rules mirror the `candles` constraints, compared as exact
  decimals; invalid rows are reported, never corrected) → insert with
  `ON CONFLICT (symbol_id, interval, timestamp_utc) DO NOTHING` (duplicates counted, never stored
  twice) → job updated with received / inserted / duplicate counts.
* **Statuses:** `succeeded` = window definitively answered (may hold zero candles — the
  provider's "no data" message is kept in `error_message` as a fact, not an interpretation);
  `partial` = completeness not established (`RANGE_NOT_COMPLETE`); `rate_limited` with
  `next_retry_at`; `failed` with `error_code` (provider code, `DATABASE_ERROR`, `INTERNAL_ERROR`).
  For succeeded jobs `error_message` carries notes (rejected rows, provider indication).
* **Stopping rule:** the run stops at the first window that is not `succeeded`, and reports
  `nextStartUtc`, so a later run can never skip a range. It also stops after `maxJobs` windows
  (default 4, at most the plan's credits per minute − 1 = 7), keeping one run inside the Basic
  plan's minute limit until pacing is built (TASK 012).
* **Not in this task:** `import_progress` checkpoints and resuming (TASK 009), choosing what to
  import and balance across symbols (TASK 011), pacing/retry scheduling (TASK 012), the Admin
  button (TASK 015). A job left `running` by a crash is handled by TASK 009.
* **Triggered for now** by the manual workflow *Import run* (`import-run.yml`); the deploy
  workflow now deploys every function in `supabase/functions`.

## D-023 — Checkpointing and resume (TASK 009)

* **Date:** 2026-09-25 · **Task:** TASK 009 · **Type:** Implementation
* **Checkpoint = answered coverage, not the last candle** (PROVIDERS.md §6.1). The windows of
  `succeeded` import jobs are merged per symbol / provider / interval. The checkpoint is the end
  of the first contiguous answered block; a weekend or holiday with no candles is still answered.
* **Resume:** every run skips windows that are already answered and requests only what is
  missing, so repeating or continuing a run costs no credits for done work and can never skip a
  range. New mode `continue`: from the symbol's history start up to the latest settled minute —
  i.e. it fills any hole and then extends the history.
* **Interrupted jobs:** a job still `running` 15 minutes after it started (Edge Functions stop far
  sooner) is closed as `failed` / `INTERRUPTED` at the start of the next run for that symbol; its
  window is not answered, so it is requested again. Candles it may have stored are only counted
  as duplicates.
* **Settled minutes only:** a run may only request minutes that ended at least 30 minutes ago.
  Otherwise a bar the provider has not published yet could be recorded as "answered with nothing"
  and never requested again.
* **import_progress** (PROJECT.md §8) is recomputed from the stored candles by the new database
  function `refresh_import_progress(symbol_id, provider, interval)` after each run that stored
  candles: first / last candle, count, and the common dataset timestamp = the minimum last
  candle across enabled symbols (null until every enabled symbol has candles). Recomputing, not
  incrementing, means it cannot drift. Server-side only (execute revoked from browser roles).
  Migration `20260925190000_import_progress_refresh.sql` is additive (one function).

## D-024 — Duplicate handling (TASK 010)

* **Date:** 2026-09-26 · **Task:** TASK 010 · **Type:** Implementation
* **Database layer (unchanged, TASK 003):** unique key `(symbol_id, interval, timestamp_utc)`;
  candles are immutable (update/delete blocked). A stored minute can never exist twice or be
  overwritten.
* **Application layer (new, `_shared/importer/dedupe.js`)**, applied to every response before
  storage:
  1. the same minute repeated in one response with identical values → stored once, repeats
     counted in `duplicate_count`;
  2. the same minute repeated with **different** values → no version is stored and every row is
     reported as `CONFLICTING_DUPLICATE`. Verified on PostgreSQL: a single
     `INSERT … ON CONFLICT DO NOTHING` with two versions silently keeps the first — choosing
     would be a guess, so the importer refuses to;
  3. minutes already stored → skipped by the unique key and counted as duplicates; their stored
     values are read back as exact text (`numeric::text`) and compared. If the provider now sends
     different values the stored candle is **kept** (immutable) and the job records
     `REVISED_BY_PROVIDER` with the minutes in `error_message`.
* **Recording:** `duplicate_count` = identical repeats + minutes already stored.
  `CONFLICTING_DUPLICATE` / `REVISED_BY_PROVIDER` appear as warning codes in `error_code` on a
  `succeeded` job (status stays `succeeded`: the window was answered). The minute of a conflict
  stays missing and will show as missing in data quality (TASK 014) — never filled by a guess.
* Values are compared as exact decimals ("10.50" = "10.5"); an absent volume never equals 0.
* Checked live: Supabase's API accepts the read-back query (`in.(…)` minute list with
  `::text` casts).

## D-025 — Research window, history start and dataset size (TASK 011)

* **Date:** 2026-09-26 · **Approved by:** project owner · **Closes:** SR-09
* **Stored data = the research window only.** For every symbol, only candles from 09:30 up to
  11:00 **America/New_York** (11:00 excluded, 90 candles) are stored. This applies to forex,
  crypto and gold too, so all symbols are observed at the same moments as the US open
  (cross-symbol research, RELATIONSHIPS.md). Crypto is included every day, weekends too; the
  other markets simply have no weekend candles. Recorded as configuration in
  `symbols.session_*` (migration `20260926100000_research_window_all_markets.sql` fills only
  undefined sessions), applied by the importer (`_shared/importer/session.js`, DST-aware via
  the time-zone database). Candles outside the window are counted on the job, never stored.
* **History start:** 26 Sep 2025 (one year), `_shared/importer/config.js`.
* **Fetching:** whole safe windows (≤ 4 999 min) are fetched and filtered — about 1 575 credits
  for the year (≈ 2 days of the Basic quota), instead of ≈ 5 475 for one request per day.
* **Why:** a full year of every minute for 15 symbols is ≈ 3.7 M rows / ≈ 850 MB, above the
  Supabase free plan's 500 MB. The window-only dataset is ≈ 364 000 rows / ≈ 85 MB.
* **Existing candles:** SPY's 690 test candles outside the window (24–25 Sep 2026) are kept
  (owner decision); research only uses the window.
* Open follow-ups for later tasks: the time exit for non-US markets (SR-13 covers 11:00 ET)
  and what counts as a closed session for forex / gold in data quality (TASK 013/014).

## D-026 — Balanced import / GET DATA (TASK 011)

* **Date:** 2026-09-26 · **Task:** TASK 011 · **Type:** Implementation
* `{ "balanced": true }` on the importer = one GET DATA run with one run id over **all enabled
  symbols** (read from the `symbols` table, never hard-coded).
* Each symbol's **frontier** = the first unanswered minute from the history start to the latest
  settled minute. Every step imports **one window for the symbol whose frontier is earliest**
  (ties by symbol name), so no symbol is ever more than one window (≤ 4 999 min) ahead.
* **Common frontier** (`commonAnsweredThroughUtc`) = the minimum frontier: every importable
  enabled symbol is answered at least that far. `import_progress.common_dataset_timestamp`
  (last stored candle, PROJECT.md §8) is refreshed alongside.
* Failures: provider-wide codes (rate limit, quota, auth, outage, network, timeout, database,
  internal) stop the run; symbol-specific ones set that symbol aside for the rest of the run
  (reported), the others continue. A symbol that cannot be imported at all (no research window,
  no adapter) is listed and makes the run "not up to date" — never silently ignored.
* Runs are limited to `maxJobs` (≤ 7 on Basic). Automatic repeated runs and pacing are TASK 012;
  the Admin button is TASK 015.

## D-027 — Credit budget and scheduled importing (TASK 012)

* **Date:** 2026-09-26 · **Task:** TASK 012 · **Type:** Implementation (operations)
* **Budget in the importer** (`_shared/importer/budget.js`): before every provider request the
  importer counts its own recorded requests (`import_jobs.started_at`, per provider):
  at most **7 in any rolling 60 s** (Basic 8/min − 1 headroom) and **780 per UTC day** (Basic
  800/day − `CREDIT_RESERVE_PER_DAY` 20 for manual live checks, which share the key but are not
  recorded as jobs). Limits come from the provider's verified capabilities; the day resets at
  00:00 UTC (verified). A refused request creates no job and costs no credit; the run stops with
  `MINUTE_BUDGET_REACHED` / `DAILY_BUDGET_REACHED` and `retryAtUtc`. Because the count is read
  from the database, the limit holds across separate runs. Every response reports `budget`.
* **Scheduler** (`.github/workflows/import-scheduler.yml` + `scripts/import-scheduler.mjs`):
  GitHub Actions, hourly at minute 23, loops balanced runs for up to 50 minutes. It waits when the
  budget or the provider says so, backs off exponentially with jitter (5 s base, 120 s cap) on
  outages / network / database errors and stops after 4 in a row, stops cleanly when the daily
  budget or quota is used, and fails loudly on authentication or configuration problems (GitHub
  then shows a failed run). It shares the `import-run` concurrency group with the manual *Import
  run* workflow, so runs never overlap.
* **Why GitHub Actions:** it needs no new secret (uses `SUPABASE_SECRET_KEY`), its logs and
  reports are visible per run, and it can be paused with one click (Disable workflow).
  Alternative considered: Supabase `pg_cron` + `pg_net`, which would need the secret key stored in
  Supabase Vault — possible later if GitHub's schedule proves unreliable.
* **Expected pace:** about 7 requests per minute until 780 per day → the one-year history
  (≈ 1 575 requests) completes in about two UTC days, then each hourly run only tops up recent
  minutes (a few requests per day).
