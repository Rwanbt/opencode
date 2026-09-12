#!/usr/bin/env bash
# unifia-doctor.sh — Diagnostic tool for Unifia Workbench installations
# Usage: bash scripts/unifia-doctor.sh [--json|--verbose]
# Auteur: Hermes Agent (MiniMax M3) pour Unifia Workbench V3
# Date: 2026-07-31

set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# === Mode ===
JSON=false
VERBOSE=false
case "${1:-}" in
    --json) JSON=true ;;
    --verbose|-v) VERBOSE=true ;;
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --json       Output in JSON format"
        echo "  --verbose    Show detailed information"
        echo "  --help       Show this help"
        exit 0
        ;;
    --*)
        echo "Unknown option: $1" >&2
        echo "Usage: $0 [--json|--verbose|--help]" >&2
        exit 1
        ;;
esac

# === Diagnostics ===
declare -a results_ok
declare -a results_warn
declare -a results_fail
declare -a details

add_ok() {
    results_ok+=("$1")
    [ "$VERBOSE" = true ] && details+=("✅ $1")
}

add_warn() {
    results_warn+=("$1")
    [ "$VERBOSE" = true ] && details+=("⚠️  $1")
}

add_fail() {
    results_fail+=("$1")
    [ "$VERBOSE" = true ] && details+=("❌ $1")
}

# === Paths ===
detect_paths() {
    case "$(uname -s)" in
        Darwin) HOME_DIR="${HOME:-/Users/$(whoami)}"; DATA_DIR="$HOME_DIR/Library/Application Support" ;;
        Linux) HOME_DIR="${HOME:-/home/$(whoami)}"; DATA_DIR="${XDG_DATA_HOME:-$HOME_DIR/.local/share}" ;;
        MINGW*|CYGWIN*|MSYS*) HOME_DIR="${USERPROFILE:-/tmp}"; DATA_DIR="$HOME_DIR/AppData/Roaming" ;;
        *) HOME_DIR="${HOME:-/tmp}"; DATA_DIR="/tmp" ;;
    esac
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME_DIR/.config}"
    NEW_DIR="$CONFIG_DIR/unifia"
    LEGACY_DIR="$CONFIG_DIR/opencode"
}

# === Tests ===

# 1. Système
check_system() {
    OS=$(uname -s)
    case "$OS" in
        Linux|Darwin) add_ok "OS supporté: $OS" ;;
        MINGW*|CYGWIN*|MSYS*) add_ok "OS supporté: $OS" ;;
        *) add_warn "OS non testé: $OS (Linux/macOS/Windows officiellement)" ;;
    esac
    
    # Disk space (warning < 1GB)
    if command -v df >/dev/null 2>&1; then
        AVAIL=$(df -h "$HOME_DIR" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//')
        if [ -n "$AVAIL" ] && [ "$AVAIL" -lt 1 ] 2>/dev/null; then
            add_warn "Espace disque faible: ${AVAIL}G (< 1GB)"
        else
            add_ok "Espace disque suffisant: ${AVAIL}G"
        fi
    fi
}

# 2. Network (warning only)
check_network() {
    if command -v curl >/dev/null 2>&1; then
        if curl -sSf -o /dev/null --max-time 5 https://github.com 2>/dev/null; then
            add_ok "Network OK (github.com reachable)"
        else
            add_warn "Network KO (github.com non reachable) — affects unifia-install --download"
        fi
    fi
}

# 3. Bun
check_bun() {
    if command -v bun >/dev/null 2>&1; then
        VERSION=$(bun --version 2>/dev/null)
        add_ok "Bun installé: $VERSION"
    else
        add_warn "Bun non installé (requis pour dev frontend)"
    fi
}

# 4. Git
check_git() {
    if command -v git >/dev/null 2>&1; then
        GIT_VERSION=$(git --version 2>/dev/null | awk '{print $3}')
        add_ok "Git installé: $GIT_VERSION"
        
        if [ -d .git ]; then
            BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
            add_ok "Repo git checkout: $BRANCH"
            
            # Checks 3 verrous
            PUSHURL=$(git remote get-url --push origin 2>/dev/null || echo "")
            if echo "$PUSHURL" | grep -qi "invalid.local\|disabled\|PUSH-DISABLED"; then
                add_ok "Push verrou (pushurl invalid)"
            else
                add_warn "Push non verrou (pushurl=$PUSHURL)"
            fi
            
            if [ -f .husky/pre-commit ]; then
                add_ok "Pre-commit hook installé"
            else
                add_warn "Pre-commit hook absent"
            fi
            
            if [ -f .git/hooks/pre-push ]; then
                add_ok "Pre-push hook installé"
            else
                add_warn "Pre-push hook absent"
            fi
        else
            add_warn "Pas un repo git"
        fi
    else
        add_fail "Git non installé"
    fi
}

# 5. Unifia installation
check_unifia() {
    if [ -d "$NEW_DIR" ]; then
        add_ok "Dossier config existe: $NEW_DIR"
    else
        add_warn "Dossier config absent (normal pour fresh install)"
    fi
    
    for bin in unifia unifia-cli; do
        if command -v "$bin" >/dev/null 2>&1; then
            VERSION=$("$bin" --version 2>/dev/null | head -1 || echo "unknown")
            add_ok "Binaire $bin: $VERSION"
        else
            add_warn "Binaire $bin: absent"
        fi
    done
}

