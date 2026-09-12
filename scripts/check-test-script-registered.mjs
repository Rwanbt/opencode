import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

// Pre-existing gap at the time this guard was added (2026-08-17, ARCH-002).
// These packages already had a test/ directory with no declared "test"
// script before this guard existed; fixing them is separate work, not part
// of ARCH-002. New packages are not exempt — only this frozen list is.
const knownGaps = new Set([
  "packages/browser-runtime",
  "packages/capability-runtime",
  "packages/desktop-runtime",
  "packages/enterprise",
  "packages/memory-runtime",
  "packages/workflow-runtime",
  "packages/console/app",
  "packages/console/core",
])

const roots = ["packages", "packages/console"]
const violations = []

for (const root of roots) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.posix.join(root, entry.name)
    const testDir = path.posix.join(dir, "test")
    const pkgFile = path.posix.join(dir, "package.json")
    if (!(await stat(testDir).then(() => true).catch(() => false))) continue
    if (!(await stat(pkgFile).then(() => true).catch(() => false))) continue
    const pkg = JSON.parse(await readFile(pkgFile, "utf8"))
    if (pkg.scripts?.test) continue
    if (knownGaps.has(dir)) continue
    violations.push(dir)
  }
}

if (violations.length > 0) {
  console.error(`package has a test/ directory but no "test" script:\n${violations.join("\n")}`)
  process.exit(1)
}
console.log("TestScriptGuard: every package with a test/ directory declares a \"test\" script (or is a known pre-existing gap)")
