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

# Keep the temporary path expanded when the trap runs so cleanup remains safe
# if the temporary directory is recreated or the script is interrupted.
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$BIN_DIR"

echo "=== Preparing Android Runtime Binaries ==="
echo "Output: $RUNTIME_DIR"
echo ""

# ─── Pre-built Alpine rootfs (via WSL) ───────────────────────────────
# Chantier A: build a pre-populated Alpine aarch64 rootfs with all dev tools
# + libmusl_exec.so (LD_PRELOAD hook for sub-fork SELinux bypass).
# The tar.gz is bundled as an APK asset and extracted at first launch.
echo "[0/5] Building pre-built Alpine rootfs (via WSL)..."
ROOTFS_TAR="$RUNTIME_DIR/rootfs.tgz"
if command -v wsl.exe &>/dev/null; then
  # Running on Windows — delegate to WSL
  SCRIPT_WSL="$(wsl.exe wslpath -a "$SCRIPT_DIR/build-alpine-rootfs.sh" 2>/dev/null || echo "")"
  if [ -n "$SCRIPT_WSL" ]; then
if ! wsl.exe bash "$SCRIPT_WSL"; then
      echo "  WARNING: WSL failed; continuing without the offline Alpine rootfs."
    fi
  else
    echo "  WARNING: Could not resolve WSL path for build-alpine-rootfs.sh"
    echo "  Run manually: wsl bash /mnt/d/App/OpenCode/opencode/packages/mobile/scripts/build-alpine-rootfs.sh"
  fi
elif command -v wsl &>/dev/null; then
  # Running inside WSL directly
  if ! bash "$SCRIPT_DIR/build-alpine-rootfs.sh"; then
    echo "  WARNING: WSL rootfs build failed; continuing without the offline Alpine rootfs."
  fi
elif [ "$(uname -s)" = "Linux" ]; then
  # GitHub-hosted Linux runners have no WSL, but can build the rootfs natively.
  if ! bash "$SCRIPT_DIR/build-alpine-rootfs.sh"; then
    echo "  WARNING: Native Linux rootfs build failed; continuing without the offline Alpine rootfs."
  fi
else
  echo "  WARNING: WSL not available. Build rootfs manually and place at:"
  echo "    $ROOTFS_TAR"
fi
if [ ! -f "$ROOTFS_TAR" ] || [ ! -s "$ROOTFS_TAR" ] || [ ! -f "$RUNTIME_DIR/rootfs_version.txt" ]; then
  echo "  ERROR: rootfs.tgz not found or empty at $ROOTFS_TAR" >&2
  echo "  Build aborted: the Android APK would be unable to start its embedded runtime." >&2
  exit 1
fi
echo "  rootfs.tgz: $(du -sh "$ROOTFS_TAR" | cut -f1)"
echo ""

# ─── Bun (aarch64-linux-musl, for Android Bionic compatibility) ──────
echo "[1/6] Downloading Bun (aarch64-linux-musl)..."
BUN_URL="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64-musl.zip"
curl -fsSL "$BUN_URL" -o "$TEMP_DIR/bun.zip"
unzip -o -q "$TEMP_DIR/bun.zip" -d "$TEMP_DIR/bun-extract"
cp "$TEMP_DIR/bun-extract/bun-linux-aarch64-musl/bun" "$BIN_DIR/bun"
chmod 755 "$BIN_DIR/bun"
echo "  Bun: $(du -sh "$BIN_DIR/bun" | cut -f1)"

# ─── musl dynamic linker (required to run musl binaries on Android) ──
echo "[1b/6] Downloading musl libc + C++ runtime libs..."
LIB_DIR="$RUNTIME_DIR/lib"
mkdir -p "$LIB_DIR"

# Resolve the latest apk revision from the Alpine index. Alpine bumps `-r*`
# revisions without warning, so hardcoding breaks the download with 404.
ALPINE_INDEX="https://dl-cdn.alpinelinux.org/alpine/v3.21/main/aarch64"
resolve_apk() {
  curl -fsSL "$ALPINE_INDEX/" \
    | grep -oE "$1-[0-9][0-9.]*-r[0-9]+\.apk" \
    | sort -uV | tail -1
}

# musl dynamic linker (required to run musl-linked binaries on Android Bionic)
MUSL_APK=$(resolve_apk "musl")
curl -fsSL "$ALPINE_INDEX/$MUSL_APK" -o "$TEMP_DIR/musl.apk"
cd "$TEMP_DIR" && tar -xzf musl.apk lib/ld-musl-aarch64.so.1 2>/dev/null
cp "$TEMP_DIR/lib/ld-musl-aarch64.so.1" "$LIB_DIR/ld-musl-aarch64.so.1"
chmod 755 "$LIB_DIR/ld-musl-aarch64.so.1"
echo "  musl ($MUSL_APK): $(du -sh "$LIB_DIR/ld-musl-aarch64.so.1" | cut -f1)"

# libstdc++ and libgcc_s (Bun depends on C++ runtime, not available on Android)
LIBSTDCPP_APK=$(resolve_apk "libstdc\+\+")
LIBGCC_APK=$(resolve_apk "libgcc")
curl -fsSL "$ALPINE_INDEX/$LIBSTDCPP_APK" -o "$TEMP_DIR/libstdcpp.apk"
curl -fsSL "$ALPINE_INDEX/$LIBGCC_APK" -o "$TEMP_DIR/libgcc.apk"
cd "$TEMP_DIR" && tar -xzf libstdcpp.apk --wildcards 'usr/lib/libstdc++.so.6.*' 2>/dev/null
cd "$TEMP_DIR" && tar -xzf libgcc.apk usr/lib/libgcc_s.so.1 2>/dev/null
cp "$TEMP_DIR"/usr/lib/libstdc++.so.6.* "$LIB_DIR/libstdc++.so.6"
cp "$TEMP_DIR/usr/lib/libgcc_s.so.1" "$LIB_DIR/libgcc_s.so.1"
chmod 755 "$LIB_DIR/libstdc++.so.6" "$LIB_DIR/libgcc_s.so.1"
echo "  libstdc++: $(du -sh "$LIB_DIR/libstdc++.so.6" | cut -f1)"
echo "  libgcc_s: $(du -sh "$LIB_DIR/libgcc_s.so.1" | cut -f1)"

