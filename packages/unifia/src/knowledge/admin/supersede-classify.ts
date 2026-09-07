/* SPDX-License-Identifier: MIT */
/**
 * Supersede classification (P11.49).
 *
 * Walks the canonical vault and classifies each note by its
 * position in the supersede graph:
 *  - `isolated`  : no supersedes AND no successor (totally alone)
 *  - `root`      : has supersedes, no successor
 *  - `leaf`      : no supersedes, has successor
 *  - `chain`     : has both supersedes and successors
 *
 * The classification is a coarse partitioning of the corpus
 * into supersede-graph roles. Useful for understanding how
 * the graph is structured and which notes are the "leaves"
 * (candidates for archival) or the "roots" (active notes
 * that supersede others).
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeId, KnowledgeLocator, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

export type SupersedeRole = "isolated" | "root" | "leaf" | "chain"

export interface ClassifiedNote {
  id: KnowledgeId
  locator: KnowledgeLocator
  type: string
  lifecycle: KnowledgeLifecycleState
  role: SupersedeRole
  supersedesCount: number
  successorCount: number
}

export interface ClassifyInput {
  vaultRoot: string
}

export interface ClassifyReport {
  vaultRoot: string
  scanned: number
  byRole: Record<SupersedeRole, ClassifiedNote[]>
  totalByRole: Record<SupersedeRole, number>
  totalMs: number
}

export function classifySupersede(input: ClassifyInput): ClassifyReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const byId = new Map<KnowledgeId, { locator: KnowledgeLocator; type: string; lifecycle: KnowledgeLifecycleState }>()
  const supersedesBy = new Map<KnowledgeId, KnowledgeId[]>()
  for (const loc of locators) {
    let text: string
    try {
      text = readFileSync(join(input.vaultRoot, loc), "utf8")
    } catch {
      continue
    }
    let doc: ReturnType<typeof parseDocument>
    try {
      doc = parseDocument(text)
    } catch {
      continue
    }
    const fm = doc.note.frontmatter
    const id = fm.unifia_id as KnowledgeId
    byId.set(id, {
      locator: loc as KnowledgeLocator,
      type: fm.unifia_type,
      lifecycle: fm.unifia_lifecycle as KnowledgeLifecycleState,
    })
    supersedesBy.set(id, fm.unifia_supersedes as KnowledgeId[])
  }
  // Build reverse map: which notes are declared as predecessors?
  const successorCount = new Map<KnowledgeId, number>()
  for (const [, preds] of supersedesBy) {
    for (const p of preds) {
      successorCount.set(p, (successorCount.get(p) ?? 0) + 1)
    }
  }
  const byRole: Record<SupersedeRole, ClassifiedNote[]> = {
    isolated: [],
    root: [],
    leaf: [],
    chain: [],
  }
  let scanned = 0
  for (const [id, info] of byId) {
    scanned += 1
    const supersedes = supersedesBy.get(id) ?? []
    const succ = successorCount.get(id) ?? 0
    let role: SupersedeRole
    if (supersedes.length === 0 && succ === 0) role = "isolated"
    else if (supersedes.length > 0 && succ === 0) role = "root"
    else if (supersedes.length === 0 && succ > 0) role = "leaf"
    else role = "chain"
    byRole[role].push({
      id,
      locator: info.locator,
      type: info.type,
      lifecycle: info.lifecycle,
      role,
      supersedesCount: supersedes.length,
      successorCount: succ,
    })
  }
  // Sort each role by locator.
  for (const role of Object.keys(byRole) as SupersedeRole[]) {
    byRole[role].sort((a, b) => a.locator.localeCompare(b.locator))
  }
  const totalByRole: Record<SupersedeRole, number> = {
    isolated: byRole.isolated.length,
    root: byRole.root.length,
    leaf: byRole.leaf.length,
    chain: byRole.chain.length,
  }
  return {
    vaultRoot: input.vaultRoot,
    scanned,
    byRole,
    totalByRole,
    totalMs: Date.now() - t0,
  }
}
