#!/usr/bin/env bash
set -euo pipefail

# Cross-compile bun-pty's librust_pty for aarch64-linux-android.
# This native library enables pseudo-terminal (PTY) support on Android,
# allowing the mobile app to offer an interactive terminal.
#
# Requires: Android NDK (auto-detected), Rust with aarch64-linux-android target

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$MOBILE_DIR/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
TEMP_DIR="$(mktemp -d)"
trap "rm -rf $TEMP_DIR" EXIT

# ─── Detect Android NDK ──────────────────────────────────────────────
NDK="${ANDROID_NDK:-${NDK_HOME:-}}"
if [ -z "$NDK" ]; then
  for candidate in \
    "$HOME/Android/Sdk/ndk/"* \
    "$LOCALAPPDATA/Android/Sdk/ndk/"* \
    "/c/Users/$USER/AppData/Local/Android/Sdk/ndk/"* \
    "$ANDROID_HOME/ndk/"*; do
    if [ -d "$candidate" ]; then
      NDK="$candidate"
      break
    fi
  done
fi

if [ -z "$NDK" ] || [ ! -d "$NDK" ]; then
  echo "ERROR: Android NDK not found. Set ANDROID_NDK or NDK_HOME."
  exit 1
fi

echo "=== Building librust_pty for aarch64-linux-android ==="
echo "NDK: $NDK"
echo "Output: $OUTPUT_DIR"
echo ""

# ─── Clone bun-pty ────────────────────────────────────────────────────
BUN_PTY_VERSION="v0.4.8"
echo "[1/4] Cloning bun-pty ${BUN_PTY_VERSION}..."
git clone --depth 1 --branch "$BUN_PTY_VERSION" \
  https://github.com/sursaone/bun-pty.git "$TEMP_DIR/bun-pty" 2>&1 || {
  # If tag doesn't exist, clone main
  echo "  Tag not found, cloning main..."
  git clone --depth 1 https://github.com/sursaone/bun-pty.git "$TEMP_DIR/bun-pty" 2>&1
}

RUST_DIR="$TEMP_DIR/bun-pty/rust-pty"
if [ ! -f "$RUST_DIR/Cargo.toml" ]; then
  echo "ERROR: rust-pty/Cargo.toml not found in bun-pty repo"
  exit 1
fi

# ─── Configure NDK toolchain for Rust ─────────────────────────────────
echo "[2/4] Configuring NDK toolchain..."

# Find the NDK toolchain
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt"
if [ -d "$TOOLCHAIN/linux-x86_64" ]; then
  TOOLCHAIN="$TOOLCHAIN/linux-x86_64"
elif [ -d "$TOOLCHAIN/windows-x86_64" ]; then
  TOOLCHAIN="$TOOLCHAIN/windows-x86_64"
elif [ -d "$TOOLCHAIN/darwin-x86_64" ]; then
  TOOLCHAIN="$TOOLCHAIN/darwin-x86_64"
else
  echo "ERROR: Cannot find NDK toolchain prebuilt directory"
  exit 1
fi

# Add Rust target
rustup target add aarch64-linux-android 2>/dev/null || true

# Set up cross-compilation environment
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$TOOLCHAIN/bin/aarch64-linux-android24-clang"
export CC_aarch64_linux_android="$TOOLCHAIN/bin/aarch64-linux-android24-clang"
export AR_aarch64_linux_android="$TOOLCHAIN/bin/llvm-ar"

# Windows: use .cmd extension
if [[ "$OSTYPE" == "msys"* ]] || [[ "$OSTYPE" == "win"* ]] || [[ "$(uname -s)" == MINGW* ]]; then
  export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$TOOLCHAIN/bin/aarch64-linux-android24-clang.cmd"
  export CC_aarch64_linux_android="$TOOLCHAIN/bin/aarch64-linux-android24-clang.cmd"
  export AR_aarch64_linux_android="$TOOLCHAIN/bin/llvm-ar.exe"
fi

# ─── Build ────────────────────────────────────────────────────────────
echo "[3/4] Building for aarch64-linux-android (release)..."
cd "$RUST_DIR"
cargo build --release --target aarch64-linux-android 2>&1

# ─── Copy output ──────────────────────────────────────────────────────
echo "[4/4] Copying to jniLibs..."
BUILT_LIB="$RUST_DIR/target/aarch64-linux-android/release/librust_pty.so"
if [ ! -f "$BUILT_LIB" ]; then
  echo "ERROR: Build succeeded but librust_pty.so not found at $BUILT_LIB"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cp "$BUILT_LIB" "$OUTPUT_DIR/librust_pty.so"
echo ""
echo "=== Done ==="
echo "  $(du -sh "$OUTPUT_DIR/librust_pty.so" | cut -f1) $OUTPUT_DIR/librust_pty.so"
echo ""
echo "The library will be automatically loaded by setting BUN_PTY_LIB at runtime."
