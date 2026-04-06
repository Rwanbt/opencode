#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building OpenCode Mobile for Android..."
echo "Requires: Android SDK, NDK, and JAVA_HOME set"
echo ""

# Prepare embedded runtime binaries (bun, git, bash, rg, opencode-cli.js)
if [ ! -f "$SCRIPT_DIR/../src-tauri/assets/runtime/bin/bun" ]; then
  echo "Preparing Android runtime (first build)..."
  bash "$SCRIPT_DIR/prepare-android-runtime.sh"
else
  echo "Runtime binaries already prepared. Use prepare-android-runtime.sh to refresh."
fi

echo ""
cd "$SCRIPT_DIR/../src-tauri"
cargo tauri android build "$@"

echo "Build complete. APK at src-tauri/gen/android/app/build/outputs/apk/"
