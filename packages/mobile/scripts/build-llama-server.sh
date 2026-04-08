#!/usr/bin/env bash
set -euo pipefail

# Build llama-server (llama.cpp HTTP server) for aarch64 Android.
#
# Two strategies (in order of preference):
#   1. NDK cross-compile  - produces a bionic-linked binary that runs natively on Android
#   2. musl cross-compile - produces a musl-linked binary that needs libmusl_linker.so
#
# The resulting binary is placed in jniLibs/arm64-v8a/libllama_server.so
# (named as lib*.so so Android's PackageManager extracts it with +x).
#
# Usage:
#   ./build-llama-server.sh                    # auto-detect NDK
#   ANDROID_NDK=/path/to/ndk ./build-llama-server.sh   # explicit NDK
#   STRATEGY=musl ./build-llama-server.sh      # force musl build
#
# Requirements (WSL Ubuntu):
#   NDK strategy:  Android NDK r26+ (cmake, ninja bundled)
#   musl strategy: aarch64-linux-musl-cross toolchain
#                  sudo apt install cmake ninja-build
#                  (or install musl-cross-make / download from musl.cc)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
JNILIBS_DIR="$MOBILE_DIR/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"

LLAMA_CPP_REPO="https://github.com/ggml-org/llama.cpp.git"
LLAMA_CPP_TAG="${LLAMA_CPP_TAG:-b8683}"   # pin to known-good release

BUILD_DIR="/tmp/llama-cpp-android-build"
OUTPUT="$JNILIBS_DIR/libllama_server.so"

NPROC="${NPROC:-$(nproc 2>/dev/null || echo 4)}"

