#!/usr/bin/env bash
set -euo pipefail

# Prepare static aarch64-linux binaries for the Android embedded runtime.
# These are bundled into the APK and extracted at first launch.
# All binaries are statically linked (musl) for Android Bionic compatibility.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$MOBILE_DIR/src-tauri/assets/runtime"
BIN_DIR="$RUNTIME_DIR/bin"
TEMP_DIR="$(mktemp -d)"

trap "rm -rf $TEMP_DIR" EXIT

mkdir -p "$BIN_DIR"

echo "=== Preparing Android Runtime Binaries ==="
echo "Output: $RUNTIME_DIR"
echo ""

# ─── Bun (aarch64-linux) ────────────────────────────────────────────
echo "[1/5] Downloading Bun (aarch64-linux)..."
BUN_URL="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64.zip"
curl -fsSL "$BUN_URL" -o "$TEMP_DIR/bun.zip"
unzip -o -q "$TEMP_DIR/bun.zip" -d "$TEMP_DIR/bun-extract"
cp "$TEMP_DIR/bun-extract/bun-linux-aarch64/bun" "$BIN_DIR/bun"
chmod 755 "$BIN_DIR/bun"
echo "  Bun: $(du -sh "$BIN_DIR/bun" | cut -f1)"

# ─── Git (static musl) ──────────────────────────────────────────────
echo "[2/5] Downloading Git (aarch64-linux-musl static)..."
GIT_URL="https://github.com/nicedoc/git-static/releases/latest/download/git-aarch64-linux-musl.tar.gz"
if curl -fsSL "$GIT_URL" -o "$TEMP_DIR/git.tar.gz" 2>/dev/null; then
  tar -xzf "$TEMP_DIR/git.tar.gz" -C "$TEMP_DIR"
  # The archive may contain git in various locations
  find "$TEMP_DIR" -name "git" -type f -executable | head -1 | xargs -I{} cp {} "$BIN_DIR/git"
  chmod 755 "$BIN_DIR/git"
  echo "  Git: $(du -sh "$BIN_DIR/git" | cut -f1)"
else
  echo "  WARNING: Git static binary not available, skipping."
  echo "  Git operations will not be available on mobile."
fi

# ─── Ripgrep (aarch64-linux-musl) ───────────────────────────────────
echo "[3/5] Downloading Ripgrep (aarch64-linux-musl)..."
RG_VERSION=$(curl -fsSL "https://api.github.com/repos/BurntSushi/ripgrep/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": "\(.*\)".*/\1/')
RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-unknown-linux-musl.tar.gz"
curl -fsSL "$RG_URL" -o "$TEMP_DIR/rg.tar.gz"
tar -xzf "$TEMP_DIR/rg.tar.gz" -C "$TEMP_DIR"
find "$TEMP_DIR" -name "rg" -type f | head -1 | xargs -I{} cp {} "$BIN_DIR/rg"
chmod 755 "$BIN_DIR/rg"
echo "  Ripgrep: $(du -sh "$BIN_DIR/rg" | cut -f1)"

# ─── Bash (static musl from Alpine) ─────────────────────────────────
echo "[4/5] Downloading Bash (static musl)..."
# Use a pre-built static bash or build from Alpine package
BASH_URL="https://github.com/robxu9/bash-static/releases/latest/download/bash-linux-aarch64"
if curl -fsSL "$BASH_URL" -o "$BIN_DIR/bash" 2>/dev/null; then
  chmod 755 "$BIN_DIR/bash"
  echo "  Bash: $(du -sh "$BIN_DIR/bash" | cut -f1)"
else
  echo "  WARNING: Static bash not available, skipping."
fi

# ─── OpenCode CLI Bundle ─────────────────────────────────────────────
echo "[5/5] Bundling OpenCode CLI..."
OPENCODE_DIR="$(cd "$MOBILE_DIR/../opencode" && pwd)"
if [ -f "$OPENCODE_DIR/src/index.ts" ]; then
  cd "$OPENCODE_DIR"
  # Bundle as a single JS file that Bun can execute
  bun build src/index.ts \
    --target=bun \
    --outfile="$RUNTIME_DIR/opencode-cli.js" \
    --define "OPENCODE_VERSION='\"mobile-embedded\"'" \
    --external "@parcel/watcher" \
    --external "@opentui/core" \
    2>/dev/null || {
      echo "  WARNING: Bun build failed, trying alternative approach..."
      # Fallback: copy the source and let bun run it directly
      echo '#!/usr/bin/env bun' > "$RUNTIME_DIR/opencode-cli.js"
      echo 'import "./packages/opencode/src/index.ts"' >> "$RUNTIME_DIR/opencode-cli.js"
    }
  echo "  CLI: $(du -sh "$RUNTIME_DIR/opencode-cli.js" 2>/dev/null | cut -f1 || echo "fallback mode")"
else
  echo "  WARNING: OpenCode source not found at $OPENCODE_DIR"
fi

echo ""
echo "=== Runtime Prepared ==="
echo "Total size: $(du -sh "$RUNTIME_DIR" | cut -f1)"
ls -lh "$BIN_DIR/"
echo ""
echo "Ready for: cargo tauri android build"