# 6. Brand
check_brand() {
    if [ -d brand/unifia ]; then
        MANIFEST=brand/unifia/brand-manifest.json
        if [ -f "$MANIFEST" ]; then
            VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST')).get('version') or json.load(open('$MANIFEST')).get('schemaVersion') or 'unknown')" 2>/dev/null || echo "unknown")
            add_ok "Brand Unifia installé: v$VERSION"
        else
            add_warn "brand/unifia/ existe mais pas de manifest"
        fi
    else
        add_warn "brand/unifia/ absent"
    fi
}

# 7. Sécurité
check_security() {
    if [ -d .git ]; then
        # Check .env*
        if git ls-files 2>/dev/null | grep -E '\.env' | grep -v '\.env\.example$' | head -1 | grep -q .; then
            add_fail "Secrets .env* leaked in git"
        else
            add_ok "No .env* in git"
        fi
        
        # Check /ee/
        EE=$(git ls-tree -r HEAD 2>/dev/null | grep -E '/ee/' | grep -v 'docs/' | wc -l | tr -d ' \n' || echo 0)
        EE=${EE:-0}
        if [ "${EE:-0}" -gt 0 ] 2>/dev/null; then
            add_fail "/ee/ code: $EE files"
        else
            add_ok "No /ee/ code"
        fi
    fi
}

# 8. Scripts
check_scripts() {
    for s in unifia-migrate.sh unifia-verify.sh unifia-install.sh unifia-doctor.sh; do
        if [ -f "scripts/$s" ]; then
            if [ -x "scripts/$s" ]; then
                add_ok "Script exécutable: $s"
            else
                add_warn "Script exists mais pas exécutable: $s"
            fi
        else
            add_warn "Script absent: $s"
        fi
    done
}

# 9. ADRs et plans
check_governance() {
    if [ -d docs/adr ]; then
        N_ADRS=$(find docs/adr -name "*.md" | wc -l)
        add_ok "ADRs présentes: $N_ADRS"
    else
        add_warn "Dossier docs/adr/ absent"
    fi
    
    if [ -d docs/autonomy/plans ]; then
        N_PLANS=$(find docs/autonomy/plans -name "*.md" 2>/dev/null | wc -l)
        add_ok "Plans détaillés: $N_PLANS"
    else
        add_warn "Dossier docs/autonomy/plans/ absent"
    fi
}

# 10. SBOM
check_sbom() {
    if [ -f docs/autonomy/SBOM-cyclonedx.json ]; then
        add_ok "SBOM CycloneDX présent"
    else
        add_warn "SBOM absent (p1-C110)"
    fi
}

# === Output ===
output_human() {
    echo "=========================================="
    echo "  Unifia Workbench Doctor"
    echo "=========================================="
    echo
    echo "OS: $(uname -s)"
    echo "Date: $(date)"
    echo
    echo "=== Diagnostics ==="
    echo
    
    if [ "$VERBOSE" = true ]; then
        for d in "${details[@]}"; do
            echo "  $d"
        done
        echo
    else
        echo "  ✅ $((${#results_ok[@]} + 0)) PASS"
        [ $((${#results_warn[@]} + 0)) -gt 0 ] && echo "  ⚠️  $((${#results_warn[@]} + 0)) WARN"
        [ $((${#results_fail[@]} + 0)) -gt 0 ] && echo "  ❌ $((${#results_fail[@]} + 0)) FAIL"
        echo
        echo "  Use --verbose pour détails"
    fi
    echo
}

output_json() {
    cat <<EOF
{
  "timestamp": "$(date -Iseconds 2>/dev/null || date)",
  "os": "$(uname -s)",
  "results": {
    "pass": $((${#results_ok[@]} + 0)),
    "warn": $((${#results_warn[@]} + 0)),
    "fail": $((${#results_fail[@]} + 0))
  },
  "details": [
EOF
items=""
first=true
for x in "${results_ok[@]}"; do
    if [ "$first" = true ]; then first=false; else items+=",\n"; fi
    items+="    \"OK: $x\""
done
for x in "${results_warn[@]}"; do
    if [ "$first" = true ]; then first=false; else items+=",\n"; fi
    items+="    \"WARN: $x\""
done
for x in "${results_fail[@]}"; do
    if [ "$first" = true ]; then first=false; else items+=",\n"; fi
    items+="    \"FAIL: $x\""
done
if [ -n "$items" ]; then echo -e "$items"; fi
cat <<'EOF'
  ]
}
EOF
}

# === Main ===
main() {
    detect_paths
    
    check_system
    check_network
    check_bun
    check_git
    check_unifia
    check_brand
    check_security
    check_scripts
    check_governance
    check_sbom
    
    if [ "$JSON" = true ]; then
        output_json
    else
        output_human
    fi
    
    # Exit code
    if [ $((${#results_fail[@]} + 0)) -gt 0 ]; then
        exit 1
    elif [ $((${#results_warn[@]} + 0)) -gt 0 ]; then
        exit 0
    else
        exit 0
    fi
}

main
