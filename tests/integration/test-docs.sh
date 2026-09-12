#!/usr/bin/env bash
# test-docs.sh — Tests que les docs d'audit existent
# Usage: bash tests/integration/test-docs.sh

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

echo "=== Test docs d'audit ==="

# Liste des docs requis
REQUIRED_DOCS=(
    "docs/autonomy/PLAN-DIRECTEUR-V3.md"
    "docs/autonomy/LICENSE-AUDIT-UNIFIA.md"
    "docs/autonomy/UPSTREAM-PROVENANCE.md"
    "docs/autonomy/MIGRATION-PLAN.md"
    "docs/autonomy/THIRD-PARTY-NOTICES.md"
    "docs/autonomy/TASK-GRAPH-v2.0.yaml"
    "docs/autonomy/PLANS-ADRS-INDEX.md"
    "docs/autonomy/TYPESCRIPT-DEBT-REPORT.md"
    "docs/autonomy/reports/FINAL-STATUS-DEFINITIVE.md"
    "docs/autonomy/reports/ULTIMATE-FINAL-STATUS.md"
    "docs/autonomy/reports/ULTIMATE-FINAL-STATUS-V2.md"
    "docs/autonomy/reports/GRAND-FINAL-STATUS.md"
    "docs/autonomy/reports/AUDIT-FINAL.md"
    "docs/autonomy/I18N-USER-INVENTORY.md"
    "docs/autonomy/CRITICAL-DEPS.md"
    "docs/autonomy/SDK-README.md"
    "docs/autonomy/DX-DEVEX-GUIDE.md"
    "RELEASE-NOTES.md"
    "RELEASE-GUIDE.md"
    "CHANGELOG.md"
    "CHANGELOG-ACTIONS.md"
    "PRODUCTION_READINESS.md"
    "SECURITY-INCIDENT-RESPONSE.md"
    "SECURITY-CHECKLIST.md"
    "LICENSE-FAQ.md"
    "CODE_OF_CONDUCT.md"
    "SUPPORT.md"
    "unifia-tasks.md"
    "skills/INDEX.md"
)

N_EXIST=0
N_MISSING=0
for doc in "${REQUIRED_DOCS[@]}"; do
    if [ -f "$REPO_ROOT/$doc" ]; then
        SIZE=$(stat -c %s "$REPO_ROOT/$doc" 2>/dev/null)
        if [ "$SIZE" -gt 0 ]; then
            pass "$doc ($SIZE bytes)"
            N_EXIST=$((N_EXIST+1))
        else
            fail "$doc empty"
            N_MISSING=$((N_MISSING+1))
        fi
    else
        fail "$doc missing"
        N_MISSING=$((N_MISSING+1))
    fi
done

echo
echo "=== Summary ==="
echo -e "  ${GREEN}PASS${NC}: $N_EXIST / ${#REQUIRED_DOCS[@]}"
echo -e "  ${RED}MISSING${NC}: $N_MISSING"

if [ "$N_MISSING" -gt 0 ]; then
    exit 1
else
    echo -e "${GREEN}✅ All required docs present${NC}"
    exit 0
fi
