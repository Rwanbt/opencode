#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../src-tauri"

echo "Building OpenCode Mobile for iOS..."
echo "Requires: Xcode and Apple Developer account"

cargo tauri ios build "$@"

echo "Build complete. IPA at src-tauri/gen/apple/build/"