# ─── Git (static musl) ──────────────────────────────────────────────
# Historically downloaded from nicedoc/git-static which is now 404/empty.
# Replaced with apk add git inside the rootfs at runtime (install_extended_env)
# which produces the same result without a second download path.
# Kept as a no-op; the rootfs install is the source of truth.
echo "[2/6] Git: bundled via Alpine apk in install_extended_env (skipped here)"

# proot no longer bundled: replaced by pre-built rootfs + libmusl_exec.so
# (LD_PRELOAD interposer compiled inside Alpine chroot).
# libmusl_exec.so is included in rootfs.tar.gz at /usr/lib/libmusl_exec.so.

# ─── Ripgrep (aarch64-linux-musl) ───────────────────────────────────
echo "[3/6] Preparing Ripgrep (aarch64)..."
if [ -x "$BIN_DIR/rg" ]; then
  echo "  Ripgrep: existing compatible binary ($(du -sh "$BIN_DIR/rg" | cut -f1))"
else
  echo "  WARNING: no compatible aarch64 ripgrep binary is bundled; code search will use its fallback."
fi
# ─── Bash (static musl from Alpine) ─────────────────────────────────
echo "[4/6] Downloading Bash (static musl)..."
# Use a pre-built static bash or build from Alpine package
BASH_URL="https://github.com/robxu9/bash-static/releases/latest/download/bash-linux-aarch64"
if curl -fsSL "$BASH_URL" -o "$BIN_DIR/bash" 2>/dev/null; then
  chmod 755 "$BIN_DIR/bash"
  echo "  Bash: $(du -sh "$BIN_DIR/bash" | cut -f1)"
else
  echo "  WARNING: Static bash not available, skipping."
fi

# ─── OpenCode CLI Bundle ─────────────────────────────────────────────
# DEBT: D-17 — single source of truth for CLI bundling is
# scripts/bundle-mobile.mjs. It inlines the SQL migrations by PREPENDING
# `globalThis.OPENCODE_MIGRATIONS = …` (the `--define` approach used here
# before did not survive bun's module reordering, so db.ts could init before
# the migrations were defined — see the script header) and syncs the bundle
# into the gen/android assets dir. Maintaining a second `bun build` here risked
# shipping a stale CLI on local builds vs CI.
echo "[5/6] Bundling OpenCode CLI (via scripts/bundle-mobile.mjs)..."
OPENCODE_DIR="$(cd "$MOBILE_DIR/../opencode" && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"

if [ -f "$OPENCODE_DIR/src/mobile-entry.ts" ]; then
  node "$REPO_ROOT/scripts/bundle-mobile.mjs" --outdir "$RUNTIME_DIR"

  # Create shim for @parcel/watcher (native module not available on Android).
  # bundle-mobile.mjs externalizes it; this provides the stub it resolves to.
  mkdir -p "$RUNTIME_DIR/node_modules/@parcel/watcher"
  echo 'export function createWrapper() { return undefined }' > "$RUNTIME_DIR/node_modules/@parcel/watcher/wrapper.js"
  echo '{"name":"@parcel/watcher","version":"0.0.0","main":"wrapper.js"}' > "$RUNTIME_DIR/node_modules/@parcel/watcher/package.json"

  echo "  CLI: $(du -sh "$RUNTIME_DIR/opencode-cli.js" 2>/dev/null | cut -f1 || echo "error")"
else
  echo "  WARNING: mobile-entry.ts not found at $OPENCODE_DIR/src/mobile-entry.ts"
  echo "  Make sure packages/opencode/src/mobile-entry.ts exists."
fi

echo ""
echo "=== Runtime Prepared ==="
echo "Total size: $(du -sh "$RUNTIME_DIR" | cut -f1)"
ls -lh "$BIN_DIR/"
echo ""

# ─── Sync rootfs assets to Android assets dir ────────────────────────
# tauri_build::build() only runs when Rust is recompiled (not on every
# Gradle-only rebuild), so rootfs.tar.gz and rootfs_version.txt must be
# copied manually to gen/android/app/src/main/assets/runtime/.
ANDROID_ASSETS_DIR="$MOBILE_DIR/src-tauri/gen/android/app/src/main/assets/runtime"
if [ -d "$ANDROID_ASSETS_DIR" ]; then
  if [ -f "$RUNTIME_DIR/rootfs.tgz" ]; then
    cp "$RUNTIME_DIR/rootfs.tgz" "$ANDROID_ASSETS_DIR/rootfs.tgz"
    echo "Synced rootfs.tgz → Android assets ($(du -sh "$ANDROID_ASSETS_DIR/rootfs.tgz" | cut -f1))"
  fi
  if [ -f "$RUNTIME_DIR/rootfs_version.txt" ]; then
    cp "$RUNTIME_DIR/rootfs_version.txt" "$ANDROID_ASSETS_DIR/rootfs_version.txt"
    echo "Synced rootfs_version.txt → Android assets"
  fi
fi

echo "Ready for: ORT_LIB_LOCATION=D:/tmp/ort-android bun tauri android build --target aarch64"
