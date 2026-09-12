#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// H10 — bundle manifest generator.
//
// Reads `packages/app/dist/assets/`, computes per-chunk sizes, and
// emits a JSON manifest under `docs/perf-baselines/bundle-manifest.json`.
// The manifest is the input the green tests assert against: "lazy
// locales/terminal/modes prouvé" means a chunk per surface (Work /
// Design / Automate / locales / terminal) and a budget per chunk.
//
// Usage:
//   node scripts/perf/bundle-manifest.mjs [--out <path>] [--root <dist>]
//
// Default --out  : docs/perf-baselines/bundle-manifest.json
// Default --root : packages/app/dist

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname, basename, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, "..", "..")

const args = process.argv.slice(2)
const outIdx = args.indexOf("--out")
const rootIdx = args.indexOf("--root")
const OUT_PATH = outIdx >= 0 ? args[outIdx + 1] : join(REPO_ROOT, "docs", "perf-baselines", "bundle-manifest.json")
const DIST_ROOT = rootIdx >= 0 ? args[rootIdx + 1] : join(REPO_ROOT, "packages", "app", "dist")

if (!existsSync(DIST_ROOT)) {
  console.error(`bundle-manifest: dist root not found: ${DIST_ROOT}`)
  process.exit(2)
}

const ASSETS = join(DIST_ROOT, "assets")

/**
 * Per-chunk classification. The Work / Design / Automate chunks
 * are produced by the F10 lazy boundary; the rest is the entry
 * + framework + shiki + tanstack etc.
 */
function classify(filename) {
  if (/KaTeX|MathJax|shiki|@shiki/i.test(filename)) return "vendor-syntax"
  if (/locale|i18n|@formatjs|intl-messageformat/i.test(filename)) return "locales"
  if (/terminal|ghostty|xterm/i.test(filename)) return "terminal"
  if (/workbench-mode|workbench-(design|automate|work)|design-surface|automate-surface|work-surface/i.test(filename)) return "mode"
  if (/^index-/.test(filename)) return "entry"
  return "other"
}

const byKind = new Map()
let totalBytes = 0
let totalGzipBytes = 0
let fileCount = 0
let overBudget = false
for (const entry of readdirSync(ASSETS, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  const name = entry.name
  const ext = extname(name)
  if (ext !== ".js" && ext !== ".css" && ext !== ".html") continue
  const full = join(ASSETS, name)
  const bytes = statSync(full).size
  const gzipBytes = gzipSync(readFileSync(full), { level: 9 }).length
  totalBytes += bytes
  totalGzipBytes += gzipBytes
  fileCount += 1
  const kind = classify(name)
  const prev = byKind.get(kind) ?? { count: 0, bytes: 0, files: [] }
  prev.count += 1
  prev.bytes += bytes
  prev.gzipBytes = (prev.gzipBytes ?? 0) + gzipBytes
  prev.maxGzipBytes = Math.max(prev.maxGzipBytes ?? 0, gzipBytes)
  if (prev.files.length < 25) prev.files.push({ name, bytes, gzipBytes })
  byKind.set(kind, prev)
}

const manifest = {
  generatedAt: new Date().toISOString(),
  distRoot: DIST_ROOT,
  totalBytes,
  totalGzipBytes,
  totalFiles: fileCount,
  byKind: Object.fromEntries(
    [...byKind.entries()].sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => [k, { count: v.count, bytes: v.bytes, gzipBytes: v.gzipBytes, maxGzipBytes: v.maxGzipBytes, files: v.files }]),
  ),
  // Budget per kind (H10 oracle). The Work / Design / Automate
  // / locales / terminal chunks must each stay under the per-surface
  // budget in compressed transfer bytes — exceeding it means a surface is pulling in too much
  // code at entry, which is exactly what F10's lazy boundary is
  // supposed to prevent.
  budgets: {
    entry: 500_000,
    "vendor-syntax": 500_000,
    locales: 250_000,
    terminal: 500_000,
    mode: 500_000,
  },
}

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2))
console.log(`bundle-manifest: wrote ${OUT_PATH}`)
console.log(`  total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${fileCount} files`)
for (const [kind, data] of Object.entries(manifest.byKind)) {
  const budget = manifest.budgets[kind]
    const status = budget && data.maxGzipBytes > budget ? "OVER BUDGET" : "ok"
    if (status === "OVER BUDGET") overBudget = true
  console.log(`  ${kind.padEnd(16)} raw ${(data.bytes / 1024).toFixed(1).padStart(8)} KB  gzip ${(data.gzipBytes / 1024).toFixed(1).padStart(8)} KB  [${status}]`)
}
if (overBudget) process.exitCode = 1
