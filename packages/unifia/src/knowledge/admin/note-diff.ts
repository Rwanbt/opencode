/* SPDX-License-Identifier: MIT */
/**
 * Note diff (P11.50).
 *
 * Given two notes (by locator or id), diff their content. The
 * diff is line-based and unified: a single string with `+` and
 * `-` markers. The headers (frontmatter) are diffed separately
 * from the body to make lifecycle/type/project changes easy
 * to spot.
 *
 * Use cases:
 *  - compare two versions of a note (across history or
 *    two snapshots);
 *  - verify that a supersede candidate is materially different
 *    from its predecessor.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export interface NoteDiffInput {
  vaultRoot: string
  /** First note. Mutually exclusive with `noteAId`. */
  noteALocator?: KnowledgeLocator
  noteAId?: KnowledgeId
  /** Second note. Mutually exclusive with `noteBId`. */
  noteBLocator?: KnowledgeLocator
  noteBId?: KnowledgeId
}

export interface DiffLine {
  kind: "add" | "remove" | "context"
  content: string
}

export interface NoteDiffReport {
  vaultRoot: string
  noteA: { id: KnowledgeId; locator: KnowledgeLocator } | null
  noteB: { id: KnowledgeId; locator: KnowledgeLocator } | null
  frontmatterDiff: DiffLine[]
  bodyDiff: DiffLine[]
  added: number
  removed: number
  totalMs: number
}

function readNote(vaultRoot: string, locator: string): { id: KnowledgeId; locator: KnowledgeLocator; raw: string; body: string; frontmatter: string } | null {
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
  // Extract the frontmatter (between --- and ---)
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  const fm = m ? `${m[1]}\n` : ""
  const body = m ? text.slice((m[0] ?? "").length) : text
  return {
    id: doc.note.frontmatter.unifia_id as KnowledgeId,
    locator: locator as KnowledgeLocator,
    raw: text,
    body,
    frontmatter: fm,
  }
}

function findById(vaultRoot: string, id: KnowledgeId): string | null {
  for (const locator of listMarkdownLocators(vaultRoot)) {
    const rec = readNote(vaultRoot, locator)
    if (rec && rec.id === id) return locator
  }
  return null
}

/** Simple LCS-based line diff. Returns lines with kind + content. */
function lcsDiff(a: readonly string[], b: readonly string[]): DiffLine[] {
  const m = a.length
  const n = b.length
  // Build LCS table.
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        table[i]![j] = (table[i + 1]?.[j + 1] ?? 0) + 1
      } else {
        table[i]![j] = Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0)
      }
    }
  }
  // Walk the table to produce the diff.
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", content: a[i] ?? "" })
      i++
      j++
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      out.push({ kind: "remove", content: a[i] ?? "" })
      i++
    } else {
      out.push({ kind: "add", content: b[j] ?? "" })
      j++
    }
  }
  while (i < m) {
    out.push({ kind: "remove", content: a[i] ?? "" })
    i++
  }
  while (j < n) {
    out.push({ kind: "add", content: b[j] ?? "" })
    j++
  }
  return out
}

function diffString(a: string, b: string): { lines: DiffLine[]; added: number; removed: number } {
  const aLines = a.split("\n")
  const bLines = b.split("\n")
  const lines = lcsDiff(aLines, bLines)
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.kind === "add") added += 1
    else if (l.kind === "remove") removed += 1
  }
  return { lines, added, removed }
}

export function noteDiff(input: NoteDiffInput): NoteDiffReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (!input.noteALocator && !input.noteAId) {
    throw new Error("noteALocator or noteAId is required")
  }
  if (!input.noteBLocator && !input.noteBId) {
    throw new Error("noteBLocator or noteBId is required")
  }
  const t0 = Date.now()
  const aLoc = input.noteAId !== undefined ? findById(input.vaultRoot, input.noteAId) : input.noteALocator
  const bLoc = input.noteBId !== undefined ? findById(input.vaultRoot, input.noteBId) : input.noteBLocator
  const a = aLoc ? readNote(input.vaultRoot, aLoc) : null
  const b = bLoc ? readNote(input.vaultRoot, bLoc) : null
  if (!a) {
    throw new Error("noteA not found in vault")
  }
  if (!b) {
    throw new Error("noteB not found in vault")
  }
  const fmDiff = a && b
    ? diffString(a.frontmatter, b.frontmatter)
    : { lines: [], added: 0, removed: 0 }
  const bodyDiff = a && b
    ? diffString(a.body, b.body)
    : { lines: [], added: 0, removed: 0 }
  return {
    vaultRoot: input.vaultRoot,
    noteA: a ? { id: a.id, locator: a.locator } : null,
    noteB: b ? { id: b.id, locator: b.locator } : null,
    frontmatterDiff: fmDiff.lines,
    bodyDiff: bodyDiff.lines,
    added: fmDiff.added + bodyDiff.added,
    removed: fmDiff.removed + bodyDiff.removed,
    totalMs: Date.now() - t0,
  }
}
