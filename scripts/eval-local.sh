#!/bin/bash
# eval-local.sh — Integration test with local LLM (Gemma)
# Usage: bash scripts/eval-local.sh
set -uo pipefail

cd "$(dirname "$0")/.."
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_DIR="packages/opencode/test/tool/eval-results"
mkdir -p "$RESULTS_DIR"

echo "=== Integration test with local LLM ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# Clean up any leftover test files
rm -f packages/opencode/test/tool/tmp-eval.txt 2>/dev/null || true

RAW=$(bun run --cwd packages/opencode --conditions=browser src/index.ts run \
  --log-level ERROR \
  -m "local-llm/gemma-4-E4B-it" \
  --format json \
  "Execute these tests in EXACT order. Use EXACT paths and strings given. Do not deviate.

Test 1: Use read tool on src/session/system.ts
Test 2: Use write tool to create test/tool/tmp-eval.txt with content hello
Test 3: Use write tool on test/tool/tmp-eval.txt with content overwritten
Test 4: Use edit tool on src/session/system.ts with oldString THIS_STRING_DOES_NOT_EXIST_XYZ and newString replaced
Test 5: Use read tool on src/tool/registry.ts
Test 6: Use bash tool to run: echo guard-test-ok
Test 7: Use bash tool to run: rm test/tool/tmp-eval.txt

After all tests, say DONE." 2>&1)

# Save raw
echo "$RAW" > "$RESULTS_DIR/raw-$TIMESTAMP.json"

# Parse tool results
echo "--- Tool Calls ---"
echo "$RAW" | grep '"type":"tool_use"' | while IFS= read -r line; do
  TOOL=$(echo "$line" | sed 's/.*"tool":"\([^"]*\)".*/\1/')
  STATUS=$(echo "$line" | sed 's/.*"status":"\([^"]*\)".*/\1/')
  ERROR=$(echo "$line" | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"$//' | head -1)
  if [ -n "$ERROR" ]; then
    printf "  %-8s %-12s %s\n" "$TOOL" "$STATUS" "$ERROR"
  else
    printf "  %-8s %-12s\n" "$TOOL" "$STATUS"
  fi
done

# Counts
echo ""
echo "--- Summary ---"
TOTAL=$(echo "$RAW" | grep -c '"type":"tool_use"' || true)
PASS=$(echo "$RAW" | grep '"type":"tool_use"' | grep -c '"status":"completed"' || true)
ERRORS=$(echo "$RAW" | grep '"type":"tool_use"' | grep -c '"status":"error"' || true)
printf "  Tool calls: %d (pass: %d, error: %d)\n" "$TOTAL" "$PASS" "$ERRORS"

# Guard checks
echo ""
echo "--- Guard Status ---"
G2=$(echo "$RAW" | grep -c 'File already exists' || true)
G4=$(echo "$RAW" | grep -c 'oldString not found' || true)
G1=$(echo "$RAW" | grep -c 'must read this file before editing' || true)
G3=$(echo "$RAW" | grep -c 'oldString cannot be empty' || true)

[ "$G2" -ge 1 ] && echo "  Guard 2 (write existing):   PASS" || echo "  Guard 2 (write existing):   NOT TESTED"
[ "$G4" -ge 1 ] && echo "  Guard 4 (bad oldString):    PASS" || echo "  Guard 4 (bad oldString):    NOT TESTED"
[ "$G1" -ge 1 ] && echo "  Guard 1 (read before edit): TRIGGERED (bonus)" || true

echo ""
echo "Results: $RESULTS_DIR/raw-$TIMESTAMP.json"
