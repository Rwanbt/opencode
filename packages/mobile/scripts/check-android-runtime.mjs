import { existsSync, statSync } from "node:fs"
import { resolve } from "node:path"

const runtimeFiles = [
  resolve("src-tauri/assets/runtime/rootfs.tgz"),
  resolve("src-tauri/assets/runtime/rootfs_version.txt"),
  resolve("src-tauri/gen/android/app/src/main/assets/runtime/rootfs.tgz"),
  resolve("src-tauri/gen/android/app/src/main/assets/runtime/rootfs_version.txt"),
]

const missing = runtimeFiles.filter((file) => !existsSync(file) || statSync(file).size === 0)

if (missing.length > 0) {
  console.error("Android runtime is incomplete: rootfs.tgz is missing or empty.")
  for (const file of missing) console.error(`  ${file}`)
  console.error("Run scripts/prepare-android-runtime.sh before building the APK.")
  process.exit(1)
}

console.log(`Android runtime OK: rootfs.tgz (${statSync(runtimeFiles[0]).size} bytes)`)

// jniLibs preflight.
//
// `gen/android/.../jniLibs/**/*.so` is gitignored inside a directory that
// `tauri android init` generates, so a fresh clone or a new worktree starts with
// an empty one. CMake then fails deep in the ninja step with
// "missing and no known rule to make it", which reads like a broken build rather
// than an unprovisioned tree — that mis-read cost four build cycles on
// 2026-08-09. Fail here instead, naming what is absent and where it comes from.
const JNI_DIR = resolve("src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a")

// Built by .github/workflows/android.yml (downloads, plus llama.cpp and
// pty_server.c compiled from source). `prepare-android-runtime.sh` covers only
// part of this set, which is why a local build can be short where CI is not.
const CI_PROVISIONED = [
  "libbash_exec.so",
  "libbun_exec.so",
  "libgcc_compat.so",
  "libggml-base.so",
  "libggml-cpu.so",
  "libggml.so",
  "libllama.so",
  "libllama_server.so",
  "libmusl_linker.so",
  "libpty_server.so",
  "librg_exec.so",
  "libstdcpp_compat.so",
  "libtoybox_exec.so",
]

// No producer in this repository: GPU/NPU backends and the specialised llama
// servers come from the manual OpenCL/Hexagon rebuild procedures, and the extra
// on-device tools were vendored by hand. They exist only in worktrees that
// already have them.
const MANUALLY_VENDORED = [
  "libbusybox_exec.so",
  "libggml-htp-v68.so",
  "libggml-htp-v69.so",
  "libggml-htp-v73.so",
  "libggml-htp-v75.so",
  "libggml-htp-v79.so",
  "libggml-htp-v81.so",
  "libggml-opencl.so",
  "libggml-vulkan.so",
  "libllama_server_hexagon.so",
  "libllama_server_modern.so",
  "libllama_server_opencl.so",
  "libllama_server_vulkan.so",
  "libmtmd.so",
  "libproot_exec.so",
  "libresolv_override.so",
  "librust_pty.so",
]

// libonnxruntime.so is synced by the Rust build script from ORT_LIB_LOCATION and
// libunifia_mobile_lib.so is the cargo output, so neither has to pre-exist here.
const present = (name) => {
  const path = resolve(JNI_DIR, name)
  // Both existsSync and statSync follow symlinks, so a hard link or a symlink
  // into a sibling worktree counts — that is the documented staging route —
  // while a dangling symlink does not. Checking the link itself with lstat
  // would pass one, since its own size is the length of the target path.
  if (!existsSync(path)) return false
  return statSync(path).size > 0
}

const missingCi = CI_PROVISIONED.filter((name) => !present(name))
const missingVendored = MANUALLY_VENDORED.filter((name) => !present(name))

if (missingCi.length > 0 || missingVendored.length > 0) {
  console.error("")
  console.error(`Android jniLibs are incomplete: ${missingCi.length + missingVendored.length} native libraries missing.`)
  console.error(`  ${JNI_DIR}`)
  if (missingCi.length > 0) {
    console.error("")
    console.error("Built by CI (.github/workflows/android.yml), not by the local prepare script:")
    for (const name of missingCi) console.error(`  - ${name}`)
  }
  if (missingVendored.length > 0) {
    console.error("")
    console.error("No producer in this repository — vendored by hand:")
    for (const name of missingVendored) console.error(`  - ${name}`)
  }
  console.error("")
  console.error("To stage them from a worktree that already has them (same volume, no disk cost):")
  console.error('  SRC=<other-worktree>/packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a')
  console.error(`  for f in "$SRC"/*.so; do [ -L "$f" ] && continue`)
  console.error(`    [ -e "${JNI_DIR}/$(basename "$f")" ] || cp -l "$f" "${JNI_DIR}/"; done`)
  process.exit(1)
}

console.log(`Android jniLibs OK: ${CI_PROVISIONED.length + MANUALLY_VENDORED.length} native libraries present`)
