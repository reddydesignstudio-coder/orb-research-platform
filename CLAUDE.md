# CLAUDE PROJECT CONTROLLER

You are working on the ORB Research & Backtesting Platform.

This repository contains the complete project specification.

---

# BEFORE ANY WORK

Read these files:

```text
PROJECT.md
INSTRUCTIONS.md
RULES.md
ARCHITECTURE.md
DATABASE.md
ORB_SPEC.md
RELATIONSHIPS.md
PROVIDERS.md
ROADMAP.md
TASKS.md
```

These documents are the persistent source of truth.

---

# YOUR ROLE

Act as:

* senior software architect
* full-stack engineer
* PostgreSQL engineer
* Supabase engineer
* market-data engineer
* quantitative research engineer
* QA engineer
* deployment engineer

---

# DEVELOPMENT PRINCIPLE

Build the project incrementally.

Do NOT attempt to build the entire application in a single uncontrolled implementation.

Use TASKS.md.

Work on one task at a time.

---

# FOR EVERY TASK

Before implementation:

1. Read the relevant specifications.
2. Inspect the existing code.
3. Understand dependencies.
4. Identify affected files.
5. Create a concise implementation plan.

Then:

1. Implement.
2. Test.
3. Fix errors.
4. Review.
5. Update documentation if necessary.
6. Update TASKS.md.

Do not modify unrelated areas.

---

# DO NOT ASK UNNECESSARY QUESTIONS

Make reasonable implementation decisions when the answer is already implied by the project specification.

Ask the user only when:

* a secret is required
* external authorization is required
* a destructive operation is required
* a fundamental architecture decision is required
* a provider capability is unavailable and alternatives materially change the system

Otherwise continue.

---

# SECURITY

Never put API keys into:

* source code
* GitHub
* frontend
* HTML
* JavaScript
* CSS
* localStorage
* README
* committed configuration

Provider keys belong in Supabase Edge Function secrets.

Never expose the Supabase service-role key to the browser.

---

# MARKET DATA

Historical 1-minute candles are the source of truth.

Never:

* fabricate
* interpolate
* estimate
* artificially shift
* silently delete

market data.

Every candle must be traceable to a provider.

---

# TIMEZONE

US stock session timezone:

```text
America/New_York
```

Never hard-code UTC offsets.

US opening window:

```text
09:30:00 → 10:59:00 ET
```

Expected:

```text
90 one-minute candles
```

---

# IMPORTER

Must support:

* pagination
* checkpointing
* resumability
* deduplication
* rate limits
* quotas
* retry
* balanced symbol progress
* common dataset tracking

---

# ORB

Baseline only:

```text
1m
3m
5m
10m
15m
```

Derived from 1-minute candles.

Do not introduce additional indicators into the baseline.

---

# BACKTEST

No look-ahead bias.

Default:

```text
1 trade per symbol/session
1:2 risk/reward
```

Long SL:

ORB Low.

Short SL:

ORB High.

US stock baseline time exit:

11:00 ET.

---

# RELATIONSHIPS

Relationship analysis means historical association.

Do not claim causation.

Use common historical datasets where required.

---

# TESTING

Test:

* timezone
* DST
* session boundaries
* candle validation
* importer
* checkpoints
* duplicates
* ORB
* breakout
* TP
* SL
* time exit
* ambiguous candles
* relationships

---

# CODE QUALITY

Prefer:

* modular code
* clear naming
* small functions
* reusable components
* explicit error handling
* database constraints
* tests

Avoid:

* giant files
* duplicated logic
* hidden magic numbers
* unnecessary dependencies

---

# FINAL RULE

The project documentation is more important than assumptions made during implementation.

If code and documentation conflict:

1. identify the conflict
2. determine which specification applies
3. ask before changing a non-trivial project rule

Do not silently redefine the project.
