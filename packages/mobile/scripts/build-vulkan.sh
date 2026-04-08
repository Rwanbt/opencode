#!/bin/bash
set -euo pipefail

ANDROID_NDK=/home/aes/android-ndk
SRC=/home/aes/llama-vulkan-build
JNILIBS="/mnt/d/App/OpenCode/opencode/packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"

echo "=== Cloning llama.cpp b8683 ==="
rm -rf "$SRC"
git clone --depth 1 --branch b8683 https://github.com/ggml-org/llama.cpp.git "$SRC"

echo "=== Configuring with Vulkan GPU support ==="
cd "$SRC"
cmake \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-28 \
  -DCMAKE_C_FLAGS="-march=armv8.2a+dotprod+fp16" \
  -DCMAKE_CXX_FLAGS="-march=armv8.2a+dotprod+fp16" \
  -DGGML_OPENMP=OFF \
  -DGGML_LLAMAFILE=OFF \
  -DGGML_VULKAN=ON \
  -DVulkan_INCLUDE_DIR=/usr/include \
  -DVulkan_LIBRARY="$ANDROID_NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/29/libvulkan.so" \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=ON \
  -DLLAMA_BUILD_SERVER=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -B build-vk \
  -G Ninja

echo "=== Building llama-server with Vulkan (558 targets)... ==="
cmake --build build-vk --config Release -j$(nproc) --target llama-server

echo "=== Copying binaries to jniLibs ==="
SERVER=$(find build-vk -name "llama-server" -type f | head -1)
if [ -n "$SERVER" ]; then
  cp "$SERVER" "$JNILIBS/libllama_server.so"
  chmod 755 "$JNILIBS/libllama_server.so"
  echo "  Server: $(ls -lh "$JNILIBS/libllama_server.so")"
else
  echo "ERROR: llama-server not found!"
  exit 1
fi

# Copy all shared libs (ggml, ggml-vulkan, llama, etc.)
for so in $(find build-vk -name "*.so" -type f); do
  name=$(basename "$so")
  [[ "$name" != lib* ]] && name="lib${name}"
  cp "$so" "$JNILIBS/$name"
  echo "  Copied: $name ($(ls -lh "$so" | awk '{print $5}'))"
done

echo ""
echo "=== Verification ==="
echo "Vulkan symbols: $(strings "$JNILIBS/libllama_server.so" | grep -ci 'ggml_vk\|vulkan')"
ls -lh "$JNILIBS/libggml-vulkan.so" 2>/dev/null && echo "ggml-vulkan.so present!" || echo "WARNING: no separate ggml-vulkan.so"
echo ""
echo "=== BUILD COMPLETE ==="
