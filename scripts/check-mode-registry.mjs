import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const roots = ["packages"]
const generatedRoots = new Set([path.normalize("packages/mobile/src-tauri/assets/runtime")])
const allowed = new Set([
  path.normalize("packages/workbench-shell/src/modes.ts"),
  path.normalize("packages/spec-runtime/src/index.ts"),
])
const pattern = /(?:=|new Set<[^>]+>\()\s*\[?["'`]code["'`],\s*["'`]work["'`],\s*["'`]design["'`],\s*["'`]automate["'`]/
const found = []

async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Generated Electron/Android output can contain bundled copies of the
      // registry. It is not an authoritative source and must not make this
      // source guard depend on a previous local build.
      const normalizedDirectory = path.normalize(file)
      if (
        !generatedRoots.has(normalizedDirectory) &&
        !["node_modules", "dist", "build", "out", "gen", "generated"].includes(entry.name)
      )
        await visit(file)
      continue
    }
    if (!/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) continue
    // Tests intentionally enumerate the public modes to verify parity; they
    // are consumers, not additional runtime registries.
    if (/(?:\.test\.|\.spec\.|[\\/]e2e[\\/])/.test(file)) continue
    const source = await readFile(file, "utf8")
    if (pattern.test(source) && !allowed.has(path.normalize(file))) found.push(file)
  }
}

for (const root of roots) await visit(root)
if (found.length > 0) {
  console.error(`third mode registry detected:\n${found.join("\n")}`)
  process.exit(1)
}
console.log("ModeRegistryGuard: no third registry detected")
