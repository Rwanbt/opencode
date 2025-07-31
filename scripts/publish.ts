#!/usr/bin/env bun

const version = process.env["OPENCODE_VERSION"]
if (!version) {
  throw new Error("OPENCODE_VERSION is required")
}

await import(`../packages/sdk/stainless/generate.ts`)
await import(`../packages/sdk/js/script/publish.ts`)
