/* SPDX-License-Identifier: MIT */
/**
 * Lifecycle distribution (P11.38).
 *
 * Walks the vault and produces a 2D matrix of `lifecycle x type`
 * with note counts. Returns the matrix plus the totals and a flat
 * "shape" of the vault. Useful as a quick health overview.
 *
 * Lifecycle set is the V1 set:
 * `candidate | active | superseded | archived`.
 *
 * Pure / read-only.
 */

import { listMarkdownLocators } from "../classb/reachability.js"
import { parseDocument } from "../parser/parser.js"
import { readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { KnowledgeLifecycleState, MemoryType } from "@unifia/contracts/knowledge"

const V1_LIFECYCLES: readonly KnowledgeLifecycleState[] = [
  "candidate",
  "active",
  "superseded",
  "archived",
]

const V1_TYPES: readonly MemoryType[] = [
  "decision",
  "constraint",
  "preference",
  "failure",
  "learning",
  "procedure",
  "reference",
  "semantic",
  "episodic",
]

export interface LifecycleDistributionInput {
  vaultRoot: string
}

export interface LifecycleDistributionReport {
  vaultRoot: string
  scanned: number
  /** 2D matrix: `matrix[lifecycle][type] = count`. Missing cells = 0. */
  matrix: Record<KnowledgeLifecycleState, Record<MemoryType, number>>
  /** Per-lifecycle totals. */
  lifecycleTotals: Record<KnowledgeLifecycleState, number>
  /** Per-type totals. */
  typeTotals: Record<MemoryType, number>
  /** Grand total. */
  total: number
  /** Notes whose type is outside the V1 set (unknown). */
  unknownTypeCount: number
  /** Notes whose lifecycle is outside the V1 set (illegal). */
  unknownLifecycleCount: number
  totalMs: number
}

function emptyMatrix(): LifecycleDistributionReport["matrix"] {
  const m: Partial<LifecycleDistributionReport["matrix"]> = {}
  for (const lc of V1_LIFECYCLES) {
    const row: Partial<Record<MemoryType, number>> = {}
    for (const t of V1_TYPES) row[t] = 0
    m[lc] = row as Record<MemoryType, number>
  }
  return m as LifecycleDistributionReport["matrix"]
}

function emptyTotals<T extends string>(keys: readonly T[]): Record<T, number> {
  const out = {} as Record<T, number>
  for (const k of keys) out[k] = 0
  return out
}

export function lifecycleDistribution(input: LifecycleDistributionInput): LifecycleDistributionReport {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  const t0 = Date.now()
  const locators = listMarkdownLocators(input.vaultRoot)
  const matrix = emptyMatrix()
  const lifecycleTotals = emptyTotals(V1_LIFECYCLES)
  const typeTotals = emptyTotals(V1_TYPES)
  let scanned = 0
  let total = 0
  let unknownTypeCount = 0
  let unknownLifecycleCount = 0

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
    total += 1
    const fm = doc.note.frontmatter
    const lc = fm.unifia_lifecycle as KnowledgeLifecycleState
    const ty = fm.unifia_type as MemoryType
    const lcKnown = (V1_LIFECYCLES as readonly string[]).includes(lc)
    const tyKnown = (V1_TYPES as readonly string[]).includes(ty)
    if (!lcKnown) unknownLifecycleCount += 1
    if (!tyKnown) unknownTypeCount += 1
    if (lcKnown) lifecycleTotals[lc] = (lifecycleTotals[lc] ?? 0) + 1
    if (tyKnown) typeTotals[ty] = (typeTotals[ty] ?? 0) + 1
    if (lcKnown && tyKnown) {
      const row = matrix[lc]
      if (row) {
        row[ty] = (row[ty] ?? 0) + 1
      }
    }
  }

  return {
    vaultRoot: input.vaultRoot,
    scanned,
    matrix,
    lifecycleTotals,
    typeTotals,
    total,
    unknownTypeCount,
    unknownLifecycleCount,
    totalMs: Date.now() - t0,
  }
}
