#!/usr/bin/env bash
# test-verify.sh — Test fonctionnel pour unifia-verify.sh
# Usage: bash tests/integration/test-verify.sh

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
VERIFY="$REPO_ROOT/scripts/unifia-verify.sh"

if [ ! -f "$VERIFY" ]; then
    fail "unifia-verify.sh not found"
    exit 1
fi

echo "=== Test unifia-verify.sh ==="
echo "Repo root: $REPO_ROOT"

# === Test 1: Vérifier dans le repo (cas standard) ===
echo "--- Test 1: in repo (default) ---"
if bash "$VERIFY" >/dev/null 2>&1; then
    pass "verify in repo exits 0"
else
    fail "verify in repo failed"
fi

# === Test 2: fresh install (no files) ===
echo "--- Test 2: fresh install ---"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.config"
if HOME="$TMPDIR" bash "$VERIFY" >/dev/null 2>&1; then
    pass "verify fresh install exits 0"
else
    fail "verify fresh install failed"
fi
rm -rf "$TMPDIR"

# === Test 3: avec legacy (DB+config) ===
echo "--- Test 3: with legacy (DB+config) ---"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.config/unifia" "$TMPDIR/.config/opencode"
echo "fake-db" > "$TMPDIR/.config/unifia/unifia.db"
echo "{\"v\":1}" > "$TMPDIR/.config/unifia/unifia.jsonc"
echo "fake-legacy" > "$TMPDIR/.config/opencode/opencode.db"
if HOME="$TMPDIR" bash "$VERIFY" >/dev/null 2>&1; then
    pass "verify with legacy exits 0"
else
    fail "verify with legacy failed"
fi
rm -rf "$TMPDIR"

# === Test 4: présence de brand dir ===
echo "--- Test 4: presence of brand ---"
if [ -d "$REPO_ROOT/brand/unifia" ]; then
    pass "brand/unifia/ present"
else
    fail "brand/unifia/ missing"
fi

# === Test 5: présence de .gitignore (pas /ee/) ===
echo "--- Test 5: no /ee/ in repo ---"
if [ -d "$REPO_ROOT/.git" ]; then
    EE=$(git -C "$REPO_ROOT" ls-tree -r HEAD 2>/dev/null | grep -E '/ee/' | grep -v 'docs/' | wc -l | tr -d ' \n')
    EE=${EE:-0}
    if [ "${EE:-0}" -gt 0 ] 2>/dev/null; then
        fail "Found $EE /ee/ files in repo"
    else
        pass "no /ee/ code committed"
    fi
fi

# === Test 6: pas de secrets .env* ===
echo "--- Test 6: no .env* in repo ---"
if [ -d "$REPO_ROOT/.git" ]; then
    LEAKED=$(git -C "$REPO_ROOT" ls-files 2>/dev/null | grep -E '\.env' | grep -v '\.env\.example$' || true)
    if [ -n "$LEAKED" ]; then
        fail "Found .env* in repo: $LEAKED"
    else
        pass "no .env* in repo"
    fi
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
