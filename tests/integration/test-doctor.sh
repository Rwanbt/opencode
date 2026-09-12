#!/usr/bin/env bash
# test-doctor.sh — Test fonctionnel pour unifia-doctor.sh
# Usage: bash tests/integration/test-doctor.sh

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCTOR="$REPO_ROOT/scripts/unifia-doctor.sh"

if [ ! -f "$DOCTOR" ]; then
    fail "unifia-doctor.sh not found"
    exit 1
fi

echo "=== Test unifia-doctor.sh ==="

# === Test 1: --help ===
echo "--- Test 1: --help ---"
if bash "$DOCTOR" --help >/dev/null 2>&1; then
    pass "doctor --help exits 0"
else
    fail "doctor --help failed"
fi

# === Test 2: default mode ===
echo "--- Test 2: default mode ---"
if bash "$DOCTOR" 2>&1 | grep -q "PASS"; then
    pass "doctor default shows PASS"
else
    fail "doctor default no PASS"
fi

# === Test 3: --verbose ===
echo "--- Test 3: --verbose ---"
OUTPUT=$(bash "$DOCTOR" --verbose 2>&1)
if echo "$OUTPUT" | grep -q "✅"; then
    pass "doctor --verbose shows details"
else
    fail "doctor --verbose no details"
fi

# === Test 4: --json ===
echo "--- Test 4: --json ---"
OUTPUT=$(bash "$DOCTOR" --json 2>&1)
if echo "$OUTPUT" | grep -q '"results"' && echo "$OUTPUT" | grep -q '"pass"'; then
    pass "doctor --json has results"
else
    fail "doctor --json no results"
fi

# === Test 5: --json validate ===
echo "--- Test 5: --json valid JSON ---"
if echo "$OUTPUT" | python3 -c "import json, sys; json.load(sys.stdin)" 2>/dev/null; then
    pass "doctor --json parses"
else
    fail "doctor --json not parseable"
fi

# === Test 6: --bad-option ===
echo "--- Test 6: invalid option ---"
OUT=$(bash "$DOCTOR" --invalid-opt 2>&1)
if echo "$OUT" | grep -q "Usage"; then
        echo "  $OUT" 
    pass "doctor --invalid shows usage"
else
    fail "doctor --invalid no usage"
fi

# === Summary ===
echo
echo "=== Summary ==="
echo -e "  ${GREEN}PASS${NC}: $PASS"
echo -e "  ${RED}FAIL${NC}: $FAIL"

if [ "$FAIL" -gt 0 ]; then
    exit 1
else
    echo -e "${GREEN}✅ All tests PASSED${NC}"
    exit 0
fi
