/* SPDX-License-Identifier: MIT */
/**
 * Export the vault (card C34, R-0017).
 *
 * The product promised the user the right to see, edit, delete and **export**
 * their own data. Class A is already plain Markdown on disk, so the vault is
 * portable by construction — but "portable in principle" is not an export:
 * the user needs one command that produces a self-contained, verifiable copy.
 *
 * ## Who is exporting matters
 *
 * `PortableRestrictions.exportable` defaults to `deny`, and its contract says
 * it governs "an exporter (Langfuse, etc.)" — a third party receiving the
 * content. That is not the same act as the owner taking a copy of their own
 * vault. Gating the owner's export on a flag meant for third parties would
 * turn a sovereignty guarantee into a lock on the user's own data.
 *
 * So the audience is explicit, the way `destinationKind` is explicit for
 * egress: `owner` exports everything, `third-party` honours `exportable` and
 * reports what it withheld. The ambiguous case is not silently resolved —
 * the caller has to say which one it is.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, isAbsolute, join } from "node:path"
import { portableRestrictionsFromFrontmatter } from "@unifia/contracts/knowledge"
import { KnowledgeFailure } from "../domain/errors.js"
import { parseFrontmatter } from "../parser/frontmatter.js"
import { VaultSource } from "../source/vault.js"
import { wouldBeContained, realOrNull } from "../source/containment.js"

/** Who receives the export. */
export type ExportAudience = "owner" | "third-party"

export interface ExportInput {
  /** Absolute path to the vault to export. */
  vaultRoot: string
  /** Absolute path to the directory the export is written into. */
  destination: string
  /**
   * `owner` is the user taking a copy of their own data and exports
   * everything. `third-party` honours each note's `exportable` restriction.
   */
  audience: ExportAudience
}

export interface ExportedNote {
  locator: string
  id: string
  contentHash: string
  bytes: number
}

export interface ExportManifest {
  exportedAt: string
  audience: ExportAudience
  vaultRoot: string
  notes: ExportedNote[]
  /** Notes withheld because `exportable` denied them. Empty for `owner`. */
  withheld: Array<{ locator: string; reason: string }>
  /** Notes that could not be parsed, so a partial export says so. */
  unreadable: string[]
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

/**
 * Copy the vault into `destination` and write a manifest beside it.
 *
 * The manifest carries a hash per note so the copy can be verified later —
 * an export nobody can check is a folder, not an export.
 */
export async function exportVault(input: ExportInput): Promise<ExportManifest> {
  if (!isAbsolute(input.vaultRoot) || !isAbsolute(input.destination)) {
    throw KnowledgeFailure.pathUnresolved("vaultRoot and destination must be absolute")
  }
  const realVault = realOrNull(input.vaultRoot)
  if (realVault === null) {
    throw KnowledgeFailure.pathUnresolved(`vault does not exist: ${input.vaultRoot}`)
  }
  // Writing an export inside the vault it copies would make the next export
  // include the previous one, and grow without bound.
  if (wouldBeContained(realVault, input.destination)) {
    throw KnowledgeFailure.mutationRefused(
      "destination must be outside the vault it exports",
    )
  }

  // Reuse the reader's walk: the export must see exactly the corpus the
  // runtime sees, with the same containment and the same skipped directories.
  const source = new VaultSource({
    root: input.vaultRoot,
    space: { kind: "personal", id: "export", label: "export" },
  })

  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    audience: input.audience,
    vaultRoot: input.vaultRoot,
    notes: [],
    withheld: [],
    unreadable: [],
  }

  mkdirSync(input.destination, { recursive: true })

  for (const locator of await source.locators()) {
    let raw: string
    try {
      raw = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      manifest.unreadable.push(locator)
      continue
    }

    let id: string
    let exportable: "allow" | "deny"
    try {
      const fm = parseFrontmatter(raw).frontmatter
      id = fm.unifia_id
      exportable = portableRestrictionsFromFrontmatter(fm.unifia_restrictions).exportable
    } catch {
      manifest.unreadable.push(locator)
      continue
    }

    if (input.audience === "third-party" && exportable === "deny") {
      manifest.withheld.push({ locator, reason: "unifia_restrictions.exportable is deny" })
      continue
    }

    const target = join(input.destination, locator)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, raw, "utf8")
    manifest.notes.push({
      locator,
      id,
      contentHash: sha256(raw),
      bytes: Buffer.byteLength(raw, "utf8"),
    })
  }

  writeFileSync(
    join(input.destination, "unifia-export-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )
  return manifest
}

/**
 * Check an export against its own manifest.
 *
 * The point of hashing each note is that someone can verify the copy months
 * later without the original vault.
 */
export function verifyExport(destination: string): {
  ok: boolean
  missing: string[]
  altered: string[]
} {
  const manifestPath = join(destination, "unifia-export-manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExportManifest
  const missing: string[] = []
  const altered: string[] = []

  for (const note of manifest.notes) {
    let raw: string
    try {
      raw = readFileSync(join(destination, note.locator), "utf8")
    } catch {
      missing.push(note.locator)
      continue
    }
    if (sha256(raw) !== note.contentHash) altered.push(note.locator)
  }

  return { ok: missing.length === 0 && altered.length === 0, missing, altered }
}
