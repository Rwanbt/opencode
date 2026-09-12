#!/usr/bin/env bash
# unifia-install.sh — Installation from scratch d'Unifia
# Usage: bash scripts/unifia-install.sh [--from-source|--download]
# Auteur: Hermes Agent (MiniMax M3) pour Unifia Workbench V3
# Date: 2026-07-31

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

# === Mode ===
MODE="from-source"
case "${1:-}" in
    --download) MODE="download" ;;
    --from-source) MODE="from-source" ;;
    --help|-h)
        echo "Usage: $0 [--from-source|--download]"
        echo "  --from-source: build from source (default)"
        echo "  --download: download pre-built binary"
        exit 0
        ;;
    "") MODE="from-source" ;;
    *) warn "Mode inconnu: $1, utilisation de from-source" ;;
esac

echo "=== Unifia Workbench Installation ==="
echo "Mode: $MODE"
echo

# === Arch detection ===
ARCH=$(uname -m)
case "$ARCH" in
    x86_64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) fail "Architecture non supportée: $ARCH"; exit 1 ;;
esac

# === OS detection ===
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
    linux) OS="linux" ;;
    darwin) OS="macos" ;;
    *) fail "OS non supporté: $OS"; exit 1 ;;
esac

info "OS: $OS, Arch: $ARCH"

# === Path detection ===
if [ "$OS" = "macos" ]; then
    CONFIG_DIR="$HOME/Library/Application Support"
    BIN_DIR="/usr/local/bin"
else
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
    BIN_DIR="$HOME/.local/bin"
fi

info "Config dir: $CONFIG_DIR"
info "Bin dir: $BIN_DIR"
echo

# === Pre-flight checks ===
info "Pre-flight checks..."

# Check required tools
for tool in curl tar; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        fail "$tool not found. Please install it first."
        exit 1
    fi
done
ok "Required tools (curl, tar) present"

# Check Bun (for source build)
if [ "$MODE" = "from-source" ]; then
    if ! command -v bun >/dev/null 2>&1; then
        warn "Bun not found. Installing..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        if ! command -v bun >/dev/null 2>&1; then
            fail "Failed to install Bun. Please install manually."
            exit 1
        fi
    fi
    ok "Bun $(bun --version) present"
fi

# === Install ===
case "$MODE" in
    download)
        info "Downloading pre-built binary..."
        URL="https://github.com/Rwanbt/unifia/releases/latest/download/unifia-${OS}-${ARCH}.tar.gz"
        info "URL: $URL"
        warn "À implémenter quand la release v1.0.0 sera publiée"
        fail "Download mode not yet implemented"
        exit 1
        ;;
    from-source)
        info "Building from source..."
        warn "À implémenter en Phase 2 (voir TASK-GRAPH-v2.0.yaml)"
        warn "Pour l'instant, voir https://github.com/Rwanbt/unifia#installation"
        echo
        info "Pour tester sans build:"
        echo "  bun install && bun turbo build"
        echo "  ou"
        echo "  cd packages/unifia && bun run build"
        exit 0
        ;;
esac

# === Post-install ===
echo
echo "=== Post-install ==="

# Create config dirs
mkdir -p "$CONFIG_DIR/unifia"
ok "Created $CONFIG_DIR/unifia"

# Install scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for s in unifia-migrate.sh unifia-verify.sh; do
    if [ -f "$SCRIPT_DIR/$s" ]; then
        chmod +x "$SCRIPT_DIR/$s"
        ok "Made executable: $s"
    fi
done

# Validate
echo
echo "=== Validation ==="
if [ -f "$SCRIPT_DIR/unifia-verify.sh" ]; then
    bash "$SCRIPT_DIR/unifia-verify.sh"
fi

echo
echo "=== Installation complete ==="
echo "Next steps:"
echo "  1. Run 'unifia --version' to verify the install"
echo "  2. Run 'unifia --help' to see available commands"
echo "  3. If migrating from OpenCode: bash scripts/unifia-migrate.sh --apply"
echo "  4. Check the docs: https://github.com/Rwanbt/unifia"
echo
ok "Unifia is ready to use!"
