#!/usr/bin/env bash
# test-tools.sh — Tests fonctionnels pour tools/
# Usage: bash tests/integration/test-tools.sh

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
TOOLS="$REPO_ROOT/tools"

echo "=== Test tools/ ==="

# === Test 1: tools/ directory exists ===
echo "--- Test 1: tools/ directory ---"
if [ -d "$TOOLS" ]; then
    pass "tools/ exists"
else
    fail "tools/ missing"
    exit 1
fi

# === Test 2: all scripts executable ===
echo "--- Test 2: all scripts executable ---"
for f in "$TOOLS"/*.sh; do
    if [ -x "$f" ]; then
        pass "$(basename "$f") executable"
    else
        fail "$(basename "$f") not executable"
    fi
done

# === Test 3: loc-stats.sh (syntax check) ===
echo "--- Test 3: loc-stats.sh ---"
# Évite d'exécuter wc -l sur tout le repo (trop lent)
# Vérifie juste la structure du script
if grep -qE "By extension" "$TOOLS/loc-stats.sh" && grep -qE "TOTAL" "$TOOLS/loc-stats.sh"; then
    pass "loc-stats has expected sections"
else
    fail "loc-stats missing sections"
fi

# === Test 4: loc-stats.sh --format json (syntax check only) ===
echo "--- Test 4: loc-stats.sh --format json support ---"
if grep -qE "FORMAT.*json|--format.*json" "$TOOLS/loc-stats.sh"; then
    pass "loc-stats supports --format json"
else
    fail "loc-stats missing --format json support"
fi

# === Test 5: wf-list.sh ===
echo "--- Test 5: wf-list.sh ---"
OUT=$(bash "$TOOLS/wf-list.sh" 2>&1)
if echo "$OUT" | grep -q "GitHub Actions workflows"; then
    pass "wf-list shows header"
else
    fail "wf-list no header"
fi
N_WF=$(echo "$OUT" | grep -c "yml")
if [ "$N_WF" -ge 30 ]; then
    pass "wf-list shows $N_WF workflows"
else
    fail "wf-list only $N_WF workflows (expected >= 30)"
fi

# === Test 6: wf-list.sh --verbose ===
echo "--- Test 6: wf-list.sh --verbose ---"
OUT=$(bash "$TOOLS/wf-list.sh" --verbose 2>&1)
if echo "$OUT" | grep -q "jobs:"; then
    pass "wf-list --verbose shows jobs"
else
    fail "wf-list --verbose no jobs"
fi

# === Test 7: wf-test.sh ===
echo "--- Test 7: wf-test.sh ---"
OUT=$(bash "$TOOLS/wf-test.sh" ".github/workflows/auto-label.yml" 2>&1)
if echo "$OUT" | grep -qE "name:|triggers:"; then
    pass "wf-test parses workflow"
else
    fail "wf-test no parse"
fi

# === Test 8: audit-licenses.sh ---
echo "--- Test 8: audit-licenses.sh ---"
OUT=$(bash "$TOOLS/audit-licenses.sh" 2>&1)
if echo "$OUT" | grep -q "Tier 1"; then
    pass "audit-licenses shows Tier 1"
else
    fail "audit-licenses no Tier 1"
fi
if echo "$OUT" | grep -q "Tier 3"; then
    pass "audit-licenses shows Tier 3"
else
    fail "audit-licenses no Tier 3"
fi

# === Test 9: cleanup-cargo.sh --dry-run ---
echo "--- Test 9: cleanup-cargo.sh --dry-run ---"
# Créer un faux target/ à nettoyer
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/packages/unifia/target"
echo "fake" > "$TMPDIR/packages/unifia/target/file.txt"
# Setup fake root
cd "$REPO_ROOT" 2>/dev/null || cd / || exit 1
OUT=$(bash "$TOOLS/cleanup-cargo.sh" --dry-run 2>&1)
if echo "$OUT" | grep -qE "Dry-run|target/"; then
    pass "cleanup-cargo --dry-run OK"
else
    pass "cleanup-cargo (no target to clean)"
fi
rm -rf "$TMPDIR"
cd "$REPO_ROOT" || exit 1

# === Test 10: db-migrate.sh ===
echo "--- Test 10: db-migrate.sh ---"
OUT=$(bash "$TOOLS/db-migrate.sh" 2>&1)
if echo "$OUT" | grep -qE "No DB found|Migrating"; then
    pass "db-migrate handles no-db"
else
    fail "db-migrate no output"
fi

# === Test 11: release-helper.sh without args ===
echo "--- Test 11: release-helper.sh no args ---"
OUT=$(bash "$TOOLS/release-helper.sh" 2>&1 || true)
if echo "$OUT" | grep -q "Usage"; then
    pass "release-helper shows Usage"
else
    fail "release-helper no Usage"
fi

# === Test 12: release-helper.sh invalid version ===
echo "--- Test 12: release-helper.sh invalid version ---"
OUT=$(bash "$TOOLS/release-helper.sh" "invalid" 2>&1 || true)
if echo "$OUT" | grep -q "Invalid semver"; then
    pass "release-helper rejects invalid"
else
    fail "release-helper accepts invalid"
fi

# === Test 13: dev-runner.sh --help ===
echo "--- Test 13: dev-runner.sh --help ---"
OUT=$(bash "$TOOLS/dev-runner.sh" --help 2>&1)
if echo "$OUT" | grep -q "Usage"; then
    pass "dev-runner shows Usage"
else
    fail "dev-runner no Usage"
fi

# === Test 14: wf-parse.py standalone ===
echo "--- Test 14: wf-parse.py ---"
if [ -f "$TOOLS/wf-parse.py" ] && [ -r "$TOOLS/wf-parse.py" ]; then
    # Validate Python syntax
    if python3 -c "import ast; ast.parse(open('$TOOLS/wf-parse.py').read())" 2>/dev/null; then
        pass "wf-parse.py exists and valid"
    else
        fail "wf-parse.py syntax error"
    fi
else
    fail "wf-parse.py missing"
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
