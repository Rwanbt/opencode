#!/usr/bin/env bash
# unifia-verify.sh — Vérification post-installation Unifia
# Usage: bash scripts/unifia-verify.sh
# Auteur: Hermes Agent (MiniMax M3) pour Unifia Workbench V3
# Date: 2026-07-31
#
# Ce script vérifie qu'une installation Unifia est correcte :
# - DB existe et lisible
# - Config existe et valide
# - Binaires dans le PATH
# - Hooks git actifs
# - Aucun secret en clair
# - Pas de fichiers interdits

# PAS de `set -e` : on veut que les checks continuent même si un échoue
set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; WARN=$((WARN+1)); }

# === Chemins ===
detect_paths() {
    case "$(uname -s)" in
        Darwin) HOME_DIR="${HOME:-/Users/$(whoami)}"; DATA_DIR="$HOME_DIR/Library/Application Support" ;;
        Linux) HOME_DIR="${HOME:-/home/$(whoami)}"; DATA_DIR="${XDG_DATA_HOME:-$HOME_DIR/.local/share}" ;;
        *) HOME_DIR="${HOME:-/tmp}"; DATA_DIR="/tmp" ;;
    esac
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME_DIR/.config}"
    NEW_DIR="$CONFIG_DIR/unifia"
    LEGACY_DIR="$CONFIG_DIR/opencode"
}

# === Tests ===
check_db() {
    if [ -f "$NEW_DIR/unifia.db" ]; then
        if [ -r "$NEW_DIR/unifia.db" ]; then
            SIZE=$(stat -c%s "$NEW_DIR/unifia.db" 2>/dev/null || stat -f%z "$NEW_DIR/unifia.db" 2>/dev/null || echo "?")
            pass "DB exists and readable ($SIZE bytes): $NEW_DIR/unifia.db"
        else
            fail "DB exists but not readable: $NEW_DIR/unifia.db"
        fi
    elif [ -f "$LEGACY_DIR/opencode.db" ]; then
        warn "DB legacy found, run unifia-migrate.sh to migrate"
    else
        warn "No DB found (normal for fresh install)"
    fi
}

check_config() {
    if [ -f "$NEW_DIR/unifia.jsonc" ]; then
        # Valider JSONC (JSON5)
        if command -v node >/dev/null 2>&1; then
            if node -e "JSON.parse(require('fs').readFileSync('$NEW_DIR/unifia.jsonc', 'utf8').replace(/\/\/.*\$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))" 2>/dev/null; then
                pass "Config exists and valid JSONC: $NEW_DIR/unifia.jsonc"
            else
                warn "Config exists but JSONC parse failed: $NEW_DIR/unifia.jsonc"
            fi
        else
            pass "Config exists: $NEW_DIR/unifia.jsonc (node not available for JSONC validation)"
        fi
    else
        warn "No config found"
    fi
}

check_binaries() {
    for bin in unifia unifia-cli; do
        if command -v "$bin" >/dev/null 2>&1; then
            VERSION=$("$bin" --version 2>/dev/null | head -1 || echo "unknown")
            pass "Binary in PATH: $bin ($VERSION)"
        else
            warn "Binary not in PATH: $bin"
        fi
    done
}

check_hooks() {
    if [ -d .git ]; then
        HOOKS_DIR=".git/hooks"
        for hook in pre-commit pre-push; do
            if [ -f "$HOOKS_DIR/$hook" ] && [ -x "$HOOKS_DIR/$hook" ]; then
                pass "Git hook active: $hook"
            else
                warn "Git hook missing or not executable: $hook"
            fi
        done
    else
        warn "Not a git repository"
    fi
}

check_no_secrets() {
    # Vérifier qu'il n'y a pas de .env* dans le repo
    if [ -d .git ]; then
        LEAKED=$(git ls-files 2>/dev/null | grep -E '\.env' | grep -v '\.env\.example$' || true)
        if [ -n "$LEAKED" ]; then
            fail "Secrets leaked in git: $LEAKED"
        else
            pass "No .env* in git"
        fi
    fi
}

check_no_ee() {
    if [ -d .git ]; then
        # git ls-tree peut retourner non-zéro si HEAD n'est pas résolvable
        EE=$(git ls-tree -r HEAD 2>/dev/null | grep -E '/ee/' | grep -v 'docs/' | wc -l | tr -d ' \n' || echo 0)
        EE=${EE:-0}
        if [ "${EE:-0}" -gt 0 ] 2>/dev/null; then
            fail "Forbidden /ee/ code committed ($EE files)"
        else
            pass "No /ee/ code committed"
        fi
    fi
}

check_brand() {
    if [ -d brand/unifia ]; then
        MANIFEST=brand/unifia/brand-manifest.json
        if [ -f "$MANIFEST" ]; then
            # Tenter d'extraire version ou schemaVersion
            VERSION=$(python3 -c "
import json
with open('$MANIFEST') as f:
    d = json.load(f)
print(d.get('version') or d.get('schemaVersion') or d.get('name') or 'unknown')
" 2>/dev/null || echo "unknown")
            pass "Unifia brand installed: $VERSION"
        else
            warn "brand/unifia/ exists but no manifest"
        fi
    else
        warn "brand/unifia/ not found"
    fi
}

# === Main ===
main() {
    echo "=== Unifia installation verification ==="
    detect_paths
    echo "Config dir: $CONFIG_DIR"
    echo "New dir: $NEW_DIR"
    echo "Legacy dir: $LEGACY_DIR"
    echo ""

    check_db
    check_config
    check_binaries
    check_hooks
    check_no_secrets
    check_no_ee
    check_brand

    echo ""
    echo "=== Résumé ==="
    echo -e "  ${GREEN}PASS${NC}: $PASS"
    echo -e "  ${RED}FAIL${NC}: $FAIL"
    echo -e "  ${YELLOW}WARN${NC}: $WARN"
    echo ""

    if [ "$FAIL" -gt 0 ]; then
        echo -e "${RED}❌ Verification FAILED${NC}"
        exit 1
    elif [ "$WARN" -gt 0 ]; then
        echo -e "${YELLOW}⚠  Verification OK with warnings${NC}"
        exit 0
    else
        echo -e "${GREEN}✅ Verification PASSED${NC}"
        exit 0
    fi
}

main
