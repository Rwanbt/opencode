#!/usr/bin/env bun

import { $ } from "bun"
import { generateOpenApi } from "../packages/sdk/js/script/openapi.ts"

await $`bun ./packages/sdk/js/script/build.ts`
await generateOpenApi("packages/sdk/openapi.json")
await $`bun run prettier --write packages/sdk/openapi.json`
