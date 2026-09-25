# CHANGELOG

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
