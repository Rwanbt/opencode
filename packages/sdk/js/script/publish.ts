#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"

const version = process.env["OPENCODE_VERSION"]
if (!version) {
  throw new Error("OPENCODE_VERSION is required")
}
const dry = process.env["DRY"] === "true"

await import("./generate")
await $`rm -rf dist`
await $`bun tsc`

if (!dry) {
  await $`bun pm version --allow-same-version --no-git-tag-version ${version}`
  await $`bun publish`
}
