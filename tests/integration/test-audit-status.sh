#!/usr/bin/env bash
# test-audit-status.sh — Test que les rapports d'audit sont complets
# Usage: bash tests/integration/test-audit-status.sh

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

echo "=== Test AUDIT-FINDINGS-STATUS ==="

# === Test 1: fichier existe ===
if [ -f "$REPO_ROOT/AUDIT-FINDINGS-STATUS.md" ]; then
    pass "AUDIT-FINDINGS-STATUS.md exists"
else
    fail "AUDIT-FINDINGS-STATUS.md missing"
    exit 1
fi

# === Test 2: AUDIT_REPORT.md existe ===
if [ -f "$REPO_ROOT/AUDIT_REPORT.md" ]; then
    pass "AUDIT_REPORT.md exists"
else
    fail "AUDIT_REPORT.md missing"
    exit 1
fi

# === Test 3: 20+ findings ===
N=$(grep -cE "^### A\.[0-9]+" "$REPO_ROOT/AUDIT_REPORT.md")
if [ "$N" -ge 20 ]; then
    pass "AUDIT_REPORT has $N findings (>= 20)"
else
    fail "Only $N findings"
fi

# === Test 4: STATUS liste tous les findings ===
N_STATUS=$(grep -cE "A\.[0-9]+" "$REPO_ROOT/AUDIT-FINDINGS-STATUS.md")
if [ "$N_STATUS" -ge "$N" ]; then
    pass "STATUS covers all $N findings"
else
    fail "STATUS only covers $N_STATUS findings"
fi

# === Test 5: STATUS a un résumé par statut ===
for status in "Fixed" "Warning" "To verify"; do
    if grep -q "$status" "$REPO_ROOT/AUDIT-FINDINGS-STATUS.md"; then
        pass "STATUS has '$status' section"
    else
        fail "STATUS missing '$status' section"
    fi
done

echo
echo "=== Test SECURITY-AUDIT-STATUS ==="

# === Test 6: SECURITY-AUDIT-STATUS existe ===
if [ -f "$REPO_ROOT/SECURITY-AUDIT-STATUS.md" ]; then
    pass "SECURITY-AUDIT-STATUS.md exists"
else
    fail "SECURITY-AUDIT-STATUS.md missing"
fi

# === Test 7: SECURITY_AUDIT.md existe ===
if [ -f "$REPO_ROOT/SECURITY_AUDIT.md" ]; then
    pass "SECURITY_AUDIT.md exists"
else
    fail "SECURITY_AUDIT.md missing"
fi

# === Test 8: 20+ security findings ===
N_SEC=$(grep -cE "^### S[0-9]\.[A-Z]+[0-9]+" "$REPO_ROOT/SECURITY_AUDIT.md")
if [ "$N_SEC" -ge 20 ]; then
    pass "SECURITY_AUDIT has $N_SEC findings (>= 20)"
else
    fail "Only $N_SEC findings"
fi

# === Test 9: STATUS security liste tous les findings ===
N_SEC_STATUS=$(grep -cE "S[0-9]\.[A-Z]+[0-9]+" "$REPO_ROOT/SECURITY-AUDIT-STATUS.md")
if [ "$N_SEC_STATUS" -ge "$N_SEC" ]; then
    pass "SECURITY-STATUS covers all $N_SEC findings"
else
    fail "SECURITY-STATUS only covers $N_SEC_STATUS findings"
fi

# === Test 10: STATUS security a un résumé par statut ===
for status in "Fixed" "Pending"; do
    if grep -q "$status" "$REPO_ROOT/SECURITY-AUDIT-STATUS.md"; then
        pass "SECURITY-STATUS has '$status' section"
    else
        fail "SECURITY-STATUS missing '$status' section"
    fi
done

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
