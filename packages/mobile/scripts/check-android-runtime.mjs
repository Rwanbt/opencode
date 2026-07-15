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
