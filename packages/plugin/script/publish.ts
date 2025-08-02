#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"

const version = process.env["OPENCODE_VERSION"]
if (!version) {
  throw new Error("OPENCODE_VERSION is required")
}
const snapshot = process.env["OPENCODE_SNAPSHOT"] === "true"

await $`bun tsc`

await $`bun pm version --allow-same-version --no-git-tag-version ${version}`
if (snapshot) {
  await $`bun publish --tag snapshot`
  await $`git checkout package.json`
}
if (!snapshot) {
  await $`bun publish`
}
