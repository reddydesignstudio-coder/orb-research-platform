# SPECIFICATION REVIEW

Findings from the full read of the specification during TASK 001.

This file **does not change** any rule, methodology or architecture. It records conflicts,
gaps and open questions so each one is resolved explicitly — by the project owner — before
the task that depends on it. Per `CLAUDE.md` (FINAL RULE), non-trivial rules are not
redefined silently.

Status values: `OPEN` (needs an owner decision), `NOTED` (informational, no decision needed),
`RESOLVED` (decision recorded in `docs/DECISIONS.md`).

---

## Summary

| ID | Topic | Blocks | Status |
|----|-------|--------|--------|
| SR-01 | `PROVIDERS.md` content is a copy of `RELATIONSHIPS.md` | TASK 005 | OPEN |
| SR-02 | `PROJECT.md` / `INSTRUCTIONS.md` were not uploaded as files | — | NOTED |
| SR-03 | ROADMAP phase numbering differs from TASKS phase numbering | — | NOTED |
| SR-04 | Index named `relationships(...)`; table is `orb_relationships` | TASK 003 | RESOLVED (D-009) |
| SR-05 | `data_quality` has no field for OHLC validity / timestamp correctness | TASK 003, 014 | RESOLVED (D-009) |
| SR-06 | `trades` has no exit reason (TP / SL / time exit / ambiguous) | TASK 003, 019 | RESOLVED (D-009) |
| SR-07 | `candles.timestamp_et` for non-US markets | TASK 003 | RESOLVED (D-009) |
| SR-08 | Initial 15 symbols not named | TASK 004 | RESOLVED (D-014) |
| SR-09 | Sessions for forex, crypto and gold are not defined | TASK 004, 013, 016 | RESOLVED — 09:30–11:00 America/New_York for all (D-025) |
| SR-10 | US market holiday calendar source not specified | TASK 013 | OPEN |
| SR-11 | Breakout trigger and entry-price convention | TASK 017, 019 | OPEN |
| SR-12 | Candle that breaks both ORB High and ORB Low | TASK 017 | OPEN |
| SR-13 | Time-exit price at 11:00 ET | TASK 019 | OPEN |
| SR-14 | Access control for Admin / GET DATA | TASK 007, 015 | OPEN |
| SR-15 | Twelve Data plan limits and API key (manual step) | TASK 006, 007, 012 | RESOLVED — Basic plan verified (D-019), key in Edge Function secrets (D-020), budget enforced (D-027) |
| SR-16 | Where shared calculation code lives (browser + Edge Functions) | TASK 005, 013, 016 | OPEN |
| SR-17 | No task explicitly builds the Dashboard, Data and Settings pages | TASK 015, 021 | OPEN |
| SR-18 | GitHub Pages cannot publish from `frontend/` directly | TASK 029 | RESOLVED (D-007) |
| SR-19 | `orb_relationships` has no ORB period column | TASK 022 | OPEN |
| SR-20 | Free-plan storage: ~850 MB/year of candles vs 500 MB | TASK 008 | OPEN |

---

## Details

### SR-01 — `PROVIDERS.md` content is a copy of `RELATIONSHIPS.md`  — OPEN

The `Providers` document in the Claude Project is byte-for-byte identical to `Relationships`.
The real provider specification is therefore missing.

Action taken in TASK 001: `PROVIDERS.md` was created as a **provisional** file that only
collects provider requirements already stated elsewhere (each line cites its source). No new
provider behaviour was invented.

Needed: the original `PROVIDERS.md`. Required before TASK 005.

### SR-02 — `PROJECT.md` / `INSTRUCTIONS.md` not uploaded as files  — NOTED

`CLAUDE.md` lists both. Their content exists as the Claude Project description and the Claude
Project instructions. Both were copied verbatim into the repository.

### SR-03 — Phase numbering  — NOTED

`ROADMAP.md` uses phases 0–11 (e.g. Phase 2 = Symbols); `TASKS.md` uses phases 0–9
(e.g. Phase 2 = Provider). Content is consistent; only numbering differs. `TASKS.md` governs
the order of work (INSTRUCTIONS.md §2).

### SR-04 — Relationship index name  — RESOLVED (D-009)

`DATABASE.md` → INDEXES lists `relationships(reference_symbol_id, target_symbol_id, session_date)`.
The only such table is `orb_relationships`. Proposed reading: the index belongs on
`orb_relationships`. Confirm at TASK 003.

### SR-05 — Recording OHLC validity and timestamp correctness  — RESOLVED (D-009)

`PROJECT.md` §9 requires validating OHLC validity and timestamp correctness per session.
The `data_quality` table has no column for either result. Options: add columns
(e.g. `invalid_ohlc_candles`, `invalid_timestamp_candles`) or encode them in `status`.
Adding columns changes the database design, so it needs approval.

### SR-06 — Trade exit reason  — RESOLVED (D-009)

`trades` has `result` and `r_multiple` but no exit reason. The backtest must report average
time to TP and average time to SL, and the ambiguous-candle convention (default LOSS) should
be visible, not hidden. An `exit_reason` column (`TP`, `SL`, `TIME`, `AMBIGUOUS_SL`) would make
this explicit. Database change → needs approval.

Related: `trades` has no `created_at`, unlike other tables.

### SR-07 — `candles.timestamp_et` for non-US markets  — RESOLVED (D-009)

Storing an ET timestamp is natural for US stocks. For forex, crypto and gold the relevant
session timezone may differ (`symbols.session_timezone`). Options: keep `timestamp_et` for all
symbols as a convenience column derived from `timestamp_utc` by the timezone database, or
make it a generated column. `timestamp_utc` remains the canonical value in all options.

