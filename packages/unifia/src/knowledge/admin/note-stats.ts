/* SPDX-License-Identifier: MIT */
/**
 * Note stats (P11.52).
 *
 * For a single note (resolved by locator or id), returns a
 * structured per-note statistics object:
 *  - id, locator, type, lifecycle, project_ref
 *  - frontmatter field count + list of field names
 *  - body length (chars + lines + bytes)
 *  - heading count + max heading depth
 *  - wikilink count (in + out)
 *  - tag count + distinct tag count
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync, statSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface NoteStats {
  id: KnowledgeId | null
  locator: KnowledgeLocator
  type: string
  lifecycle: string
  projectRef: string | null
  createdAt: string | null
  updatedAt: string | null
  frontmatterFieldCount: number
  frontmatterFieldNames: string[]
  bodyChars: number
  bodyLines: number
  bytes: number
  headingCount: number
  maxHeadingDepth: number
  wikilinkOutCount: number
  wikilinkInCount: number
  tagCount: number
  distinctTagCount: number
  totalMs: number
}

export interface NoteStatsInput {
  vaultRoot: string
  locator?: string
  id?: string
}

function findNoteByLocator(
  vaultRoot: string,
  locator: string,
): { locator: KnowledgeLocator; text: string } | null {
  const locators = listMarkdownLocators(vaultRoot)
  if (!locators.includes(locator as KnowledgeLocator)) return null
  let text: string
  try {
    text = readFileSync(join(vaultRoot, locator), "utf8")
  } catch {
    return null
  }
  return { locator: locator as KnowledgeLocator, text }
}

function findNoteById(
  vaultRoot: string,
  id: string,
): { locator: KnowledgeLocator; text: string } | null {
  const locators = listMarkdownLocators(vaultRoot)
  for (const locator of locators) {
    let text: string
    try {
      text = readFileSync(join(vaultRoot, locator), "utf8")
    } catch {
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      continue
    }
    if (doc.note.frontmatter.unifia_id === id) {
      return { locator, text }
    }
  }
  return null
}

function normaliseTarget(t: string): string {
  const lower = t.toLowerCase().trim()
  const noExt = lower.endsWith(".md") ? lower.slice(0, -3) : lower
  const parts = noExt.split("/")
  return parts[parts.length - 1] ?? noExt
}

function countBacklinks(
  vaultRoot: string,
  target: KnowledgeLocator,
): number {
  const wanted = normaliseTarget(target)
  const locators = listMarkdownLocators(vaultRoot)
  let count = 0
  for (const locator of locators) {
    if (locator === target) continue
    let text: string
    try {
      text = readFileSync(join(vaultRoot, locator), "utf8")
    } catch {
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      continue
    }
    for (const wl of doc.wikilinks ?? []) {
      const bare = normaliseTarget(wl.target)
      if (bare === wanted) count += 1
    }
  }
  return count
}

export function noteStats(input: NoteStatsInput): NoteStats {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (!input.locator && !input.id) {
    throw new Error("either locator or id is required")
  }
  const t0 = Date.now()
  const found = input.locator
    ? findNoteByLocator(input.vaultRoot, input.locator)
    : findNoteById(input.vaultRoot, input.id as string)
  if (!found) {
    throw new Error(
      `note not found: locator=${input.locator ?? "-"} id=${input.id ?? "-"}`,
    )
  }
  const { locator, text } = found
  const doc = parseDocument(text)
  const fm = doc.note.frontmatter

  // frontmatter field count (excluding unifia_* core fields for the
  // "fieldNames" list, but count everything for the total).
  const fieldNames = Object.keys(fm).sort()
  const tags = (fm.unifia_tags as string[] | undefined) ?? []

  // heading depth: count of `#` characters at line start
  let maxDepth = 0
  const headingCount = doc.headings.length
  for (const h of doc.headings) {
    const depth = h.level
    if (depth > maxDepth) maxDepth = depth
  }

  // body stats
  const body = doc.note.body ?? ""
  const bodyChars = body.length
  const bodyLines = body === "" ? 0 : body.split(/\r?\n/).length

  // bytes
  const absPath = join(input.vaultRoot, locator)
  let bytes = 0
  try {
    bytes = statSync(absPath).size
  } catch {
    bytes = Buffer.byteLength(text, "utf8")
  }

  // outbound wikilinks
  const wikilinkOutCount = (doc.wikilinks ?? []).length

  // inbound wikilinks
  const wikilinkInCount = countBacklinks(input.vaultRoot, locator)

  return {
    id: (fm.unifia_id as KnowledgeId) ?? null,
    locator,
    type: fm.unifia_type,
    lifecycle: fm.unifia_lifecycle,
    projectRef: fm.unifia_project_ref ?? null,
    createdAt: fm.unifia_created_at ?? null,
    updatedAt: fm.unifia_updated_at ?? null,
    frontmatterFieldCount: fieldNames.length,
    frontmatterFieldNames: fieldNames,
    bodyChars,
    bodyLines,
    bytes,
    headingCount,
    maxHeadingDepth: maxDepth,
    wikilinkOutCount,
    wikilinkInCount,
    tagCount: tags.length,
    distinctTagCount: new Set(tags.map((t) => t.toLowerCase())).size,
    totalMs: Date.now() - t0,
  }
}
