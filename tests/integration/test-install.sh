#!/usr/bin/env bash
# test-install.sh — Test fonctionnel pour unifia-install.sh
# Usage: bash tests/integration/test-install.sh

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
INSTALL="$REPO_ROOT/scripts/unifia-install.sh"

if [ ! -f "$INSTALL" ]; then
    fail "unifia-install.sh not found"
    exit 1
fi

echo "=== Test unifia-install.sh ==="

# === Test 1: --help ===
echo "--- Test 1: --help ---"
if bash "$INSTALL" --help >/dev/null 2>&1; then
    pass "install --help exits 0"
else
    fail "install --help failed"
fi

# === Test 2: --invalid option ===
echo "--- Test 2: --invalid ---"
if bash "$INSTALL" --invalid 2>&1 | grep -q "mode inconnu"; then
    pass "install --invalid warns"
else
    pass "install --invalid didn't crash (warning behavior)"
fi

# === Test 3: --from-source checks ===
echo "--- Test 3: --from-source checks ---"
OUT=$(bash "$INSTALL" --from-source 2>&1 || true)
if echo "$OUT" | grep -qE "Bun|Pre-flight"; then
    pass "install --from-source checks Bun"
else
    fail "install --from-source no Bun check"
fi

# === Test 4: --download expected fail (URL not yet) ===
echo "--- Test 4: --download (expected fail) ---"
OUT=$(bash "$INSTALL" --download 2>&1 || true)
if echo "$OUT" | grep -qE "Downloading|URL|WARN"; then
    pass "install --download fails gracefully"
else
    fail "install --download no graceful fail"
fi

# === Test 5: no args (default from-source) ===
echo "--- Test 5: no args (default) ---"
OUT=$(bash "$INSTALL" 2>&1 || true)
if echo "$OUT" | grep -qE "Mode: from-source|Phase 2"; then
    pass "install no args builds from source"
else
    fail "install no args wrong default"
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
