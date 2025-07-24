#!/usr/bin/env bun

import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
const version = process.env["VERSION"]
if (!version) throw new Error("VERSION is required")

await $`bun pm pkg set version="${version}"`
await $`tsc`.cwd(dir)
await $`bun publish`
