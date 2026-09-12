/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M2-TEST — graph property validators (Plan V2.3.1 §199, ADR-002).
 * Pure functions over a parsed `WorkflowDefinition`. NOT Zod schemas.
 * Every function returns `ValidationIssue[]` with stable `code` +
 * `message`, suitable for editor diagnostics, linter passes, or
 * runtime topology checks.
 */
import type { WorkflowDefinition } from "../src/workflow-ir.ts"

export interface ValidationIssue {
  code: string
  message: string
  nodeId?: string
  edgeIndex?: number
}

const REPEAT_MAX = 1_000_000
const TRIGGERS = new Set(["trigger.manual", "trigger.schedule"])
const isTrigger = (f: string): boolean => TRIGGERS.has(f)

function adjacency(def: WorkflowDefinition): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const n of def.nodes) adj.set(n.id, [])
  for (const e of def.edges) {
    const list = adj.get(e.from)
    if (list) list.push(e.to)
  }
  return adj
}

/** Every edge must reference nodes that exist in the same definition. */
export function findOrphanEdgeReferences(
  def: WorkflowDefinition,
): ValidationIssue[] {
  const ids = new Set(def.nodes.map((n) => n.id))
  const issues: ValidationIssue[] = []
  def.edges.forEach((e, i) => {
    if (!ids.has(e.from))
      issues.push({ code: "EDGE_FROM_NOT_FOUND", message: `edge[${i}].from "${e.from}" not found`, edgeIndex: i })
    if (!ids.has(e.to))
      issues.push({ code: "EDGE_TO_NOT_FOUND", message: `edge[${i}].to "${e.to}" not found`, edgeIndex: i })
  })
  return issues
}

/** Detect cycles via DFS with white/gray/black coloring. */
export function findCycles(def: WorkflowDefinition): ValidationIssue[] {
  const adj = adjacency(def)
  const color = new Map<string, number>()
  for (const n of def.nodes) color.set(n.id, 0) // 0=white 1=gray 2=black
  const issues: ValidationIssue[] = []
  const path: string[] = []
  function visit(u: string): void {
    color.set(u, 1)
    path.push(u)
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? 0
      if (c === 1) {
        const i = path.indexOf(v)
        const cyc = i >= 0 ? path.slice(i).concat(v) : [u, v]
        issues.push({ code: "CYCLE_DETECTED", message: `cycle: ${cyc.join(" -> ")}`, nodeId: v })
      } else if (c === 0) visit(v)
    }
    path.pop()
    color.set(u, 2)
  }
  for (const n of def.nodes) if (color.get(n.id) === 0) visit(n.id)
  return issues
}

/** Entry points = trigger nodes OR nodes with no incoming AND ≥1 outgoing. */
export function findUnreachableNodes(def: WorkflowDefinition): ValidationIssue[] {
  const inc = new Map<string, number>()
  const out = new Map<string, number>()
  for (const n of def.nodes) {
    inc.set(n.id, 0)
    out.set(n.id, 0)
  }
  for (const e of def.edges) {
    if (inc.has(e.to)) inc.set(e.to, (inc.get(e.to) ?? 0) + 1)
    if (out.has(e.from)) out.set(e.from, (out.get(e.from) ?? 0) + 1)
  }
  const entries: string[] = []
  for (const n of def.nodes)
    if (isTrigger(n.family) || ((inc.get(n.id) ?? 0) === 0 && (out.get(n.id) ?? 0) > 0))
      entries.push(n.id)
  const adj = adjacency(def)
  const seen = new Set(entries)
  const queue = [...entries]
  while (queue.length) {
    const u = queue.shift()!
    for (const v of adj.get(u) ?? [])
      if (!seen.has(v)) {
        seen.add(v)
        queue.push(v)
      }
  }
  const issues: ValidationIssue[] = []
  for (const n of def.nodes)
    if (!seen.has(n.id) && !isTrigger(n.family))
      issues.push({ code: "UNREACHABLE_NODE", message: `node "${n.id}" not reachable from any entry point`, nodeId: n.id })
  return issues
}

/** A `control.merge` should pair with an upstream `control.parallel`. */
export function findUnpairedParallelMerge(def: WorkflowDefinition): ValidationIssue[] {
  const targets = new Set<string>()
  for (const n of def.nodes) {
    if (n.family !== "control.parallel") continue
    const cfg = n.config as { branches?: { target?: unknown }[] }
    if (!Array.isArray(cfg?.branches)) continue
    for (const b of cfg.branches)
      if (b && typeof b.target === "string") targets.add(b.target)
  }
  const issues: ValidationIssue[] = []
  for (const n of def.nodes) {
    if (n.family !== "control.merge") continue
    const cfg = n.config as { branches?: unknown }
    const br = cfg?.branches
    if (!Array.isArray(br) || br.length === 0) {
      issues.push({ code: "MERGE_WITHOUT_PARALLEL", message: `control.merge "${n.id}" has no branches`, nodeId: n.id })
      continue
    }
    const paired = br.some((b) => typeof b === "string" && targets.has(b))
    if (!paired)
      issues.push({ code: "MERGE_WITHOUT_PARALLEL", message: `control.merge "${n.id}" has no upstream control.parallel pairing`, nodeId: n.id })
  }
  return issues
}

/** `control.repeat` must declare a finite `maxIterations`. */
export function findUnboundedLoops(def: WorkflowDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const n of def.nodes) {
    if (n.family !== "control.repeat") continue
    const cfg = n.config as { maxIterations?: unknown }
    const max = cfg?.maxIterations
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1) {
      issues.push({ code: "REPEAT_UNBOUNDED", message: `control.repeat "${n.id}" non-finite maxIterations: ${String(max)}`, nodeId: n.id })
      continue
    }
    if (max > REPEAT_MAX)
      issues.push({ code: "REPEAT_TOO_LARGE", message: `control.repeat "${n.id}" maxIterations=${max} exceeds ${REPEAT_MAX}`, nodeId: n.id })
  }
  return issues
}

/** Stable map key derivation. Idempotent under input reordering. */
export function deriveMapKey(
  keySpec: { strategy: "field"; field: string } | { strategy: "hash" },
  item: unknown,
): string {
  if (keySpec.strategy === "field") {
    if (item === null || typeof item !== "object")
      throw new Error(`deriveMapKey: field strategy requires an object, got ${typeof item}`)
    const v = (item as Record<string, unknown>)[keySpec.field]
    if (v === undefined || v === null) throw new Error(`deriveMapKey: item is missing field "${keySpec.field}"`)
    return String(v)
  }
  return stableStringify(item)
}

function stableStringify(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const parts = Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
    return "{" + parts.join(",") + "}"
  }
  return JSON.stringify(value)
}
