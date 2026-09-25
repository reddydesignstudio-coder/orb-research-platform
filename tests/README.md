# tests/

Automated tests. The test runner is chosen in **TASK 002**.

Required coverage over the project (CLAUDE.md — TESTING, INSTRUCTIONS.md §6):

* database constraints
* timezone conversion and DST
* session boundaries (09:30–10:59 ET, 90 candles)
* candle normalization and validation
* importer, checkpoints and duplicates
* ORB calculation and breakout detection
* TP, SL, time exit and ambiguous candles
* relationship analysis

Foundation checks for TASK 001 live in `scripts/verify-foundation.sh`.
