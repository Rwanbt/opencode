#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */

/**
 * P21 — import Open Design design-system catalogues into the workspace manifest.
 *
 * Usage:
 *   node scripts/import-design-systems.mjs [--root <open-design-root>] [--out <manifest-path>]
 *
 * Defaults:
 *   --root   D:\\App\\open-design-main\\design-systems
 *   --out    .unifia/workspace.json (relative to the repository root)
 *
 * The script is intentionally thin: the real work lives in
 * `@unifia/design-system-runtime`. The script wires the importer to the
 * contract validator, derives `tokens` from `design-tokens.json` when
 * available, and writes a v1 manifest that the server route accepts.
 *
 * Exit codes:
 *   0  success — the manifest was written
 *   1  no catalog was importable (the runbook forbids an empty catalogue)
 *   2  the produced manifest was rejected by the contract validator
 *   3  filesystem error (root missing, unwritable output)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { argv, cwd, exit, stderr, stdout } from "node:process"
import { fileURLToPath } from "node:url"

import { importCatalogs, SKIP_REASONS } from "@unifia/design-system-runtime/node"
import { migrateWorkspaceManifest } from "@unifia/contracts"

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..")
const DEFAULT_ROOT = "D:\\App\\open-design-main\\design-systems"
const DEFAULT_OUT = ".unifia/workspace.json"

function parseArgs(args) {
  const parsed = { root: undefined, out: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--root") parsed.root = args[++index]
    else if (arg === "--out") parsed.out = args[++index]
    else if (arg === "-h" || arg === "--help") {
      stdout.write("Usage: node scripts/import-design-systems.mjs [--root <open-design-root>] [--out <manifest-path>]\n")
      exit(0)
    } else {
      stderr.write(`unknown argument: ${arg}\n`)
      exit(2)
    }
  }
  return parsed
}

function forwardSlash(path) {
  return path.split(sep).join("/")
}

function flattenTokens(raw, prefix = "") {
  const out = {}
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    const next = prefix ? `${prefix}.${key}` : key
    if (value === null) continue
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[next] = value
      continue
    }
    if (Array.isArray(value)) {
      out[next] = value.join(",")
      continue
    }
    if (typeof value === "object") {
      const nested = value && typeof value === "object" && "$value" in value ? value.$value : undefined
      if (nested !== undefined && (typeof nested === "string" || typeof nested === "number")) {
        out[next] = nested
        continue
      }
      Object.assign(out, flattenTokens(value, next))
    }
  }
  return out
}

async function deriveTokens(catalog) {
  const designDir = forwardSlash(catalog.designMdPath).replace(/\/DESIGN\.md$/, "")
  const tokensPath = join(REPO_ROOT, designDir, "design-tokens.json")
  try {
    const raw = JSON.parse(await readFile(tokensPath, "utf8"))
    const flat = flattenTokens(raw)
    const colors = {}
    const spacing = {}
    const typography = {}
    for (const [key, value] of Object.entries(flat)) {
      if (typeof value === "string" && /#[0-9a-fA-F]{3,8}|rgb|hsl/i.test(value)) {
        colors[key] = String(value)
      } else if (typeof value === "number" && /space|gap|padding|size|radius|width|height/i.test(key)) {
        spacing[key] = Math.max(0, value)
      } else if (typeof value === "string" && /font|inter|mono|serif/i.test(key)) {
        typography[key] = String(value)
      }
    }
    return { colors, spacing, typography }
  } catch {
    return { colors: {}, spacing: {}, typography: {} }
  }
}

async function main() {
  const args = parseArgs(argv.slice(2))
  const root = args.root ? resolve(args.root) : DEFAULT_ROOT
  const out = args.out ? resolve(args.out) : join(REPO_ROOT, DEFAULT_OUT)
  const { catalogs, skipped } = await importCatalogs(root)
  if (catalogs.length === 0) {
    stderr.write(`no importable catalogue found under ${root}\n`)
    for (const entry of skipped) stderr.write(`  skipped: ${entry.path} (${entry.reason})\n`)
    exit(1)
  }
  const enriched = []
  for (const catalog of catalogs) {
    const tokens = await deriveTokens(catalog)
    enriched.push({ ...catalog, tokens })
  }
  const manifest = { version: 1, designSystems: enriched }
  try {
    migrateWorkspaceManifest(manifest)
  } catch (error) {
    stderr.write(`produced manifest failed validation: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(2)
  }
  try {
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  } catch (error) {
    stderr.write(`could not write ${out}: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(3)
  }
  const summary = skipped.filter((entry) => entry.reason !== SKIP_REASONS.notADirectory)
  stdout.write(`wrote ${out} with ${enriched.length} catalogue(s)\n`)
  for (const catalog of enriched) stdout.write(`  + ${catalog.id} (${catalog.name} ${catalog.version})\n`)
  if (summary.length > 0) {
    stdout.write(`skipped ${summary.length} entry(ies):\n`)
    for (const entry of summary) stdout.write(`  - ${forwardSlash(entry.path)} (${entry.reason})\n`)
  }
}

await main()