# ─── Detect Strategy ───────────────────────────────────────────────────
detect_ndk() {
  # Check common NDK locations
  local candidates=(
    "${ANDROID_NDK:-}"
    "${ANDROID_NDK_HOME:-}"
    "${ANDROID_NDK_ROOT:-}"
    "/usr/local/lib/android/sdk/ndk/27.0.12077973"
    "$HOME/Android/Sdk/ndk/27.0.12077973"
    "$HOME/android-ndk"
    "/opt/android-ndk"
  )
  for dir in "${candidates[@]}"; do
    if [ -n "${dir:-}" ] && [ -f "$dir/build/cmake/android.toolchain.cmake" ]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

STRATEGY="${STRATEGY:-auto}"
if [ "$STRATEGY" = "auto" ]; then
  if NDK_PATH=$(detect_ndk 2>/dev/null); then
    STRATEGY="ndk"
  elif command -v aarch64-linux-musl-gcc &>/dev/null; then
    STRATEGY="musl"
  else
    echo "ERROR: No Android NDK found and no musl cross-compiler available."
    echo ""
    echo "Option 1 (recommended): Install Android NDK and set ANDROID_NDK="
    echo "  export ANDROID_NDK=\$HOME/Android/Sdk/ndk/27.0.12077973"
    echo ""
    echo "Option 2: Install musl cross-compiler"
    echo "  wget https://musl.cc/aarch64-linux-musl-cross.tgz"
    echo "  tar xf aarch64-linux-musl-cross.tgz -C /opt"
    echo "  export PATH=/opt/aarch64-linux-musl-cross/bin:\$PATH"
    exit 1
  fi
fi

echo "=== Building llama-server for aarch64 Android ==="
echo "Strategy: $STRATEGY"
echo "Tag:      $LLAMA_CPP_TAG"
echo "Output:   $OUTPUT"
echo ""

# ─── Clone / Update Source ─────────────────────────────────────────────
if [ -d "$BUILD_DIR/llama.cpp" ]; then
  echo "[1/3] Updating llama.cpp source..."
  cd "$BUILD_DIR/llama.cpp"
  git fetch --tags
  git checkout "$LLAMA_CPP_TAG"
else
  echo "[1/3] Cloning llama.cpp ($LLAMA_CPP_TAG)..."
  mkdir -p "$BUILD_DIR"
  git clone --depth 1 --branch "$LLAMA_CPP_TAG" "$LLAMA_CPP_REPO" "$BUILD_DIR/llama.cpp"
fi

SRC_DIR="$BUILD_DIR/llama.cpp"

# ─── NDK Build ─────────────────────────────────────────────────────────
build_ndk() {
  NDK_PATH=$(detect_ndk)
  echo "[2/3] Configuring with Android NDK..."
  echo "  NDK: $NDK_PATH"

  cd "$SRC_DIR"
  rm -rf build-android
  cmake \
    -DCMAKE_TOOLCHAIN_FILE="$NDK_PATH/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI=arm64-v8a \
    -DANDROID_PLATFORM=android-28 \
    -DCMAKE_C_FLAGS="-march=armv8.2a+dotprod+fp16" \
    -DCMAKE_CXX_FLAGS="-march=armv8.2a+dotprod+fp16" \
    -DGGML_OPENMP=OFF \
    -DGGML_LLAMAFILE=OFF \
    -DGGML_VULKAN=ON \
    -DVulkan_INCLUDE_DIR=/usr/include \
    -DVulkan_LIBRARY=$NDK_PATH/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/29/libvulkan.so \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=ON \
    -DLLAMA_BUILD_SERVER=ON \
    -DCMAKE_BUILD_TYPE=Release \
    -B build-android \
    -G Ninja

  echo "[3/3] Building llama-server..."
  cmake --build build-android --config Release -j"$NPROC" --target llama-server

  # The binary location depends on cmake version
  local server_bin
  server_bin=$(find build-android -name "llama-server" -type f | head -1)
  if [ -z "$server_bin" ]; then
    echo "ERROR: llama-server binary not found after build"
    find build-android -name "llama*" -type f
    exit 1
  fi

  mkdir -p "$JNILIBS_DIR"
  cp "$server_bin" "$OUTPUT"

  # Also copy shared libs if any (NDK builds may produce .so files)
  local lib_count=0
  for so in build-android/src/*.so build-android/ggml/src/*.so; do
    if [ -f "$so" ]; then
      local name
      name=$(basename "$so")
      # Prefix with lib if needed for Android extraction
      if [[ "$name" != lib* ]]; then
        name="lib${name}"
      fi
      cp "$so" "$JNILIBS_DIR/$name"
      echo "  Also copied: $name"
      lib_count=$((lib_count + 1))
    fi
  done

  if [ "$lib_count" -gt 0 ]; then
    echo ""
    echo "NOTE: llama-server was built with shared libraries."
    echo "These .so files are in jniLibs and will be extracted by Android."
    echo "At runtime, set LD_LIBRARY_PATH to nativeLibraryDir before exec."
  fi
}

# ─── musl Build ────────────────────────────────────────────────────────
build_musl() {
  echo "[2/3] Configuring with musl cross-compiler..."

  # Try to find the toolchain
  local MUSL_PREFIX="aarch64-linux-musl"
  if ! command -v ${MUSL_PREFIX}-gcc &>/dev/null; then
    # Try musl.cc download
    if [ ! -d "/opt/aarch64-linux-musl-cross" ]; then
      echo "Downloading musl cross-compiler from musl.cc..."
      wget -q "https://musl.cc/aarch64-linux-musl-cross.tgz" -O /tmp/musl-cross.tgz
      sudo tar xf /tmp/musl-cross.tgz -C /opt/
      rm /tmp/musl-cross.tgz
    fi
    export PATH="/opt/aarch64-linux-musl-cross/bin:$PATH"
  fi

  cd "$SRC_DIR"
  rm -rf build-musl

  cmake \
    -DCMAKE_SYSTEM_NAME=Linux \
    -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
    -DCMAKE_C_COMPILER=${MUSL_PREFIX}-gcc \
    -DCMAKE_CXX_COMPILER=${MUSL_PREFIX}-g++ \
    -DCMAKE_C_FLAGS="-march=armv8.2-a+dotprod+fp16 -static" \
    -DCMAKE_CXX_FLAGS="-march=armv8.2-a+dotprod+fp16 -static" \
    -DCMAKE_EXE_LINKER_FLAGS="-static -static-libgcc -static-libstdc++" \
    -DGGML_OPENMP=OFF \
    -DGGML_LLAMAFILE=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=ON \
    -DLLAMA_BUILD_SERVER=ON \
    -DCMAKE_BUILD_TYPE=Release \
    -B build-musl \
    -G "Unix Makefiles"

  echo "[3/3] Building llama-server (static musl)..."
  cmake --build build-musl --config Release -j"$NPROC" --target llama-server

  local server_bin
  server_bin=$(find build-musl -name "llama-server" -type f | head -1)
  if [ -z "$server_bin" ]; then
    echo "ERROR: llama-server binary not found after build"
    find build-musl -name "llama*" -type f
    exit 1
  fi

  mkdir -p "$JNILIBS_DIR"
  cp "$server_bin" "$OUTPUT"
}

# ─── Execute Build ─────────────────────────────────────────────────────
case "$STRATEGY" in
  ndk)  build_ndk ;;
  musl) build_musl ;;
  *)
    echo "ERROR: Unknown strategy '$STRATEGY'. Use 'ndk' or 'musl'."
    exit 1
    ;;
esac

chmod 755 "$OUTPUT"

echo ""
echo "=== Build Complete ==="
echo "Binary: $OUTPUT"
echo "Size:   $(du -sh "$OUTPUT" | cut -f1)"
file "$OUTPUT"
echo ""

# Verify it's the right architecture
if command -v readelf &>/dev/null; then
  ARCH=$(readelf -h "$OUTPUT" 2>/dev/null | grep Machine | head -1 || true)
  echo "Arch: $ARCH"
fi

echo ""
if [ "$STRATEGY" = "ndk" ]; then
  echo "The binary is bionic-linked (Android native). Launch directly:"
  echo '  Runtime.exec(nativeLibraryDir + "/libllama_server.so", args)'
  echo ""
  echo "If shared libs were produced, set LD_LIBRARY_PATH first:"
  echo '  env LD_LIBRARY_PATH=nativeLibraryDir libllama_server.so --host 127.0.0.1 --port 8080 -m model.gguf'
elif [ "$STRATEGY" = "musl" ]; then
  echo "The binary is statically linked (musl). Launch via musl linker or directly:"
  echo '  libmusl_linker.so --library-path {lib_path} libllama_server.so --host 127.0.0.1 --port 8080 -m model.gguf'
  echo ""
  echo "Or if fully static, run directly:"
  echo '  libllama_server.so --host 127.0.0.1 --port 8080 -m model.gguf'
fi
