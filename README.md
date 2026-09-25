# Engineering Documentation

The **specification** is at the repository root (see the root `README.md`).
This folder holds engineering notes that support it.

| File | Purpose |
|------|---------|
| [`SPEC_REVIEW.md`](SPEC_REVIEW.md) | Conflicts, gaps and open questions found in the spec, with the task each one blocks |
| [`DECISIONS.md`](DECISIONS.md) | Log of decisions that interpret or extend the spec |

---

## Folder purposes

| Folder | Purpose | First task |
|--------|---------|-----------|
| `frontend/` | Static GitHub Pages site: Dashboard, Data, Admin, ORB Research, Backtest, Relationships, Settings. Uses only the public Supabase URL and anon key. | TASK 002 |
| `supabase/migrations/` | Ordered PostgreSQL migrations: tables, constraints, indexes, RLS. The database is the source of truth. | TASK 003 |
| `supabase/functions/` | Supabase Edge Functions. The only place provider API keys are used (read from Edge Function secrets). | TASK 007 |
| `tests/` | Automated tests (timezone/DST, sessions, candles, importer, ORB, TP/SL, relationships). | TASK 002 |
| `scripts/` | Repository and development scripts. | TASK 001 |
| `docs/` | Engineering notes (this folder). | TASK 001 |

## Rules for adding documentation

* If an implementation changes behaviour, update the relevant root spec file **and** add an
  entry to `DECISIONS.md` if it interprets or extends the spec.
* Never put secrets, keys or example keys that look real in any document.
