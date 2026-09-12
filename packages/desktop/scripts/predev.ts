import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, resolveSidecarBinaryPath } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

// Local development only needs the host-native sidecar. The baseline Bun
// runtime is a release-matrix artifact and its cross-target extraction is
// unreliable on Windows; resolveSidecarBinaryPath already falls back to the
// native directory while preserving Tauri's expected sidecar filename.
const sidecarPath = `src-tauri/sidecars/unifia-cli-${RUST_TARGET}.exe`
const shouldRebuild = Bun.env.UNIFIA_REBUILD_SIDECAR === "1" || !(await Bun.file(sidecarPath).exists())
if (shouldRebuild) {
  await $`bun run build --single --skip-embed-web-ui`.cwd("../unifia")

  // Resolve after the build so native development can use the plain host
  // binary while the release matrix keeps its baseline naming convention.
  await copyBinaryToSidecarFolder(await resolveSidecarBinaryPath("../unifia/dist", sidecarConfig.ocBinary), RUST_TARGET)
} else {
  console.log(`Reusing existing sidecar ${sidecarPath} (set UNIFIA_REBUILD_SIDECAR=1 to rebuild)`)
}
