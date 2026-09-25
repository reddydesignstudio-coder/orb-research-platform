#!/bin/sh
# ------------------------------------------------------------------
# test-db.sh — database tests against a throwaway PostgreSQL database.
#
#   npm run test:db
#
# Needs a PostgreSQL server (17 recommended, matching Supabase) and the
# standard libpq variables: PGHOST, PGPORT, PGUSER, PGPASSWORD.
# In GitHub Actions a postgres service container provides this.
#
# Steps: create a fresh database → Supabase role bootstrap (test-only) →
# every migration in order → test helpers → every tests/db/*.test.sql (in
# file-name order) → drop the database.
# This NEVER touches the real Supabase project.
# ------------------------------------------------------------------
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

command -v psql >/dev/null 2>&1 || { echo "FAIL psql not found — install the PostgreSQL client" >&2; exit 1; }

DB="orb_test_$$"
PSQL="psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc"

cleanup() { $PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

VERSION=$(psql -X -tAc 'show server_version' -d postgres) || {
  echo "FAIL cannot connect to PostgreSQL (PGHOST=${PGHOST:-unset} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-unset})" >&2
  exit 1
}
echo "Server: PostgreSQL $VERSION"
$PSQL -d postgres -c "create database $DB"

echo "→ test bootstrap: tests/db/00_supabase_roles.sql"
$PSQL -d "$DB" -f tests/db/00_supabase_roles.sql

count=0
for m in supabase/migrations/*.sql; do
  [ -e "$m" ] || continue
  echo "→ migration: $m"
  $PSQL -d "$DB" -f "$m"
  count=$((count + 1))
done
[ "$count" -gt 0 ] || { echo "FAIL no migrations found" >&2; exit 1; }

echo "→ test helpers: tests/db/_helpers.sql"
$PSQL -d "$DB" -f tests/db/_helpers.sql

LOG=$(mktemp)
trap 'rm -f "$LOG"; cleanup' EXIT INT TERM
for t in tests/db/*.test.sql; do
  echo "→ tests: $t"
  # Query results go to /dev/null; PASS/FAIL notices and errors go to the log.
  # No pipe here: a pipe would hide psql's exit code (POSIX sh has no pipefail).
  if $PSQL -d "$DB" -o /dev/null -f "$t" >"$LOG" 2>&1; then
    sed 's/^psql:[^ ]* NOTICE:  /  /' "$LOG"
  else
    sed 's/^psql:[^ ]* NOTICE:  /  /' "$LOG"
    echo "RESULT: FAIL ($t)" >&2
    exit 1
  fi
done

echo "RESULT: PASS ($count migration(s))"
