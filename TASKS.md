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
IMPLEMENTED — awaiting first production apply
```

Delivered: `supabase/migrations/20260925120000_initial_schema.sql` (9 tables, constraints,
indexes, triggers, RLS), `supabase/config.toml`, 75 database checks (`npm run test:db`),
migration guard test, CI database job, automatic deploy workflow. Decisions D-009 – D-013.

Verified: all database checks pass on PostgreSQL 16 locally; `supabase db push` (CLI
2.117.0) tested against a stand-in database — dry run, apply, and idempotent re-run.
CI repeats the tests on PostgreSQL 17 (Supabase's version).

To mark COMPLETE: owner adds the `SUPABASE_DB_URL` secret and "Deploy database migrations"
succeeds against the real project.

---

### TASK 004 — Seed Symbols

Create initial 15-symbol configurable seed universe.

Status:

```text
TODO
```

---

## PHASE 2 — PROVIDER

### TASK 005 — Provider Interface

Create market-data provider abstraction.

Status:

```text
TODO
```

---

### TASK 006 — Twelve Data Adapter

Implement historical 1-minute candle retrieval.

Status:

```text
TODO
```

---

### TASK 007 — Supabase Market Data Function

Create secure Edge Function for provider access.

Status:

```text
TODO
```

---

## PHASE 3 — IMPORTER

### TASK 008 — Import Job Engine

Implement import jobs and run IDs.

Status:

```text
TODO
```

---

### TASK 009 — Checkpointing

Implement resumable imports.

Status:

```text
TODO
```

---

### TASK 010 — Deduplication

Implement database/application duplicate prevention.

Status:

```text
TODO
```

---

### TASK 011 — Balanced Import

Implement fair progress across enabled symbols.

Status:

```text
TODO
```

---

### TASK 012 — Rate Limit Handling

Implement quota/rate-limit handling and retry scheduling.

Status:

```text
TODO
```

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
