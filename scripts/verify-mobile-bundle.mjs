import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const root = process.cwd()
const migrationRoot = join(root, "packages/opencode/migration")
const bundlePath = join(root, "packages/mobile/src-tauri/assets/runtime/opencode-cli.js")
const generatedBundlePath = join(root, "packages/mobile/src-tauri/gen/android/app/src/main/assets/runtime/opencode-cli.js")
const migrations = (await readdir(migrationRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => name.includes("_"))
  .sort()
const bundle = await readFile(bundlePath, "utf8")
const generatedBundle = await readFile(generatedBundlePath, "utf8")

const missing = migrations.filter((name) => !bundle.includes(name))
const checks = {
  migrationCount: migrations.length,
  missingMigrations: missing,
  hasVersionMetadata: bundle.includes("globalThis.OPENCODE_VERSION"),
  generatedCopyMatches: bundle === generatedBundle,
  hasObservabilityRuntime: bundle.includes("observability"),
}
console.log(JSON.stringify(checks, null, 2))
if (missing.length || !checks.hasVersionMetadata || !checks.generatedCopyMatches || !checks.hasObservabilityRuntime) {
  process.exit(1)
}