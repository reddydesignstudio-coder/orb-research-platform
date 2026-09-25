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
| `check-db-url.test.js` | SUPABASE_DB_URL format check: placeholder, brackets, whitespace, special chars, wrong host/port/user — without printing the password |
| `migrations.test.js` | Migration names, no unapproved destructive SQL, RLS on every new table |
| `providers/*.test.js` | Provider layer (TASK 005): candle normalization, capabilities, error classification, range completeness, registry, provider neutrality, and the shared contract |
| `adapters/twelve-data.test.js` | Twelve Data adapter (TASK 006): request parameters, key only in the header, UTC/DST, raw prices, missing volume, boundary bar, full page, error mapping and waits, shared contract |
| `market-data/handler.test.js` | market-data function (TASK 007): secret-key-only access, input checks, symbol lookup, configured provider only, provider errors → HTTP, no key in responses or logs |
| `live-check.test.js` | Live-check helpers: New York session → UTC across DST, probe list, report |
| `frontend-security.test.js` | No secrets, provider calls, browser storage or third-party scripts in `frontend/`; CSP present |

## Provider contract — `tests/providers/provider-contract.js`

`checkProviderContract({ provider, symbolConfig, scenarios, secrets })` returns a list of
violations of PROVIDERS.md. Every adapter's own test file runs it on recorded or synthetic
fixtures and asserts the list is empty. `tests/providers/fixtures/` holds a synthetic,
fixture-driven fake provider (an invented format, not any real provider) and deliberately
broken variants that prove the checker catches violations. No test calls a live provider.

## Database tests — `npm run test:db`

`tests/db/*.test.sql` (with shared helpers in `tests/db/_helpers.sql`) run by `scripts/test-db.sh` on a fresh throwaway database with all
migrations applied (`00_supabase_roles.sql` recreates Supabase's roles for plain PostgreSQL).
`05_universe.test.sql` checks the seeded 15-symbol universe; `10_schema.test.sql` covers constraints, duplicates, DST-aware `timestamp_et`, candle immutability, the
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
