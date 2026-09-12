#!/usr/bin/env node
// Runs scripts/brand/generate.py with whichever Python this machine exposes.
//
// `python3` is the right name on CI and macOS but is frequently absent from
// PATH on Windows, where the launcher is `py`. Hard-coding either one makes the
// script work on one half of the team's machines, so it is resolved here.

import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, "generate.py")

const candidates = [
  ["python3", []],
  ["python", []],
  ["py", ["-3"]],
]

function versionOf(command, prefix) {
  const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8" })
  if (probe.error || probe.status !== 0) return null
  return `${probe.stdout}${probe.stderr}`.trim()
}

for (const [command, prefix] of candidates) {
  const version = versionOf(command, prefix)
  if (!version) continue
  const run = spawnSync(command, [...prefix, script, ...process.argv.slice(2)], { stdio: "inherit" })
  process.exit(run.status ?? 1)
}

console.error("No Python interpreter found (tried python3, python, py -3).")
console.error("The generator needs Python 3.10+ with Pillow. `bun run brand:check` needs neither.")
process.exit(1)
