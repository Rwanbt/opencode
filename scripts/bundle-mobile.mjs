#!/usr/bin/env node
/**
 * bundle-mobile.mjs — Bundle the OpenCode CLI for Android
 *
 * Bundles mobile-entry.ts normally, then PREPENDS the SQL migrations
 * as a globalThis assignment at the top of the output file.
 * This ensures migrations are available before any code runs.
 *
 * The wrapper approach (import wrapper → import entry) didn't work because
 * bun's bundler reorders modules and puts the wrapper AFTER db.ts init.
 *
 * Usage: node scripts/bundle-mobile.mjs [--outdir DIR]
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, renameSync } from "fs"
import { join, dirname } from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const outdir = process.argv.includes("--outdir")
  ? process.argv[process.argv.indexOf("--outdir") + 1]
  : join(ROOT, "packages/mobile/src-tauri/assets/runtime")

const assetsDir = join(ROOT, "packages/mobile/src-tauri/gen/android/app/src/main/assets/runtime")

// ── 1. Read SQL migrations ──────────────────────────────────────────
const migrationDir = join(ROOT, "packages/opencode/migration")
const dirs = readdirSync(migrationDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

// db.ts Journal type expects: { sql: string, timestamp: number, name: string }
// The timestamp is extracted from the directory name (YYYYMMDDHHmmss prefix).
function timeFromTag(tag) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!m) return 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

const entries = dirs.map((name) => {
  const sqlPath = join(migrationDir, name, "migration.sql")
  if (!existsSync(sqlPath)) return null
  return { sql: readFileSync(sqlPath, "utf8"), timestamp: timeFromTag(name), name }
}).filter(Boolean)

console.log(`[bundle-mobile] ${entries.length} SQL migrations found`)

// ── 2. Bundle mobile-entry.ts normally ──────────────────────────────
mkdirSync(outdir, { recursive: true })

const cmd = [
  "bun", "build",
  join(ROOT, "packages/opencode/src/mobile-entry.ts"),
  "--target=bun",
  `--outdir=${outdir}`,
  '--external', '@parcel/watcher',
  '--external', '@parcel/watcher/wrapper',
  '--external', '@opentui/core',
  '--external', '@opentui/solid',
].join(" ")

console.log(`[bundle-mobile] Running: ${cmd}`)
execSync(cmd, { stdio: "inherit", cwd: ROOT })

// Rename output
const outputPath = join(outdir, "mobile-entry.js")
const finalPath = join(outdir, "opencode-cli.js")
if (existsSync(outputPath)) {
  renameSync(outputPath, finalPath)
}

// ── 3. PREPEND migrations to the bundle ─────────────────────────────
// This MUST be at the very top so globalThis.OPENCODE_MIGRATIONS is set
// before any module code (including db.ts lazy init) executes.
const bundle = readFileSync(finalPath, "utf8")
const prefix = `// AUTO-GENERATED: Inlined SQL migrations for Android mobile\nglobalThis.OPENCODE_MIGRATIONS = ${JSON.stringify(entries)};\n`
writeFileSync(finalPath, prefix + bundle)

// ── 4. Copy to gen/android assets ───────────────────────────────────
mkdirSync(assetsDir, { recursive: true })
cpSync(finalPath, join(assetsDir, "opencode-cli.js"))

// ── 5. Verify ───────────────────────────────────────────────────────
const content = readFileSync(finalPath, "utf8")
const createTableCount = (content.match(/CREATE TABLE/g) || []).length
const androidPtyCount = (content.match(/AndroidPTY/g) || []).length
const firstLine = content.split("\n")[0]

console.log(`[bundle-mobile] Output: ${finalPath} (${(readFileSync(finalPath).length / 1024 / 1024).toFixed(1)}MB)`)
console.log(`[bundle-mobile] First line: ${firstLine.substring(0, 80)}...`)
console.log(`[bundle-mobile] CREATE TABLE refs: ${createTableCount} (should be >0)`)
console.log(`[bundle-mobile] AndroidPTY refs: ${androidPtyCount} (should be >0)`)

if (createTableCount === 0) {
  console.error("[bundle-mobile] ERROR: No SQL migrations inlined!")
  process.exit(1)
}
