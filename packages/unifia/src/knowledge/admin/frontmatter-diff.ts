/* SPDX-License-Identifier: MIT */
/**
 * Frontmatter diff (P11.56).
 *
 * For two notes (resolved by locator or id), diffs their
 * frontmatters. Returns:
 *  - `added`     — keys present in B but not A
 *  - `removed`   — keys present in A but not B
 *  - `changed`   — keys present in both with different values
 *  - `unchanged` — keys present in both with equal values
 *
 * Pure / read-only. Order-independent.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface FrontmatterDiffInput {
  vaultRoot: string
  /** Source A — locator or id. */
  targetA?: string
  idA?: string
  /** Source B — locator or id. */
  targetB?: string
  idB?: string
}

export interface FrontmatterFieldChange {
  key: string
  /** Value in A (or undefined if absent). */
  a: unknown
  /** Value in B (or undefined if absent). */
  b: unknown
}

export interface FrontmatterDiffReport {
  vaultRoot: string
  aLocator: KnowledgeLocator
  bLocator: KnowledgeLocator
  added: string[]
  removed: string[]
  changed: FrontmatterFieldChange[]
  unchanged: string[]
  totalMs: number
}

function findNote(
  vaultRoot: string,
  locator: string | undefined,
  id: string | undefined,
): { locator: KnowledgeLocator; fm: Record<string, unknown> } | null {
  const locators = listMarkdownLocators(vaultRoot)
  if (locator) {
    if (!locators.includes(locator as KnowledgeLocator)) return null
    const absPath = join(vaultRoot, locator)
    let text: string
    try {
      text = readFileSync(absPath, "utf8")
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
      locator: locator as KnowledgeLocator,
      fm: doc.note.frontmatter as unknown as Record<string, unknown>,
    }
  }
  for (const loc of locators) {
    const absPath = join(vaultRoot, loc)
    let text: string
    try {
      text = readFileSync(absPath, "utf8")
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
      return {
        locator: loc,
        fm: doc.note.frontmatter as unknown as Record<string, unknown>,
      }
    }
  }
  return null
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!valuesEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as Record<string, unknown>).sort()
    const kb = Object.keys(b as Record<string, unknown>).sort()
    if (ka.length !== kb.length) return false
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return false
      const va = (a as Record<string, unknown>)[ka[i] as string]
      const vb = (b as Record<string, unknown>)[kb[i] as string]
      if (!valuesEqual(va, vb)) return false
    }
    return true
  }
  return false
}

export function frontmatterDiff(input: FrontmatterDiffInput): FrontmatterDiffReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (!input.targetA && !input.idA) {
    throw new Error("targetA or idA is required")
  }
  if (!input.targetB && !input.idB) {
    throw new Error("targetB or idB is required")
  }
  const t0 = Date.now()
  const a = findNote(input.vaultRoot, input.targetA, input.idA)
  if (!a) {
    throw new Error(`note A not found: targetA=${input.targetA ?? "-"} idA=${input.idA ?? "-"}`)
  }
  const b = findNote(input.vaultRoot, input.targetB, input.idB)
  if (!b) {
    throw new Error(`note B not found: targetB=${input.targetB ?? "-"} idB=${input.idB ?? "-"}`)
  }
  const keysA = new Set(Object.keys(a.fm))
  const keysB = new Set(Object.keys(b.fm))
  const added: string[] = []
  const removed: string[] = []
  const changed: FrontmatterFieldChange[] = []
  const unchanged: string[] = []
  for (const k of keysB) {
    if (!keysA.has(k)) {
      added.push(k)
    } else if (!valuesEqual(a.fm[k], b.fm[k])) {
      changed.push({ key: k, a: a.fm[k], b: b.fm[k] })
    } else {
      unchanged.push(k)
    }
  }
  for (const k of keysA) {
    if (!keysB.has(k)) {
      removed.push(k)
    }
  }
  added.sort()
  removed.sort()
  changed.sort((x, y) => x.key.localeCompare(y.key))
  unchanged.sort()
  return {
    vaultRoot: input.vaultRoot,
    aLocator: a.locator,
    bLocator: b.locator,
    added,
    removed,
    changed,
    unchanged,
    totalMs: Date.now() - t0,
  }
}
