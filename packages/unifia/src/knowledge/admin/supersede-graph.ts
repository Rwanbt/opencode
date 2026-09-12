/* SPDX-License-Identifier: MIT */
/**
 * Supersede graph (P11.45).
 *
 * Walks the canonical vault and reports the supersede lineage
 * inferred from the `unifia_supersedes` field of each note.
 *
 * Each note in V1 can declare an array of predecessor ids
 * (the notes it supersedes). Together, these form a DAG of
 * supersession. This tool:
 *  - lists every note that declares at least one predecessor;
 *  - for each, prints the chain of predecessors (depth-first,
 *    bounded by the V1 maximum to prevent cycles);
 *  - flags dangling references (predecessor id not found in
 *    the vault);
 *  - reports summary counts (total edges, max depth, cycle
 *    candidates).
 *
 * Pure / read-only. No mutation, no remote calls.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

const MAX_DEPTH = 16

export interface SupersedeEdge {
  from: KnowledgeId
  fromLocator: KnowledgeLocator
  to: KnowledgeId
}

export interface SupersedeGraphInput {
  vaultRoot: string
}

export interface SupersedeGraphReport {
  vaultRoot: string
  edges: SupersedeEdge[]
  /** Locators whose `unifia_supersedes` array references an id not in the vault. */
  dangling: { locator: KnowledgeLocator; missingId: string }[]
  /** Top-3 deepest lineages (depth, locator). */
  deepest: { locator: KnowledgeLocator; depth: number }[]
  totalMs: number
}

interface NoteRecord {
  id: KnowledgeId
  locator: KnowledgeLocator
  supersedes: KnowledgeId[]
}

function readNote(vaultRoot: string, locator: string): NoteRecord | null {
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
    supersedes: doc.note.frontmatter.unifia_supersedes as KnowledgeId[],
  }
}

function depth(
  id: KnowledgeId,
  byId: Map<KnowledgeId, NoteRecord>,
  visited: Set<KnowledgeId>,
  acc: number,
): number {
  if (acc > MAX_DEPTH) return acc
  if (visited.has(id)) return acc
  visited.add(id)
  const rec = byId.get(id)
  if (!rec) return acc
  let maxChild = acc
  for (const child of rec.supersedes) {
    const d = depth(child, byId, visited, acc + 1)
    if (d > maxChild) maxChild = d
  }
  visited.delete(id)
  return maxChild
}

export function supersedeGraph(input: SupersedeGraphInput): SupersedeGraphReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const notes: NoteRecord[] = []
  for (const loc of locators) {
    const rec = readNote(input.vaultRoot, loc)
    if (rec) notes.push(rec)
  }
  const byId = new Map<KnowledgeId, NoteRecord>()
  for (const n of notes) byId.set(n.id, n)

  const edges: SupersedeEdge[] = []
  const dangling: { locator: KnowledgeLocator; missingId: string }[] = []
  for (const n of notes) {
    for (const pred of n.supersedes) {
      const target = byId.get(pred)
      if (!target) {
        dangling.push({ locator: n.locator, missingId: pred })
        continue
      }
      edges.push({ from: n.id, fromLocator: n.locator, to: pred })
    }
  }

  // Compute depth for each note.
  const deepest: { locator: KnowledgeLocator; depth: number }[] = []
  for (const n of notes) {
    if (n.supersedes.length === 0) continue
    const d = depth(n.id, byId, new Set(), 0)
    deepest.push({ locator: n.locator, depth: d })
  }
  deepest.sort((a, b) => b.depth - a.depth)
  deepest.splice(3) // top-3

  return {
    vaultRoot: input.vaultRoot,
    edges,
    dangling,
    deepest,
    totalMs: Date.now() - t0,
  }
}
