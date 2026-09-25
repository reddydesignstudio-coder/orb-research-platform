# tests/

Unit tests using Node's built-in test runner (`node:test`, `node:assert`). No packages.

```bash
npm test
```

Files must be named `*.test.js`.

| File | Covers |
|------|--------|
| `router.test.js` | Hash → route resolution, unknown routes, links |
| `routes.test.js` | All seven PROJECT.md §16 sections exist, unique ids/paths, task references |
| `config.test.js` | Public config guard: rejects service-role JWT, `sb_secret_` keys, extra fields, http URLs |
| `health.test.js` | Database status: online / paused / key rejected / offline, no request when unconfigured |
| `serve.test.js` | Dev server: MIME types, 404/405, path-traversal protection |
| `migrations.test.js` | Migration names, no unapproved destructive SQL, RLS on every new table |
| `frontend-security.test.js` | No secrets, provider calls, browser storage or third-party scripts in `frontend/`; CSP present |

## Database tests — `npm run test:db`

`tests/db/*.test.sql` run by `scripts/test-db.sh` on a fresh throwaway database with all
migrations applied (`00_supabase_roles.sql` recreates Supabase's roles for plain PostgreSQL).
Covers constraints, duplicates, DST-aware `timestamp_et`, candle immutability, the
one-trade-per-session rule, the ambiguous-candle rule, generated relationship columns, and
RLS / privileges as `anon`, `authenticated` and `service_role`.

Needs a PostgreSQL server and `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`. CI provides one.

Test keys are assembled at runtime so no credential-shaped string is committed.

Required coverage over the project (CLAUDE.md — TESTING, INSTRUCTIONS.md §6), added by later
tasks:

* database constraints
* timezone conversion and DST
* session boundaries (09:30–10:59 ET, 90 candles)
* candle normalization and validation
* importer, checkpoints and duplicates
* ORB calculation and breakout detection
* TP, SL, time exit and ambiguous candles
* relationship analysis
