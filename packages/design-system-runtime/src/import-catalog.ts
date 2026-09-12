/* SPDX-License-Identifier: MIT */

/**
 * P21 — Import the Open Design design-system catalogue into the workspace manifest.
 *
 * WHY this is a separate package: the importer reads from the Open Design
 * repository and writes into the workspace authority. Both sides already
 * have a contract — `manifest.json` upstream, the v1 contract in
 * `work_design/WORKSPACE-MANIFEST.md` downstream. The importer is the
 * single transformation that knows both.
 *
 * WHY a pure function over an imperative tool: pure, deterministic,
 * testable on synthetic fixtures. The script `scripts/import-design-systems.mjs`
 * is the only consumer that touches the real filesystem for the run.
 */

import { readFile, readdir, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

/** Source of a catalog: bundled (shipped with the run) or user (declared by the user). */
export type CatalogSource = { kind: "bundled" | "user"; path: string }

/**
 * Result of an import pass. Each entry has enough information to build a
 * `DesignSystemCatalog` in the workspace manifest; the importer is the
 * only place that knows the Open Design → Unifia mapping.
 */
export type ImportedCatalog = {
  id: string
  name: string
  version: string
  source: string
  designMdPath: string
}

export type SkippedCatalog = { path: string; reason: string }

export type ImportResult = {
  catalogs: readonly ImportedCatalog[]
  skipped: readonly SkippedCatalog[]
}

/** Same regex as `parseDesignSystemCatalog` in `@unifia/contracts/design-system`. */
export const DESIGN_SYSTEM_ID_REGEX = /^[a-z][a-z0-9-]{2,63}$/

/** Skip reasons — explicit set, machine-readable, never localised. */
export const SKIP_REASONS = {
  invalidId: "invalid-id",
  duplicateId: "duplicate-id",
  missingDesignMd: "missing-design-md",
  notADirectory: "not-a-directory",
} as const

export type SkipReason = (typeof SKIP_REASONS)[keyof typeof SKIP_REASONS]

const DESIGN_MD_FILENAME = "DESIGN.md"
const MANIFEST_JSON_FILENAME = "manifest.json"

/** Reads and parses a JSON file. Returns `undefined` on ENOENT. */
async function tryReadJson(path: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(path, "utf8")
    return JSON.parse(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

/** Picks the name and version out of an Open Design manifest.json. */
function readNameAndVersion(manifest: unknown | undefined, fallbackId: string): { name: string; version: string } {
  if (manifest && typeof manifest === "object") {
    const record = manifest as Record<string, unknown>
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : fallbackId
    let version = "1.0.0"
    if (typeof record.version === "string" && /^\d+\.\d+\.\d+$/.test(record.version)) version = record.version
    else if (typeof record.schemaVersion === "string") {
      const match = record.schemaVersion.match(/(\d+)\.(\d+)\.(\d+)/)
      if (match) version = `${match[1]}.${match[2]}.${match[3]}`
    }
    return { name, version }
  }
  return { name: fallbackId, version: "1.0.0" }
}

/**
 * Imports design-system catalogues found in `rootDir`.
 *
 * Each subdirectory of `rootDir` is one catalogue. The function:
 *   1. validates the directory name against `DESIGN_SYSTEM_ID_REGEX` (else `invalid-id`);
 *   2. requires a readable `DESIGN.md` at the root of the catalogue (else `missing-design-md`);
 *   3. rejects a second catalogue with the same id (else `duplicate-id`);
 *   4. reads `manifest.json` for the human-readable name and the version.
 *
 * The result is sorted by `id` for determinism. Skipped entries are reported
 * with their `path` (the absolute path to the directory) and a reason, never
 * silently dropped — the script that consumes this function uses the
 * `skipped` list to surface warnings to the user.
 */
export async function importCatalogs(rootDir: string): Promise<ImportResult> {
  const root = resolve(rootDir)
  const rootStat = await stat(root).catch(() => undefined)
  if (!rootStat || !rootStat.isDirectory()) {
    return { catalogs: [], skipped: [{ path: root, reason: SKIP_REASONS.notADirectory }] }
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const seenIds = new Set<string>()
  const catalogs: ImportedCatalog[] = []
  const skipped: SkippedCatalog[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const dirPath = join(root, id)
    if (!DESIGN_SYSTEM_ID_REGEX.test(id)) {
      skipped.push({ path: dirPath, reason: SKIP_REASONS.invalidId })
      continue
    }
    const designMdPath = join(dirPath, DESIGN_MD_FILENAME)
    const designStat = await stat(designMdPath).catch(() => undefined)
    if (!designStat || !designStat.isFile()) {
      skipped.push({ path: dirPath, reason: SKIP_REASONS.missingDesignMd })
      continue
    }
    if (seenIds.has(id)) {
      skipped.push({ path: dirPath, reason: SKIP_REASONS.duplicateId })
      continue
    }
    const manifest = await tryReadJson(join(dirPath, MANIFEST_JSON_FILENAME))
    const { name, version } = readNameAndVersion(manifest, id)
    seenIds.add(id)
    catalogs.push({ id, name, version, source: `workspace://imports/${id}`, designMdPath })
  }
  catalogs.sort((left, right) => left.id.localeCompare(right.id))
  return { catalogs, skipped }
}

/** Normalises a `designMdPath` for inclusion in deterministic output. Cross-platform. */
export function normaliseDesignMdPath(designMdPath: string): string {
  return designMdPath.split(sep).join("/")
}
