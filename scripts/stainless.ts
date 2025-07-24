#!/usr/bin/env bun

import { $ } from "bun"

await $`bun run ./packages/opencode/src/index.ts generate > openapi.json`
await $`stl builds create --branch dev --pull --allow-empty --+target go --+target typescript`
await $`rm -rf packages/sdk`
await $`mkdir -p packages/sdk`

await $`mv opencode-go/ packages/sdk/go`
await $`rm -rf packages/sdk/go/.git`

await $`mv opencode-typescript/ packages/sdk/js`
await $`rm -rf packages/sdk/js/.git`
await $`rm -rf packages/sdk/js/yarn.lock`
