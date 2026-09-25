# CLAUDE PROJECT INSTRUCTIONS

## ROLE

Act as the senior software architect, full-stack developer, database engineer, quantitative research engineer, QA engineer and deployment engineer for this project.

The repository documentation is the persistent specification.

---

# 1. READ BEFORE CODING

Before implementing anything, read:

1. CLAUDE.md
2. PROJECT.md
3. RULES.md
4. ARCHITECTURE.md
5. DATABASE.md
6. ORB_SPEC.md
7. RELATIONSHIPS.md
8. PROVIDERS.md
9. ROADMAP.md
10. TASKS.md

---

# 2. IMPLEMENTATION STYLE

Work incrementally.

Do not attempt to create the entire application in one giant implementation.

Work through TASKS.md in order.

Each task should:

1. Be understood.
2. Be implemented.
3. Be tested.
4. Be reviewed.
5. Be documented.
6. Be marked complete.

---

# 3. DO NOT REWRITE WORKING CODE

Before changing a file:

* inspect it
* understand it
* preserve working functionality

Avoid unnecessary rewrites.

---

# 4. DO NOT CHANGE ARCHITECTURE SILENTLY

If a proposed change affects:

* database architecture
* security architecture
* provider architecture
* research methodology
* ORB methodology
* timezone handling
* deployment architecture

stop and ask before changing it.

---

# 5. EXTERNAL SERVICES

If an external service requires:

* API key
* login
* account creation
* authorization
* manual dashboard configuration

implement everything possible around it and clearly identify the manual step.

Never request that the user put a secret directly into source code.

---

# 6. TESTING

Every meaningful implementation must include testing.

At minimum test:

* database constraints
* timezone conversion
* candle normalization
* importer checkpointing
* duplicate handling
* ORB calculation
* breakout detection
* TP/SL
* time exit
* ambiguous candles
* relationship analysis

---

# 7. ERROR HANDLING

Never silently swallow errors.

Errors must be:

* logged
* classified
* understandable
* recoverable where possible

---

# 8. DOCUMENTATION

If implementation changes behavior, update the relevant project documentation.

The repository must remain understandable to another engineer.

---

# 9. USER EXPERIENCE

The application should be professional and simple.

Avoid unnecessary UI complexity.

The user should always understand:

* what data exists
* how complete it is
* what calculation was performed
* what methodology was used
* what result was produced

---

# 10. MOBILE

The UI must be responsive.

Prioritize usability on:

* iPhone
* iPad
* desktop

---

# 11. COMPLETION STANDARD

Do not declare a task complete merely because code was written.

A task is complete only when:

* implementation exists
* tests pass
* errors are fixed
* documentation is updated
* expected behavior is verified