### SR-08 — Initial universe  — RESOLVED (D-014)

The spec fixes the counts (8 US stocks, 4 forex, 2 crypto, 1 XAUUSD) but not the tickers.
`RELATIONSHIPS.md` uses SPY, AAPL, NVDA, MSFT, AMD as examples. Needed: the 15 symbols
(and their Twelve Data symbols). Required for TASK 004.

### SR-09 — Non-US sessions  — RESOLVED 2026-09-26 (D-025)

Resolution: the owner chose one research window for every market — 09:30 → 11:00
America/New_York, 90 candles, crypto every day. Only candles inside it are stored. Time exit
and closed-session rules for non-US markets remain to be settled with SR-13 and TASK 013/014.

Original finding:

Only the US stock session is defined (America/New_York, 09:30–10:59, 90 candles, time exit
11:00). For forex, crypto and XAUUSD the spec does not define: session timezone, ORB anchor
time, window length, time exit, or what counts as a closed market. The `symbols` table
already carries `session_timezone`, `session_start`, `session_end`, so this is configuration —
but the values are a methodology decision. Required before these markets are validated or
backtested.

### SR-10 — US market holiday calendar  — OPEN

"Weekends and market holidays are not missing data." The source of the NYSE holiday and
early-close calendar is not specified (static maintained table vs. a library vs. a provider
endpoint). Early-close days (13:00 ET) do not affect the 09:30–10:59 window, but full-day
holidays do.

### SR-11 — Breakout trigger and entry price  — OPEN

`ORB_SPEC.md`: "First valid 1-minute breakout. The entry convention must be deterministic and
documented. No look-ahead." Not yet defined:

* trigger — 1-minute candle **high/low trades through** the level, or candle **closes** beyond it;
* strictness — strictly greater than ORB High, or greater-or-equal;
* entry price — the ORB level (stop-order fill), the breakout candle close, or the next candle open;
* first eligible candle — the candle immediately after the ORB period.

Each option is look-ahead-safe if applied consistently, but they produce different results,
so the choice is a methodology decision.

### SR-12 — Candle that breaks both sides  — OPEN

A single 1-minute candle can exceed ORB High and ORB Low. The spec has a conservative rule for
TP/SL ambiguity, but not for a double-sided breakout. Options: no trade for that session, or
a documented conservative rule.

### SR-13 — Time-exit price  — OPEN

Time exit is 11:00 ET, and 11:00 is excluded from the opening-window dataset. Exit price
options: close of the 10:59 candle (inside the window), or open of the 11:00 candle
(outside the window, requires importing it).

### SR-14 — Access control for Admin / GET DATA  — OPEN

The Supabase anon key is public by design. Without authentication, anyone who finds the site
could trigger GET DATA and consume the provider quota, or call Edge Functions that write with
service-role privileges. `ARCHITECTURE.md` §3 says "authentication if needed". Proposed:
Supabase Auth for Admin actions plus RLS read-only access for research pages. Security
architecture → needs approval before TASK 007.

### SR-15 — Twelve Data plan and key  — RESOLVED 2026-09-26 (D-019, D-020, D-027)

Rate-limit and history depth depend on the Twelve Data plan. The API key must be added by the
owner as a Supabase Edge Function secret (never in the repo). Required before TASK 006 can be
tested against the live API; adapter code can be written and tested against fixtures before that.

### SR-16 — Location of shared calculation code  — OPEN (added in TASK 002)

The spec does not say where timezone, session, ORB and backtest calculations run: in Edge
Functions, in PostgreSQL, or in the browser. Whichever it is, one implementation should be
used everywhere so results cannot differ between screens. Supabase's documented convention is
`supabase/functions/_shared/`. Plain ES modules there run in Deno and in Node tests. Using
them in the browser as well depends on how the site is published (SR-18). Decide before the
first calculation module (TASK 005 or 013).

### SR-17 — Pages without a dedicated task  — OPEN (added in TASK 002)

PROJECT.md §16 lists seven sections. TASKS.md has explicit UI tasks for Admin (015),
Backtest (021) and Relationships (024). The Dashboard, Data and Settings pages have no task
of their own, and ORB Research has engine tasks (016–018) but no UI task. The frontend
placeholders cite the closest related tasks. Proposed: fold Data into TASK 015, Dashboard into
TASK 021, and add Settings and ORB Research UI to the relevant tasks — or add new tasks.

### SR-18 — GitHub Pages publishing source  — RESOLVED by D-007

GitHub Pages "deploy from a branch" publishes only the repository root or `/docs`. This repo
keeps the site in `frontend/` (and `/docs` holds engineering notes). Options: a GitHub Actions
workflow that publishes `frontend/` as the Pages artifact (recommended; standard, keeps
layout), or moving the site. Deployment architecture → confirm at TASK 029 or earlier if a
preview deployment is wanted.

### SR-19 — ORB period in relationship rows  — OPEN (added in TASK 003)

`orb_relationships` (DATABASE.md) has no `orb_minutes` column, so a 5-minute and a 15-minute
relationship for the same pair and day cannot be told apart. Proposed: add `orb_minutes`
(1/3/5/10/15) and include it in the index — an additive, non-destructive migration at TASK 022.
Not added in TASK 003 because it changes the specified table.

### SR-20 — Storage on the free plan  — OPEN (added in TASK 003)

Measured: ~230 bytes per candle including indexes. The 15-symbol universe produces about
3.7 million 1-minute candles per year of history (24-hour forex/crypto dominate), about
850 MB/year. The free plan's 500 MB holds roughly 7 months. Options before large imports:
upgrade to Pro (8 GB included), limit history depth, or import only session windows for
US stocks (saves ~15%). Decide before the importer runs at scale (TASK 008–012).

