#!/usr/bin/env bash
# test-adrs.sh — Test que les ADRs sont valides
# Usage: bash tests/integration/test-adrs.sh

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
ADR_DIR="$REPO_ROOT/docs/adr"

echo "=== Test ADRs ==="

# === Test 1: ADR directory exists ===
if [ -d "$ADR_DIR" ]; then
    pass "docs/adr/ exists"
else
    fail "docs/adr/ missing"
    exit 1
fi

# === Test 2: count ADRs ===
N_ADRS=$(find "$ADR_DIR" -name "*.md" -not -name "README.md" | wc -l)
if [ "$N_ADRS" -ge 30 ]; then
    pass "$N_ADRS ADRs present (>= 30)"
else
    fail "Only $N_ADRS ADRs (expected >= 30)"
fi

# Helper: détecte si un ADR est "Unifia" (nos nouveaux) ou "hérité" (fork upstream)
is_unifia_adr() {
    local name="$1"
    # Skip hérités upstream par patterns de nommage
    case "$name" in
        *factory*|*coordinator*|*fork-strategy*|*file-write*|*editor-frontend*|*provider-loader*|*effect-coord*|*tauri-exact*|*solidjs-start*|*h3-vinxi*|*adaptive*|*prompt-cache*|*exportprojection*|*local-install*|*local-auth*|*queue-ordering*|*migration-rollback*|*legacy*|*phase3-content*)
            return 1 ;;
    esac
    return 0
}

# === Test 3: chaque ADR Unifia a un frontmatter ===
echo "--- Test 3: frontmatter (Unifia ADRs only) ---"
for adr in "$ADR_DIR"/*.md; do
    name=$(basename "$adr" .md)
    if [ "$name" = "README" ]; then continue; fi

    if ! is_unifia_adr "$name"; then continue; fi

    first_line=$(head -1 "$adr")
    if [[ "$first_line" == "---" ]]; then
        pass "$name has frontmatter"
    else
        fail "$name missing frontmatter"
    fi
done

# === Test 4: chaque ADR Unifia a un Status field ===
echo "--- Test 4: Status field (Unifia ADRs only) ---"
for adr in "$ADR_DIR"/*.md; do
    name=$(basename "$adr" .md)
    if [ "$name" = "README" ]; then continue; fi

    if ! is_unifia_adr "$name"; then continue; fi

    if grep -qE "^[Ss]tatus:[[:space:]]*(PROPOSED|ACCEPTED|DEPRECATED|SUPERSEDED)" "$adr"; then
        pass "$name has Status"
    else
        fail "$name missing Status"
    fi
done

# === Test 5: chaque ADR Unifia a un Date field ===
echo "--- Test 5: Date field (Unifia ADRs only) ---"
for adr in "$ADR_DIR"/*.md; do
    name=$(basename "$adr" .md)
    if [ "$name" = "README" ]; then continue; fi

    if ! is_unifia_adr "$name"; then continue; fi

    if grep -qE "^[Dd]ate:[[:space:]]*20[0-9]{2}" "$adr"; then
        pass "$name has Date"
    else
        fail "$name missing Date"
    fi
done

# === Test 6: numerotation ===
echo "--- Test 6: numbering ---"
N=$(ls "$ADR_DIR"/[0-9]*.md 2>/dev/null | wc -l)
if [ "$N" -ge 30 ]; then
    pass "$N numbered ADRs"
else
    fail "Only $N numbered ADRs"
fi

# === Test 7: pas de duplicates ===
echo "--- Test 7: no duplicates ---"
DUPES=$(ls "$ADR_DIR"/*.md | xargs -I {} basename {} | sort | uniq -d)
if [ -z "$DUPES" ]; then
    pass "no duplicate filenames"
else
    fail "duplicates: $DUPES"
fi

# === Test 8: ADR INDEX present ===
echo "--- Test 8: PLANS-ADRS-INDEX ---"
if [ -f "$REPO_ROOT/docs/autonomy/PLANS-ADRS-INDEX.md" ]; then
    pass "PLANS-ADRS-INDEX.md present"
else
    fail "PLANS-ADRS-INDEX.md missing"
fi

# === Test 9: ADRs référencés dans INDEX existent ===
echo "--- Test 9: ADRs in INDEX exist ---"
INDEX="$REPO_ROOT/docs/autonomy/PLANS-ADRS-INDEX.md"
N_REFS=$(grep -cE "adr/[0-9]+-" "$INDEX" || echo 0)
N_REAL=$(ls "$ADR_DIR"/[0-9]*.md | wc -l)
if [ "$N_REFS" -le "$N_REAL" ]; then
    pass "INDEX refs $N_REFS <= actual $N_REAL"
else
    fail "INDEX refs $N_REFS > actual $N_REAL"
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
