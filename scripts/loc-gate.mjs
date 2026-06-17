#!/usr/bin/env node
// LOC budget gate (D-03/D-05 guardrail; see docs/TECHNICAL-DEBT.md §4.1 and ADR-0003).
//
// Scoped to packages/app/src — the fork's own domain. Upstream packages
// (opencode/ui/sdk) are out of scope per ADR-0003 (see docs/loc-debt-upstream.md).
//
//   green  ≤ 500   ·   warn 800   ·   BLOCK 1500
//
// Fails (exit 1) on any file over the block threshold. Tighten BLOCK toward 800
// once the codebase is consistently under it.
//
// Usage: node scripts/loc-gate.mjs

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = "packages/app/src"
const BLOCK = 1500
const WARN = 800
const EXTENSIONS = new Set([".ts", ".tsx"])
// Flat data/translation files and type declarations are not "god files" —
// exclude from the logic LOC rule. (.d.ts files are checked in as symlinks in
// this repo, which break readFileSync on a fresh Linux CI checkout anyway.)
const EXCLUDE_DIRS = new Set(["i18n"])
const EXCLUDE_SUFFIX = [".test.ts", ".test.tsx", ".stories.tsx", ".gen.ts", ".d.ts"]

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Never follow symlinks: their target may live outside the tree or not
    // exist on a fresh checkout (e.g. *.d.ts shims), and a LOC gate must not
    // double-count or crash on them.
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      out.push(...walk(full))
    } else if (
      EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf("."))) &&
      !EXCLUDE_SUFFIX.some((s) => entry.name.endsWith(s))
    ) {
      out.push(full)
    }
  }
  return out
}

function lineCount(file) {
  const text = readFileSync(file, "utf8")
  if (text.length === 0) return 0
  let lines = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++
  return lines
}

let exists = true
try {
  statSync(ROOT)
} catch {
  exists = false
}
if (!exists) {
  console.error(`loc-gate: ${ROOT} not found (run from repo root)`)
  process.exit(2)
}

const files = walk(ROOT)
  .map((f) => ({ f: f.replace(/\\/g, "/"), loc: lineCount(f) }))
  .sort((a, b) => b.loc - a.loc)

const blocking = files.filter((x) => x.loc > BLOCK)
const warning = files.filter((x) => x.loc > WARN && x.loc <= BLOCK)

if (warning.length) {
  console.log(`\nloc-gate: ${warning.length} file(s) in the warning zone (${WARN}-${BLOCK} LOC):`)
  for (const x of warning) console.log(`  ${x.loc.toString().padStart(5)}  ${x.f}`)
}

if (blocking.length) {
  console.error(`\nloc-gate: FAIL — ${blocking.length} file(s) over the ${BLOCK} LOC block threshold:`)
  for (const x of blocking) console.error(`  ${x.loc.toString().padStart(5)}  ${x.f}`)
  console.error(`\nDecompose them (ADR-0001 Factory-with-Deps) or document an exception (ADR-0002).`)
  process.exit(1)
}

console.log(`\nloc-gate: OK — ${files.length} files scanned in ${ROOT}, none over ${BLOCK} LOC.`)
