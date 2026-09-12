/* SPDX-License-Identifier: MIT */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const productionRoots = [
  "packages/app/src",
  "packages/workbench-server/src",
  "packages/desktop/src-tauri/src",
  "packages/mobile/src-tauri/src",
]
const forbidden = ["real-transport.test", "test:transport"]
const offenders = []

async function visit(relativeDirectory) {
  const directory = path.join(repoRoot, relativeDirectory)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name)
    if (entry.isDirectory()) {
      if (!new Set(["node_modules", "dist", "build", "target", "gen"]).has(entry.name)) await visit(relativePath)
      continue
    }
    if (!/\.(?:ts|tsx|js|mjs|rs|json)$/.test(entry.name)) continue
    const source = await readFile(path.join(repoRoot, relativePath), "utf8")
    for (const marker of forbidden) {
      if (source.toLowerCase().includes(marker)) offenders.push(`${relativePath}: ${marker}`)
    }
  }
}

for (const root of productionRoots) await visit(root)
if (offenders.length > 0) {
  console.error(`WorkbenchTestBoundaryGuard: test harness leaked into production sources:\n${offenders.join("\n")}`)
  process.exit(1)
}
console.log("WorkbenchTestBoundaryGuard: transport harness remains outside production sources")
