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

# Ensure ONNX Runtime shared library is available for Kokoro TTS.
# Version MUST match the one the Rust `ort` crate was built against. The
# pinned crate version 2.0.0-rc.10 targets ORT 1.19.x — bundling 1.22.0
# causes `dlopen failed: cannot locate symbol OrtGetApiBase` at launch
# because the Android bionic linker doesn't resolve versioned symbols
# across a DT_NEEDED gap (the .so exports OrtGetApiBase@@VERS_1.22.0 but
# libopencode_mobile_lib.so's undefined reference is VERS_1.19.2).
JNILIBS="$SCRIPT_DIR/../src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
ORT_VERSION="1.19.2"
ORT_SO="$JNILIBS/libonnxruntime.so"
if [ ! -f "$ORT_SO" ]; then
  echo "Downloading ONNX Runtime $ORT_VERSION for Android arm64..."
  # Try Maven Central (official Qualcomm/Microsoft distribution)
  ORT_AAR_URL="https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/${ORT_VERSION}/onnxruntime-android-${ORT_VERSION}.aar"
  mkdir -p "$JNILIBS"
  TMPDIR=$(mktemp -d)
  echo "Fetching from Maven Central..."
  if curl -sL "$ORT_AAR_URL" -o "$TMPDIR/ort.aar"; then
    cd "$TMPDIR"
    unzip -q ort.aar "jni/arm64-v8a/libonnxruntime.so" 2>/dev/null || true
    if [ -f "jni/arm64-v8a/libonnxruntime.so" ]; then
      cp "jni/arm64-v8a/libonnxruntime.so" "$ORT_SO"
      echo "ONNX Runtime installed: $(ls -lh "$ORT_SO" | awk '{print $5}')"
    else
      echo "WARNING: Could not extract libonnxruntime.so from AAR"
      echo "Please manually place libonnxruntime.so (arm64-v8a) in $JNILIBS/"
    fi
    rm -rf "$TMPDIR"
  else
    echo "WARNING: Failed to download ONNX Runtime"
    echo "Please set ORT_LIB_LOCATION or place libonnxruntime.so in $JNILIBS/"
    rm -rf "$TMPDIR"
  fi
  cd "$SCRIPT_DIR"
else
  echo "ONNX Runtime already present."
fi

# Set ORT_LIB_LOCATION for cargo build if not already set
if [ -z "${ORT_LIB_LOCATION:-}" ]; then
  # Check multiple possible locations
  ORT_EXTRACTED="$SCRIPT_DIR/../src-tauri/ort-android/extracted/jni/arm64-v8a"
  if [ -f "$ORT_EXTRACTED/libonnxruntime.so" ]; then
    export ORT_LIB_LOCATION="$ORT_EXTRACTED"
    echo "Using ORT from ort-android/extracted/"
  elif [ -f "$ORT_SO" ]; then
    export ORT_LIB_LOCATION="$JNILIBS"
    echo "Using ORT from jniLibs/"
  fi
  export ORT_PREFER_DYNAMIC_LINK=1
fi

echo ""
cd "$SCRIPT_DIR/../src-tauri"
# Build only aarch64 by default (ORT only has arm64-v8a binaries)
if echo "$@" | grep -q -- "--target"; then
  cargo tauri android build "$@"
else
  cargo tauri android build --target aarch64 "$@"
fi

echo "Build complete. APK at src-tauri/gen/android/app/build/outputs/apk/"
