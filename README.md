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
| 9 | [`PROVIDERS.md`](PROVIDERS.md) | Market-data providers — **provisional**, see `docs/SPEC_REVIEW.md` |
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
│   ├── migrations/                      PostgreSQL schema migrations (TASK 003+)
│   └── functions/                       Supabase Edge Functions      (TASK 007+)
├── tests/                               node:test unit tests
└── scripts/
    ├── serve.mjs                        Local dev server
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
```

`npm run dev` uses port 5173; set another with `PORT=8080 npm run dev`.

### Configuration

| What | Where | Committed? |
|------|-------|-----------|
| Supabase URL + anon/publishable key (public) | `frontend/js/app-config.js` | Yes — public by design |
| Provider API keys (Twelve Data, …) | Supabase Edge Function secrets; locally `supabase/functions/.env` (template: `.env.example`) | **Never** |
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
