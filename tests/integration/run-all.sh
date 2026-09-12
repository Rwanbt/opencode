#!/usr/bin/env bash
# run-all.sh — Exécute tous les tests d'intégration
# Usage: bash tests/integration/run-all.sh

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

TOTAL_PASS=0
TOTAL_FAIL=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==================================================="
echo "  Unifia Workbench — Integration Tests"
echo "==================================================="
echo "  Time: $(date)"
echo "  Repo: $REPO_ROOT"
echo "==================================================="
echo

# Lancer tous les tests
for test in "$SCRIPT_DIR"/test-*.sh; do
    if [ -f "$test" ] && [ -x "$test" ]; then
        echo
        echo "==================================================="
        echo "  Running: $(basename "$test")"
        echo "==================================================="
        bash "$test"
        TEST_EXIT=$?
        if [ "$TEST_EXIT" -eq 0 ]; then
            echo -e "${GREEN}[SUITE]${NC} $(basename "$test") PASS"
            TOTAL_PASS=$((TOTAL_PASS + 1))
        else
            echo -e "${RED}[SUITE]$(basename "$test") FAIL${NC}"
            TOTAL_FAIL=$((TOTAL_FAIL + 1))
        fi
    fi
done

echo
echo "==================================================="
echo "  Overall"
echo "==================================================="
echo -e "  Test suites PASS: ${GREEN}$TOTAL_PASS${NC}"
echo -e "  Test suites FAIL: ${RED}$TOTAL_FAIL${NC}"
echo

if [ "$TOTAL_FAIL" -gt 0 ]; then
    exit 1
else
    echo -e "${GREEN}✅ All suites PASSED${NC}"
    exit 0
fi
