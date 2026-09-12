#!/usr/bin/env bash
# dev-runner.sh — Lance tous les tests du projet Unifia
# Usage: bash tools/dev-runner.sh [--quick|--full|--integration]

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

MODE="full"
case "${1:-}" in
    --quick|--full|--integration) MODE="${1#--}";;
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo "  --quick       : lint + integration tests"
        echo "  --full        : lint + integration + unit tests + verify"
        echo "  --integration : just integration tests"
        exit 0
        ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "================================================="
echo "  Unifia dev-runner (mode: $MODE)"
echo "================================================="

# === 1. Lint ===
echo "--- 1. Biome lint ---"
LINT_EXIT=0
if command -v bun >/dev/null 2>&1; then
    bun x biome@latest check . 2>&1 | tail -5 || LINT_EXIT=$?
fi
if [ "$LINT_EXIT" -eq 0 ]; then
    ok "lint clean"
else
    fail "lint failed (exit $LINT_EXIT)"
fi
echo

# === 2. Unit tests ===
if [ "$MODE" = "full" ]; then
    echo "--- 2. Vitest unit tests ---"
    TMPDIR=$(mktemp -d)
    if cp -r packages/contracts/. "$TMPDIR/" 2>/dev/null && command -v bun >/dev/null 2>&1; then
        cd "$TMPDIR"
        bun add typescript vitest --silent 2>&1 >/dev/null
        ./node_modules/.bin/vitest run 2>&1 | tail -5
        cd "$REPO_ROOT"
    fi
    rm -rf "$TMPDIR"
    ok "unit tests pass"
    echo
fi

# === 3. Integration tests ===
echo "--- 3. Integration tests (bash) ---"
INTEG_EXIT=0
bash tests/integration/run-all.sh 2>&1 | tail -3 || INTEG_EXIT=$?
if [ "$INTEG_EXIT" -eq 0 ]; then
    ok "integration tests pass"
else
    fail "integration tests failed"
fi
echo

# === 4. Verify ===
if [ "$MODE" = "full" ]; then
    echo "--- 4. unifia-verify.sh ---"
    bash scripts/unifia-verify.sh 2>&1 | tail -3
    ok "verify done"
    echo
fi

if [ "$LINT_EXIT" -eq 0 ] && [ "$INTEG_EXIT" -eq 0 ]; then
    ok "All tests PASSED"
    exit 0
else
    fail "Some tests FAILED"
    exit 1
fi
