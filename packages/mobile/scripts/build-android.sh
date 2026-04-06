#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../src-tauri"

echo "Building OpenCode Mobile for Android..."
echo "Requires: Android SDK, NDK, and JAVA_HOME set"

cargo tauri android build "$@"

echo "Build complete. APK at src-tauri/gen/android/app/build/outputs/apk/"
