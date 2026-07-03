#!/usr/bin/env bash
# cas_run_comparison.sh
# ---------------------
# One-shot: run both parsers on a CAS PDF, then diff the results.
#
# Usage (from project root):
#   bash tools/cas_run_comparison.sh <cas.pdf> <password>
#
# Output:
#   cas_method_a.json  ← existing Node.js parser
#   cas_method_b.json  ← casparser Python library
#   (diff printed to console)

set -e

PDF="${1:-}"
PASS="${2:-}"

if [[ -z "$PDF" || -z "$PASS" ]]; then
  echo "Usage: bash tools/cas_run_comparison.sh <cas.pdf> <password>"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  CAS Parser Comparison"
echo "  PDF  : $PDF"
echo "  PASS : $(echo "$PASS" | sed 's/./*/g')"
echo "═══════════════════════════════════════════════════"
echo ""

# Method A — existing Node.js parser
echo "▶ Running Method A (existing parser)…"
node tools/cas_compare_existing.mjs "$PDF" "$PASS" cas_method_a.json
echo ""

# Method B — casparser Python library
echo "▶ Running Method B (casparser)…"
python3 tools/cas_compare_casparser.py "$PDF" "$PASS" cas_method_b.json
echo ""

# Diff
echo "▶ Comparing outputs…"
echo ""
python3 tools/cas_diff.py cas_method_a.json cas_method_b.json
