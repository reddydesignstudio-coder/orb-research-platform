#!/bin/sh
# ------------------------------------------------------------------
# verify-foundation.sh
#
# TASK 001 verification. POSIX sh only — no dependencies.
#
# Checks:
#   1. Every specification file exists and is non-empty.
#   2. The repository folder structure exists.
#   3. .gitignore excludes secret files.
#   4. No file in the repository looks like it contains a credential.
#   5. TASKS.md contains the full 30-task queue.
#   6. PROVIDERS.md is not a copy of RELATIONSHIPS.md (see SR-01).
#
# Exit code: 0 = all checks passed, 1 = at least one failure.
# Warnings are printed but do not fail the run.
# ------------------------------------------------------------------

set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT" || exit 1

FAILURES=0
WARNINGS=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
warn() { printf '  WARN  %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }

# ------------------------------------------------------------------
echo "1. Specification files"
for f in CLAUDE.md PROJECT.md INSTRUCTIONS.md RULES.md ARCHITECTURE.md \
         DATABASE.md ORB_SPEC.md RELATIONSHIPS.md PROVIDERS.md ROADMAP.md \
         TASKS.md README.md CHANGELOG.md docs/README.md docs/SPEC_REVIEW.md \
         docs/DECISIONS.md; do
  if [ -s "$f" ]; then pass "$f"; else fail "$f missing or empty"; fi
done

# ------------------------------------------------------------------
echo "2. Folder structure"
for d in docs frontend supabase supabase/migrations supabase/functions tests scripts; do
  if [ -d "$d" ]; then pass "$d/"; else fail "$d/ missing"; fi
done

# ------------------------------------------------------------------
echo "3. .gitignore secret exclusions"
if [ ! -f .gitignore ]; then
  fail ".gitignore missing"
else
  for p in '.env' '.env.*' 'supabase/.env' 'supabase/functions/.env' 'node_modules/'; do
    if grep -qxF -- "$p" .gitignore; then pass ".gitignore excludes $p"
    else fail ".gitignore does not exclude $p"; fi
  done
fi

# ------------------------------------------------------------------
echo "4. Credential scan"
# Files to scan: tracked + untracked-but-not-ignored when in git, else all files.
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  FILES=$(git ls-files --cached --others --exclude-standard)
else
  FILES=$(find . -type f -not -path './.git/*' | sed 's|^\./||')
fi

# Patterns that indicate a real credential (not the word "key" in prose).
SECRET_PATTERNS='eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}
-----BEGIN [A-Z ]*PRIVATE KEY-----
sk_(live|test)_[A-Za-z0-9]{10,}
(api[_-]?key|apikey|secret|token|password|service[_-]?role[_-]?key)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_/+=-]{16,}'

FOUND=0
SCANNED=0
OLD_IFS=$IFS
IFS='
'
for file in $FILES; do
  [ "$file" = "scripts/verify-foundation.sh" ] && continue  # holds the patterns themselves
  [ -f "$file" ] || continue
  SCANNED=$((SCANNED + 1))
  for pattern in $SECRET_PATTERNS; do
    if grep -Eiq -- "$pattern" "$file"; then
      fail "possible credential in $file (pattern: $pattern)"
      FOUND=$((FOUND + 1))
    fi
  done
done
IFS=$OLD_IFS
if [ "$FOUND" -eq 0 ]; then
  pass "no credential-like strings in $SCANNED files"
fi

for envfile in .env supabase/.env supabase/functions/.env; do
  if printf '%s\n' "$FILES" | grep -qxF -- "$envfile"; then
    fail "$envfile would be committed"
  fi
done

# ------------------------------------------------------------------
echo "5. Task queue"
TASK_COUNT=$(grep -Ec '^### TASK [0-9]{3} ' TASKS.md 2>/dev/null || echo 0)
if [ "$TASK_COUNT" -eq 30 ]; then pass "TASKS.md lists 30 tasks"
else fail "TASKS.md lists $TASK_COUNT tasks (expected 30)"; fi

# ------------------------------------------------------------------
echo "6. PROVIDERS.md integrity"
if cmp -s PROVIDERS.md RELATIONSHIPS.md; then
  fail "PROVIDERS.md is identical to RELATIONSHIPS.md"
else
  pass "PROVIDERS.md differs from RELATIONSHIPS.md"
fi
if grep -q 'STATUS: PROVISIONAL' PROVIDERS.md 2>/dev/null; then
  warn "PROVIDERS.md is provisional — original spec still needed before TASK 005 (SR-01)"
fi

# ------------------------------------------------------------------
echo
if [ "$FAILURES" -eq 0 ]; then
  printf 'RESULT: PASS (%d warning(s))\n' "$WARNINGS"
  exit 0
fi
printf 'RESULT: FAIL (%d failure(s), %d warning(s))\n' "$FAILURES" "$WARNINGS"
exit 1
