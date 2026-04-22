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
    wsl.exe bash "$SCRIPT_WSL"
  else
    echo "  WARNING: Could not resolve WSL path for build-alpine-rootfs.sh"
    echo "  Run manually: wsl bash /mnt/d/App/OpenCode/opencode/packages/mobile/scripts/build-alpine-rootfs.sh"
  fi
elif command -v wsl &>/dev/null; then
  # Running inside WSL directly
  bash "$SCRIPT_DIR/build-alpine-rootfs.sh"
else
  echo "  WARNING: WSL not available. Build rootfs manually and place at:"
  echo "    $ROOTFS_TAR"
fi
if [ -f "$ROOTFS_TAR" ]; then
  echo "  rootfs.tar.gz: $(du -sh "$ROOTFS_TAR" | cut -f1)"
else
  echo "  WARNING: rootfs.tar.gz not found — APK will lack offline dev tools."
fi
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
echo "[3/6] Downloading Ripgrep (aarch64-linux-musl)..."
RG_VERSION=$(curl -fsSL "https://api.github.com/repos/BurntSushi/ripgrep/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": "\(.*\)".*/\1/')
RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-unknown-linux-musl.tar.gz"
curl -fsSL "$RG_URL" -o "$TEMP_DIR/rg.tar.gz"
tar -xzf "$TEMP_DIR/rg.tar.gz" -C "$TEMP_DIR"
find "$TEMP_DIR" -name "rg" -type f | head -1 | xargs -I{} cp {} "$BIN_DIR/rg"
chmod 755 "$BIN_DIR/rg"
echo "  Ripgrep: $(du -sh "$BIN_DIR/rg" | cut -f1)"

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
echo "[5/6] Bundling OpenCode CLI..."
OPENCODE_DIR="$(cd "$MOBILE_DIR/../opencode" && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"

if [ -f "$OPENCODE_DIR/src/mobile-entry.ts" ]; then
  cd "$REPO_ROOT"

  # Inline SQL migrations so the bundle doesn't need filesystem access at runtime
  MIGRATIONS=$(node -e "
    const fs=require('fs'),p=require('path'),d=p.join('packages/opencode/migration');
    const r=fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).map(n=>{
      const f=p.join(d,n,'migration.sql');if(!fs.existsSync(f))return null;
      const m=/^(\d{14})/.exec(n);
      const t=m?Date.UTC(+m[1].slice(0,4),+m[1].slice(4,6)-1,+m[1].slice(6,8),+m[1].slice(8,10),+m[1].slice(10,12),+m[1].slice(12,14)):0;
      return{sql:fs.readFileSync(f,'utf8'),timestamp:t,name:n}
    }).filter(Boolean);console.log(JSON.stringify(r))")

  # Bundle the mobile-specific entry point (no TUI dependencies)
  bun build packages/opencode/src/mobile-entry.ts \
    --target=bun \
    --outdir="$RUNTIME_DIR" \
    --external "@parcel/watcher" \
    --external "@parcel/watcher/wrapper" \
    --external "@opentui/core" \
    --external "@opentui/solid" \
    --define "OPENCODE_MIGRATIONS=$MIGRATIONS" \
    2>&1 || {
      echo "  ERROR: Bun build failed."
      exit 1
    }

  # Rename entry to opencode-cli.js
  if [ -f "$RUNTIME_DIR/mobile-entry.js" ]; then
    mv "$RUNTIME_DIR/mobile-entry.js" "$RUNTIME_DIR/opencode-cli.js"
  fi

  # Create shim for @parcel/watcher (native module not available on Android)
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
