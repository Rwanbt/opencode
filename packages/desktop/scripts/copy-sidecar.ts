import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { getCurrentSidecar, windowsify } from "./utils"

// WHY: get_sidecar_path (cli.rs) spawns the sidecar SIBLING to the running
// binary (target/<profile>/opencode-cli). tauri-build's externalBin step
// restores a stale sidecar there during `tauri build`, so this runs AFTER the
// build (see the "release" npm script) to put the fresh one back.
// Uses Bun.write (not node:fs copyFileSync): on Bun 1.3.11/win32 the latter
// silently fails to overwrite an existing 180 MB+ file, leaving the stale one.
const target = Bun.env.TAURI_ENV_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc"
const sidecarConfig = getCurrentSidecar(target)

// Candidate source paths in order of preference
const candidates = [
  windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`),
  windowsify(`../opencode/dist/${sidecarConfig.ocBinary.replace("-baseline", "")}/bin/opencode`),
  windowsify(`src-tauri/sidecars/opencode-cli-${target}`),
]

let src = ""
for (const candidate of candidates) {
  if (await Bun.file(candidate).exists()) {
    src = candidate
    break
  }
}

if (!src) {
  console.warn(`[copy-sidecar] source missing in candidates: ${candidates.join(", ")} — run "predev" or build the opencode sidecar first`)
  process.exit(0)
}

console.log(`[copy-sidecar] using source: ${src}`)
const srcFile = Bun.file(src)

for (const profile of ["debug", "release"]) {
  const dest = windowsify(`src-tauri/target/${profile}/opencode-cli`)
  mkdirSync(dirname(dest), { recursive: true })
  try {
    await Bun.write(dest, srcFile)
    console.log(`[copy-sidecar] ${profile} <- ${dest}`)
  } catch (e) {
    // WHY: EBUSY/EPERM = a running instance holds the file open. Don't fail
    // the build — the running sidecar is the one we just shipped; it refreshes
    // on the next cold start.
    const code = (e as NodeJS.ErrnoException).code
    if (code === "EBUSY" || code === "EPERM") {
      console.warn(`[copy-sidecar] ${profile}: locked by a running instance (${code}) — skipped, refreshes on cold start`)
      continue
    }
    throw e
  }
}
