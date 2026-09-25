# ORB Research & Backtesting Platform

A web-based **historical research and backtesting** platform for Opening Range Breakout (ORB)
strategies across US stocks, forex, crypto and gold (XAUUSD).

This is a research tool. It is not a live trading application, and historical results are
never presented as a guarantee of future performance.

> **Status:** Phase 0 — Foundation. No application code exists yet.
> See [`TASKS.md`](TASKS.md) for current progress.

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
├── frontend/                            GitHub Pages frontend        (TASK 002+)
├── supabase/
│   ├── migrations/                      PostgreSQL schema migrations (TASK 003+)
│   └── functions/                       Supabase Edge Functions      (TASK 007+)
├── tests/                               Automated tests              (TASK 002+)
└── scripts/
    └── verify-foundation.sh             Structure + secret-hygiene check
```

Each folder's purpose is described in [`docs/README.md`](docs/README.md).

---

## Verifying the repository

```bash
sh scripts/verify-foundation.sh
```

The script needs only a POSIX shell. It checks that every specification file and folder
exists, that `.gitignore` excludes secret files, and that no tracked file looks like it
contains a credential. It exits non-zero on any failure.

---

## Setup

Development setup (package configuration, scripts, local Supabase) arrives in **TASK 002**.
Nothing needs to be installed yet.
