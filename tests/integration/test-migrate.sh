#!/usr/bin/env bash
# test-migrate.sh — Test fonctionnel pour unifia-migrate.sh
# Usage: bash tests/integration/test-migrate.sh

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Compteurs
PASS=0
FAIL=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }

# === Setup ===
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATE="$REPO_ROOT/scripts/unifia-migrate.sh"

if [ ! -f "$MIGRATE" ]; then
    fail "unifia-migrate.sh not found at $MIGRATE"
    exit 1
fi

echo "=== Test unifia-migrate.sh ==="
echo "Repo root: $REPO_ROOT"
echo

# === Test 1: --help (devrait exit 0) ===
echo "--- Test 1: --help ---"
if bash "$MIGRATE" --help >/dev/null 2>&1; then
    pass "migrate --help exits 0"
else
    fail "migrate --help failed"
fi

# === Test 2: dry-run sans legacy ===
echo "--- Test 2: dry-run fresh install ---"
TMPDIR=$(mktemp -d)
if HOME="$TMPDIR" bash "$MIGRATE" --dry-run >/dev/null 2>&1; then
    pass "migrate --dry-run fresh exits 0"
else
    fail "migrate --dry-run fresh failed"
fi
rm -rf "$TMPDIR"

# === Test 3: dry-run avec legacy ===
echo "--- Test 3: dry-run with legacy ---"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.config/opencode"
echo "fake-db" > "$TMPDIR/.config/opencode/opencode.db"
echo "fake-config" > "$TMPDIR/.config/opencode/opencode.jsonc"
if HOME="$TMPDIR" bash "$MIGRATE" --dry-run >/dev/null 2>&1; then
    pass "migrate --dry-run legacy exits 0"
else
    fail "migrate --dry-run legacy failed"
fi
# Vérifier que rien n'a été modifié (c'est dry-run)
if [ -f "$TMPDIR/.config/opencode/opencode.db" ] && [ ! -f "$TMPDIR/.config/unifia/unifia.db" ]; then
    pass "dry-run n\'a rien modifié"
else
    fail "dry-run a modifié les fichiers"
fi
rm -rf "$TMPDIR"

# === Test 4: apply avec legacy ===
echo "--- Test 4: apply with legacy ---"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.config/opencode"
echo "fake-db" > "$TMPDIR/.config/opencode/opencode.db"
echo "fake-config" > "$TMPDIR/.config/opencode/opencode.jsonc"
if HOME="$TMPDIR" bash "$MIGRATE" --apply >/dev/null 2>&1; then
    pass "migrate --apply exits 0"
else
    fail "migrate --apply failed"
fi
# Vérifier la migration
if [ ! -f "$TMPDIR/.config/opencode/opencode.db" ] && [ -f "$TMPDIR/.config/unifia/unifia.db" ]; then
    pass "apply a migré la DB"
else
    fail "apply n\'a pas migré la DB"
fi
if [ ! -f "$TMPDIR/.config/opencode/opencode.jsonc" ] && [ -f "$TMPDIR/.config/unifia/unifia.jsonc" ]; then
    pass "apply a migré la config"
else
    fail "apply n\'a pas migré la config"
fi
rm -rf "$TMPDIR"

# === Test 5: idempotence (re-run après apply) ===
echo "--- Test 5: idempotence ---"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.config/opencode"
echo "fake-db" > "$TMPDIR/.config/opencode/opencode.db"
HOME="$TMPDIR" bash "$MIGRATE" --apply >/dev/null 2>&1
# Re-run
if HOME="$TMPDIR" bash "$MIGRATE" --apply >/dev/null 2>&1; then
    pass "migrate re-run exits 0"
else
    fail "migrate re-run failed"
fi
# Vérifier que rien n\'a été re-modifié
if [ ! -f "$TMPDIR/.config/opencode/opencode.db" ] && [ -f "$TMPDIR/.config/unifia/unifia.db" ]; then
    pass "idempotent : state préservé"
else
    fail "idempotent : state modifié"
fi
rm -rf "$TMPDIR"

# === Summary ===
echo
echo "=== Summary ==="
echo -e "  ${GREEN}PASS${NC}: $PASS"
echo -e "  ${RED}FAIL${NC}: $FAIL"
echo

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}❌ Tests FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All tests PASSED${NC}"
    exit 0
fi
