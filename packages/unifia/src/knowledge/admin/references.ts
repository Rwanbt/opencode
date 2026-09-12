/* SPDX-License-Identifier: MIT */
/**
 * References listing (P11.40).
 *
 * For a given note (by locator or id), lists the outbound
 * wikilinks declared in its body. This is the inverse of
 * `backlinks.ts` (which lists who links TO a note).
 *
 * Each reference is reported with its raw target, optional
 * heading anchor, optional alias, and the byte offset of the
 * `[[` opener. This is useful for "what does this note
 * depend on" analysis.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"
import type { Wikilink } from "../parser/wikilinks.js"

export interface ReferencesReport {
  vaultRoot: string
  target: { id: KnowledgeId; locator: KnowledgeLocator } | null
  scanned: number
  references: Wikilink[]
  totalMs: number
}

export interface ReferencesInput {
  vaultRoot: string
  /** Target note locator. Mutually exclusive with `targetId`. */
  targetLocator?: string
  /** Target note id. Mutually exclusive with `targetLocator`. */
  targetId?: KnowledgeId
}

function readNote(vaultRoot: string, locator: string): { id: KnowledgeId; locator: KnowledgeLocator } | null {
  const full = join(vaultRoot, locator)
  let text: string
  try {
    text = readFileSync(full, "utf8")
  } catch {
    return null
  }
  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(text)
  } catch {
    return null
  }
  return {
    id: doc.note.frontmatter.unifia_id as KnowledgeId,
    locator: locator as KnowledgeLocator,
  }
}

function findById(vaultRoot: string, id: KnowledgeId): string | null {
  for (const locator of listMarkdownLocators(vaultRoot)) {
    const rec = readNote(vaultRoot, locator)
    if (rec && rec.id === id) return locator
  }
  return null
}

export function findReferences(input: ReferencesInput): ReferencesReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (input.targetId === undefined && input.targetLocator === undefined) {
    throw new Error("either targetId or targetLocator is required")
  }
  if (input.targetId !== undefined && input.targetLocator !== undefined) {
    throw new Error("targetId and targetLocator are mutually exclusive")
  }
  const t0 = Date.now()
  const locator = input.targetId !== undefined
    ? findById(input.vaultRoot, input.targetId)
    : input.targetLocator
  if (!locator) {
    return { vaultRoot: input.vaultRoot, target: null, scanned: 0, references: [], totalMs: Date.now() - t0 }
  }
  const full = join(input.vaultRoot, locator)
  let text: string
  let references: Wikilink[] = []
  let scanned = 0
  try {
    text = readFileSync(full, "utf8")
    const doc = parseDocument(text)
    references = doc.wikilinks
    scanned = 1
  } catch {
    // keep references = []
  }
  const target = readNote(input.vaultRoot, locator)
  return {
    vaultRoot: input.vaultRoot,
    target,
    scanned,
    references,
    totalMs: Date.now() - t0,
  }
}
