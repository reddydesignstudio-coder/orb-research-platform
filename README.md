# ORB Research & Backtesting Platform

A web-based **historical research and backtesting** platform for Opening Range Breakout (ORB)
strategies across US stocks, forex, crypto and gold (XAUUSD).

This is a research tool. It is not a live trading application, and historical results are
never presented as a guarantee of future performance.

> **Status:** Phase 0 — Foundation complete. The app shell runs locally; no market data,
> database or calculations exist yet. See [`TASKS.md`](TASKS.md) for current progress.

---

## Architecture (summary)

```text
Browser → GitHub Pages frontend → Supabase Edge Functions → Market Data Provider
                                          │
                                          └→ Supabase PostgreSQL
```

Provider API keys and the Supabase service-role key live **only** in Supabase Edge Function
secrets. They never appear in this repository, the frontend, or the browser.
Full detail: [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Specification (source of truth)

The specification files live at the repository root because `CLAUDE.md` and
`INSTRUCTIONS.md` reference them by bare file name. Read them in this order:

| # | File | Contents |
|---|------|----------|
| 1 | [`CLAUDE.md`](CLAUDE.md) | Controller: how work is done in this repo |
| 2 | [`PROJECT.md`](PROJECT.md) | Purpose, objectives, universe, sessions, final product |
| 3 | [`INSTRUCTIONS.md`](INSTRUCTIONS.md) | Implementation style, testing, completion standard |
| 4 | [`RULES.md`](RULES.md) | Non-negotiable data, timezone, research and security rules |
| 5 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | System components and data flows |
| 6 | [`DATABASE.md`](DATABASE.md) | Tables, uniqueness, indexes |
| 7 | [`ORB_SPEC.md`](ORB_SPEC.md) | ORB methodology, entry, SL/TP, time exit, ambiguous candles |
| 8 | [`RELATIONSHIPS.md`](RELATIONSHIPS.md) | Cross-symbol association analysis |
| 9 | [`PROVIDERS.md`](PROVIDERS.md) | Market-data providers — approved (D-016); Twelve Data facts verified in TASK 006 |
| 10 | [`ROADMAP.md`](ROADMAP.md) | Phases |
| 11 | [`TASKS.md`](TASKS.md) | Ordered task queue and status |

Supporting engineering docs live in [`docs/`](docs/README.md).

---

## Repository layout

```text
.
├── CLAUDE.md, PROJECT.md, …, TASKS.md   Specification (root, see above)
├── README.md                            This file
├── CHANGELOG.md                         What changed, per task
├── docs/                                Engineering notes: spec review, decisions
├── package.json                         npm scripts only — no dependencies
├── frontend/                            GitHub Pages site (served as-is, no build)
│   ├── index.html
│   ├── css/app.css
│   └── js/                              main.js, router, routes, config guard, views/
├── supabase/
│   ├── config.toml                      Supabase CLI project config
│   ├── migrations/                      PostgreSQL schema migrations (applied by CI)
│   └── functions/                       Supabase Edge Functions      (TASK 007+)
│       ├── _shared/providers/           MarketDataProvider layer     (TASK 005)
│       ├── _shared/adapters/twelve_data/ Twelve Data adapter         (TASK 006)
│       ├── _shared/market-data/          market-data handler + config (TASK 007)
│       └── market-data/                  market-data Edge Function    (TASK 007)
├── tests/                               node:test unit tests; tests/db/ SQL schema tests
└── scripts/
    ├── serve.mjs                        Local dev server
    ├── test-db.sh                       Database tests on a throwaway database
    ├── check-supabase.mjs               Supabase connectivity check
    ├── live-check.mjs                   Provider live check (manual workflow)
    └── verify-foundation.sh             Structure + secret-hygiene check
```

Each folder's purpose is described in [`docs/README.md`](docs/README.md).

---

## Setup

Requirements: **Node.js 22 or newer** (`node -v`). Nothing else — there are no npm packages
to install (see `docs/DECISIONS.md` D-003). On Windows, run the commands from Git Bash so
`npm run verify` (a shell script) works.

```bash
npm run dev      # start the site at http://127.0.0.1:5173
npm test         # unit tests (router, config guard, dev server, frontend security)
npm run verify   # structure + credential scan
npm run check    # verify + test — run before every commit
npm run test:db  # database schema tests (needs PostgreSQL + PGHOST/PGUSER/PGPASSWORD)
```

`npm run dev` uses port 5173; set another with `PORT=8080 npm run dev`.

`npm run check:supabase` confirms the Supabase project in `app-config.js` is reachable and
accepts the publishable key (needs network access to `*.supabase.co`).

### GitHub

**Updating through the GitHub website:** upload the single file `orb-update.zip` (do not
unzip it) to the top level of the repository. The *Apply update package* workflow tests it,
puts every file in its correct folder, removes stray files, and starts the deployments
(D-015). Build a package with `sh scripts/make-update.sh "<title>"`.


* **CI** (`.github/workflows/ci.yml`): `npm run check` and the Supabase connectivity check on
  every push and pull request.
* **Database** (`.github/workflows/database.yml`): when migrations change on `main`, runs
  the unit and database tests, a dry run, then applies them to Supabase. Needs the
  `SUPABASE_DB_URL` repository secret (Settings → Secrets and variables → Actions) — the
  Supabase *Session pooler* connection string. The password lives only in GitHub Secrets.
* **Edge Functions** (`.github/workflows/functions.yml`): after `npm run check`, deploys the
  `market-data` function. Needs the `SUPABASE_ACCESS_TOKEN` repository secret (a Supabase
  personal access token). The Twelve Data key is set only in Supabase (Edge Functions →
  Secrets → `TWELVE_DATA_API_KEY`), never in GitHub.
* **Provider live check** (`.github/workflows/live-check.yml`, manual): 5 paced calls to the
  deployed function; report in the run summary. Needs the `SUPABASE_SECRET_KEY` repository
  secret (a Supabase secret key).
* **Pages** (`.github/workflows/pages.yml`): after checks pass, `frontend/` is published to
  GitHub Pages on every push to `main`. One-time setup: Settings → Pages → Source:
  **GitHub Actions**.

### Configuration

| What | Where | Committed? |
|------|-------|-----------|
| Supabase URL + anon/publishable key (public) | `frontend/js/app-config.js` | Yes — public by design |
| Provider API keys (Twelve Data, …) | Supabase Edge Function secrets; locally `supabase/functions/.env` (template: `.env.example`) | **Never** |
| Provider plan | `supabase/functions/_shared/market-data/config.js` | Yes — not secret |
| Supabase service-role / secret key | Supabase only | **Never** |

The app validates `app-config.js` at start-up and refuses to connect if it finds a
service-role key, a secret key or any extra field.

---

## Verifying the repository

`npm run check` must pass. `verify-foundation.sh` checks that every specification file and
folder exists, that `.gitignore` excludes secret files, and that no file looks like it contains
a credential. The unit tests check routing, the configuration guard, the dev server
(including path-traversal protection) and that the frontend has no secrets, direct provider
calls, browser-storage databases or third-party scripts.
