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
