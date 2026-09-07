/* SPDX-License-Identifier: MIT */
/**
 * Broken-wikilink scanner (P11.28).
 *
 * Scans every note in the vault, parses the body, and reports
 * every wikilink that points to a target that does not exist
 * as a note file in the vault.
 *
 * The match is case-insensitive and ignores heading anchors.
 * The result is grouped by source note for readability.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface BrokenLink {
  source: KnowledgeLocator
  /** The raw target as it appears in the wikilink. */
  raw: string
  /** Normalised target (lowercase, .md stripped, heading anchor stripped). */
  target: string
}

export interface BrokenLinkInput {
  vaultRoot: string
}

export interface BrokenLinkReport {
  vaultRoot: string
  scanned: number
  /** Map from source locator to the list of broken links in that source. */
  bySource: Record<string, BrokenLink[]>
  totalBroken: number
  totalMs: number
}

function normaliseTarget(t: string): string {
  const lower = t.toLowerCase().trim()
  const noExt = lower.endsWith(".md") ? lower.slice(0, -3) : lower
  const parts = noExt.split("/")
  return parts[parts.length - 1] ?? noExt
}

function locatorSlug(locator: string): string {
  return normaliseTarget(locator)
}

export function scanBrokenLinks(input: BrokenLinkInput): BrokenLinkReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const knownSlugs = new Set(locators.map(locatorSlug))
  const bySource: Record<string, BrokenLink[]> = {}
  let scanned = 0
  let totalBroken = 0

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
      const slug = normaliseTarget(wl.target)
      if (knownSlugs.has(slug)) continue
      const entry: BrokenLink = {
        source: locator as KnowledgeLocator,
        raw: wl.target,
        target: slug,
      }
      if (!bySource[locator]) bySource[locator] = []
      bySource[locator]!.push(entry)
      totalBroken += 1
    }
  }

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    bySource,
    totalBroken,
    totalMs: Date.now() - t0,
  }
}
