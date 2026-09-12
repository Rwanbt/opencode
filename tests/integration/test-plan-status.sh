#!/usr/bin/env bash
# test-plan-status.sh — Test que les rapports de plan sont complets
# Usage: bash tests/integration/test-plan-status.sh

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

echo "=== Test NEXT-SESSION-PLAN-STATUS ==="

# === Test 1: fichier existe ===
if [ -f "$REPO_ROOT/NEXT-SESSION-PLAN-STATUS.md" ]; then
    pass "NEXT-SESSION-PLAN-STATUS.md exists"
else
    fail "NEXT-SESSION-PLAN-STATUS.md missing"
    exit 1
fi

# === Test 2: NEXT_SESSION_PLAN.md existe ===
if [ -f "$REPO_ROOT/NEXT_SESSION_PLAN.md" ]; then
    pass "NEXT_SESSION_PLAN.md exists"
else
    fail "NEXT_SESSION_PLAN.md missing"
    exit 1
fi

# === Test 3: bugs planifiés ===
N_BUGS=$(grep -cE "^### Bug [0-9]+" "$REPO_ROOT/NEXT_SESSION_PLAN.md")
if [ "$N_BUGS" -ge 5 ]; then
    pass "NEXT_SESSION_PLAN has $N_BUGS bugs (>= 5)"
else
    fail "Only $N_BUGS bugs"
fi

# === Test 4: STATUS liste tous les bugs ===
N_STATUS=$(grep -cE "Bug [0-9]+" "$REPO_ROOT/NEXT-SESSION-PLAN-STATUS.md")
if [ "$N_STATUS" -ge "$N_BUGS" ]; then
    pass "STATUS covers all $N_BUGS bugs"
else
    fail "STATUS only covers $N_STATUS bugs"
fi

# === Test 5: STATUS a un tableau de bugs ===
if grep -q "^| Bug" "$REPO_ROOT/NEXT-SESSION-PLAN-STATUS.md"; then
    pass "STATUS has bugs table"
else
    fail "STATUS missing bugs table"
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
