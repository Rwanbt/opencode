#!/bin/bash
# test-all.sh — Run all tests: unit + integration
# Usage: bash scripts/test-all.sh
set -uo pipefail

cd "$(dirname "$0")/.."

echo "========================================"
echo "  OpenCode Local LLM Test Suite"
echo "========================================"
echo ""

# Phase 1: Unit tests (fast, no LLM needed)
echo "=== Phase 1: Unit Tests (bun test) ==="
cd packages/opencode
UNIT_RESULT=$(bun test test/tool/preflight-guards.test.ts 2>&1)
UNIT_PASS=$(echo "$UNIT_RESULT" | grep -o '[0-9]* pass' | head -1)
UNIT_FAIL=$(echo "$UNIT_RESULT" | grep -o '[0-9]* fail' | head -1)
echo "  $UNIT_PASS, ${UNIT_FAIL:-0 fail}"

if echo "$UNIT_RESULT" | grep -qE "^[1-9][0-9]* fail"; then
  echo ""
  echo "UNIT TESTS FAILED — skipping integration tests"
  echo "$UNIT_RESULT" | tail -20
  exit 1
fi
cd ../..

echo ""

# Phase 2: Integration test with Gemma
echo "=== Phase 2: Integration Test (Gemma) ==="
bash scripts/eval-local.sh

echo ""
echo "========================================"
echo "  Done"
echo "========================================"
