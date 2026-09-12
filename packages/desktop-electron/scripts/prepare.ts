#!/usr/bin/env bun
import { $ } from "bun"

import { Script } from "@unifia/script"
import { copyBinaryToSidecarFolder, getCurrentSidecar, resolveChannel, resolveSidecarBinaryPath, stageSidecar } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`

const pkg = await Bun.file("./package.json").json()
pkg.version = Script.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)

// WHY two paths: this script only knew how to pull the CLI out of a GitHub
// Actions artifact. Run outside CI — which is how the local Windows packages
// are produced — the download failed, nothing landed in `resources/`, and
// electron-builder's `unifia-cli*` filter matched zero files. The app
// packaged and installed fine and then had no backend to spawn at all, which
// the UI reports as "cannot reach the local server".
if (process.env.GITHUB_RUN_ID) {
  const sidecarConfig = getCurrentSidecar()
  const artifact = process.env.UNIFIA_CLI_ARTIFACT ?? "unifia-cli"
  const dir = "resources/opencode-binaries"

  await $`mkdir -p ${dir}`
  await $`gh run download ${process.env.GITHUB_RUN_ID} -n ${artifact}`.cwd(dir)

  await copyBinaryToSidecarFolder(await resolveSidecarBinaryPath(dir, sidecarConfig.ocBinary))

  await $`rm -rf ${dir}`
} else {
  await stageSidecar()
}
