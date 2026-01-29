#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

let output = `version=${Script.version}\n`

await $`gh release create v${Script.version} -d --title "v${Script.version}"`
const release = await $`gh release view v${Script.version} --json id,tagName`.json()
output += `release=${release.id}\n`
output += `tag=${release.tagName}\n`

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output)
}
