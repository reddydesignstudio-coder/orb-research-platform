#!/bin/sh
# ------------------------------------------------------------------
# make-update.sh — build orb-update.zip for the "Apply update package"
# workflow (D-015).
#
#   sh scripts/make-update.sh "<one-line title>" [output-dir]
#
# The package is a full snapshot of the committed project (git HEAD),
# WITHOUT .github/ (GitHub does not let workflows change workflow files).
# It is tested with `npm run check` before it is written.
# ------------------------------------------------------------------
set -eu

TITLE=${1:?usage: make-update.sh "<title>" [output-dir]}
OUT=${2:-.}

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL uncommitted changes — commit first so the package matches a known version." >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

git archive HEAD | tar -x -C "$WORK"
rm -rf "$WORK/.github"
printf '%s\n%s\n' "$TITLE" "source commit: $(git rev-parse --short HEAD)" > "$WORK/UPDATE.txt"

(cd "$WORK" && npm run --silent check >/dev/null) || { echo "FAIL package does not pass npm run check" >&2; exit 1; }

OUT_ABS=$(CDPATH= cd -- "$OUT" && pwd)
rm -f "$OUT_ABS/orb-update.zip"
(cd "$WORK" && zip -qr "$OUT_ABS/orb-update.zip" .)
echo "Wrote $OUT_ABS/orb-update.zip ($(git rev-parse --short HEAD): $TITLE)"
