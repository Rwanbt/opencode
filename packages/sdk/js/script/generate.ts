#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

console.log("=== Generating SDKs ===")
console.log()

import { createClient, defaultPlugins } from "@hey-api/openapi-ts"

const dir = new URL("..", import.meta.url).pathname
await fs.rmdir(path.join(dir, "src/gen"), { recursive: true })
await $`bun run ../../opencode/src/index.ts generate > openapi.json`.cwd(dir)

await createClient({
  input: "./openapi.json",
  output: "./src/gen",
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      asClass: true,
      exportFromIndex: false,
      auth: false,
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})
