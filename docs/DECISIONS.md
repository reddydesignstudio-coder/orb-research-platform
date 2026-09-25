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
