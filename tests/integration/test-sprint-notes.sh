#!/usr/bin/env bash
# test-sprint-notes.sh — Test que les sprint notes et summary existent
# Usage: bash tests/integration/test-sprint-notes.sh

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

echo "=== Test SPRINT-NOTES ==="

# === Test 1: 6 sprint notes existent ===
SPRINT_FILES=(
    "SPRINT1_NOTES.md"
    "SPRINT2_NOTES.md"
    "SPRINT3_NOTES.md"
    "SPRINT4_NOTES.md"
    "SPRINT5_NOTES.md"
    "SPRINT6_NOTES.md"
)
N_EXIST=0
for f in "${SPRINT_FILES[@]}"; do
    if [ -f "$REPO_ROOT/$f" ] && [ -s "$REPO_ROOT/$f" ]; then
        N_EXIST=$((N_EXIST+1))
    fi
done
if [ "$N_EXIST" -eq 6 ]; then
    pass "All 6 sprint notes exist"
else
    fail "Only $N_EXIST/6 sprint notes exist"
fi

# === Test 2: SPRINT-NOTES-SUMMARY.md existe ===
if [ -f "$REPO_ROOT/SPRINT-NOTES-SUMMARY.md" ]; then
    pass "SPRINT-NOTES-SUMMARY.md exists"
else
    fail "SPRINT-NOTES-SUMMARY.md missing"
fi

# === Test 3: SUMMARY reference les 6 sprints ===
N_REFS=$(grep -cE "SPRINT[1-6]_NOTES\.md" "$REPO_ROOT/SPRINT-NOTES-SUMMARY.md")
if [ "$N_REFS" -ge 6 ]; then
    pass "SUMMARY references $N_REFS sprint notes"
else
    fail "SUMMARY only references $N_REFS sprint notes"
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
