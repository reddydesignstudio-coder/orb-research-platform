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
