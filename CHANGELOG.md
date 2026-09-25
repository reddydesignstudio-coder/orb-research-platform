# CHANGELOG

## Supabase + GitHub setup — 2026-09-25

Added

* Supabase project URL and publishable key in `frontend/js/app-config.js` (public values).
* `scripts/check-supabase.mjs` / `npm run check:supabase` — connectivity check using public values.
* `.github/workflows/ci.yml` — checks on every push/PR.
* `.github/workflows/pages.yml` — deploy `frontend/` to GitHub Pages after checks pass.
* Decisions D-007, D-008. SR-18 resolved.

## TASK 002 — Development Environment — 2026-09-25

Added

* `package.json` — npm scripts `dev`, `test`, `verify`, `check`; no dependencies; Node ≥ 22.
  `.nvmrc`.
* Frontend shell (`frontend/`): responsive layout (phone tab bar, sidebar from 900px),
  seven sections from PROJECT.md §16 as "Not built yet" pages, hash router, not-found page,
  research disclaimer footer, light/dark theme, Content-Security-Policy, `.nojekyll`.
* Public config guard (`frontend/js/config.js`) — rejects service-role/secret keys and any
  extra field; UI shows an error banner.
* `scripts/serve.mjs` — zero-dependency local dev server bound to 127.0.0.1.
* Tests (27, `node:test`): router, routes, config guard, dev server, frontend security.
* `supabase/functions/.env.example` — variable names only.
* Decisions D-003 to D-006; spec review SR-16 to SR-18.

Not changed

* No methodology, database or architecture changes. No dependencies.

## TASK 001 — Repository Foundation — 2026-09-25

Added

* Specification at repository root: `CLAUDE.md`, `PROJECT.md`, `INSTRUCTIONS.md`, `RULES.md`,
  `ARCHITECTURE.md`, `DATABASE.md`, `ORB_SPEC.md`, `RELATIONSHIPS.md`, `ROADMAP.md`, `TASKS.md`
  (copied verbatim from the Claude Project).
* `PROVIDERS.md` — provisional; the uploaded version duplicated `RELATIONSHIPS.md` (SR-01).
* `README.md`, `CHANGELOG.md`.
* `docs/README.md`, `docs/SPEC_REVIEW.md` (15 findings), `docs/DECISIONS.md` (D-001, D-002).
* Folder skeleton: `frontend/`, `supabase/migrations/`, `supabase/functions/`, `tests/`, `scripts/`.
* `.gitignore` (secrets, Supabase local state, build output), `.editorconfig`, `.gitattributes`.
* `scripts/verify-foundation.sh` — structure and credential-hygiene check (POSIX sh).

Not changed

* No methodology, architecture or database design changes.
* No dependencies added.
