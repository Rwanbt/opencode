/* SPDX-License-Identifier: MIT */
/**
 * Backlinks search (P11.25).
 *
 * For a given target locator, returns all notes in the vault
 * that have a wikilink pointing to that locator. The match is
 * case-insensitive and ignores heading anchors (e.g.
 * `[[note#heading]]` matches `note`).
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface BacklinkHit {
  id: KnowledgeId
  source: KnowledgeLocator
  type: string
  lifecycle: string
  /** The matched wikilink target (after stripping the heading anchor). */
  matchedTarget: string
}

export interface BacklinksInput {
  vaultRoot: string
  /** The target locator or bare name to search for. */
  target: string
}

export interface BacklinksReport {
  vaultRoot: string
  target: string
  scanned: number
  hits: BacklinkHit[]
  totalMs: number
}

function normaliseTarget(t: string): string {
  const lower = t.toLowerCase().trim()
  // Strip `.md` suffix if present.
  const noExt = lower.endsWith(".md") ? lower.slice(0, -3) : lower
  // Strip any leading path; we just want the bare slug.
  const parts = noExt.split("/")
  return parts[parts.length - 1] ?? noExt
}

export function findBacklinks(input: BacklinksInput): BacklinksReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const wanted = normaliseTarget(input.target)
  const locators = listMarkdownLocators(input.vaultRoot)
  const hits: BacklinkHit[] = []
  let scanned = 0

  for (const locator of locators) {
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, locator), "utf8")
    } catch {
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      continue
    }
    scanned += 1
    for (const wl of doc.wikilinks) {
      const bare = normaliseTarget(wl.target)
      if (bare === wanted) {
        hits.push({
          id: doc.note.frontmatter.unifia_id as KnowledgeId,
          source: locator as KnowledgeLocator,
          type: doc.note.frontmatter.unifia_type,
          lifecycle: doc.note.frontmatter.unifia_lifecycle,
          matchedTarget: wl.target,
        })
        break // one hit per source note
      }
    }
  }

  return {
    vaultRoot: input.vaultRoot,
    target: input.target,
    scanned,
    hits,
    totalMs: Date.now() - t0,
  }
}
