/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `$node` references (Phase 1) � integrated into the existing bounded
 * expression engine, not a second DSL.
 *
 * Canonical form: `$node["<stable-id>"].json.<path>`; `$node.<id>.<path>`
 * works for identifier-safe ids. Brackets do NOT alias display names:
 * they address the same stable-id map for ids that dot syntax cannot
 * spell (hyphens, spaces). There is no display-name alias table, by
 * design — renames never break refs because refs never use names.
 * Both forms parse with the existing grammar once `$` lexes as an
 * identifier start.
 *
 * Decisions (explicit):
 * - Canonical keys are STABLE NODE IDS. Display names resolve only via
 *   the bracket-string form against the same object � no alias table
 *   to drift or rename.
 * - Only COMPLETED nodes are visible. A ref to a known-but-unexecuted
 *   node is NODE_NOT_EXECUTED (never null, never stale data).
 * - A ref to an unknown id is NODE_UNKNOWN_REFERENCE (checked
 *   statically against the definition, fail-closed before dispatch).
 * - A missing path inside a present output is NODE_PATH_MISSING;
 *   a container-type violation is NODE_TYPE_MISMATCH. Both are
 *   deterministic and inspectable � never silent nulls.
 * - Cycles are impossible: the env holds completed outputs only, and
 *   the graph is validated before execution.
 * - Dynamic (non-literal) indices skip the static check and evaluate
 *   with existing evaluator semantics.
 */
import { parseExpression, evaluateExpression, type AstNode, type CelValue } from "@unifia/expression-runtime"
import { NodeExecutionError } from "./io.js"

export type CompletedOutputs = ReadonlyMap<string, unknown>

export function buildNodeEnv(outputs: CompletedOutputs): Record<string, unknown> {
  return { $node: Object.fromEntries(outputs) }
}

type Chain = { nodeId: string; segments: readonly (string | number)[] }

function chainOf(node: AstNode): Chain | null {
  // Longest `$node`-rooted chain through member links and LITERAL index
  // links. Dynamic indices stop the chain (their subexpressions are
  // still walked by collectNodeChains).
  const segments: (string | number)[] = []
  let current: AstNode = node
  for (;;) {
    if (current.kind === "member") {
      segments.unshift(current.property)
      current = current.object
      continue
    }
    if (current.kind === "binary" && current.op === "[]") {
      if (current.right.kind !== "lit") return null
      const key = current.right.value
      if (typeof key !== "string" && typeof key !== "number") return null
      segments.unshift(key)
      current = current.left
      continue
    }
    if (current.kind === "id" && current.name === "$node") {
      const [nodeId, ...rest] = segments
      if (typeof nodeId !== "string") return null
      return { nodeId, segments: rest }
    }
    return null
  }
}

function collectNodeChains(node: AstNode, out: Chain[]): void {
  const found = chainOf(node)
  if (found) out.push(found)
  switch (node.kind) {
    case "id":
    case "lit":
      return
    case "member":
      collectNodeChains(node.object, out)
      return
    case "binary":
      collectNodeChains(node.left, out)
      collectNodeChains(node.right, out)
      return
    case "unary":
      collectNodeChains(node.operand, out)
      return
    case "ternary":
      collectNodeChains(node.condition, out)
      collectNodeChains(node.then, out)
      collectNodeChains(node.else, out)
      return
    case "list":
      for (const item of node.items) collectNodeChains(item, out)
      return
  }
}
function checkChain(chain: Chain, outputs: CompletedOutputs, completedIds: ReadonlySet<string>): void {
  const output = outputs.get(chain.nodeId)
  if (output === undefined || !completedIds.has(chain.nodeId)) {
    throw new NodeExecutionError("NODE_NOT_EXECUTED", `node has no completed output: ${chain.nodeId}`, false)
  }
  let current: unknown = output
  const path = [`$node[${JSON.stringify(chain.nodeId)}]`]
  for (const segment of chain.segments) {
    if (typeof segment === "string") {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        throw new NodeExecutionError("NODE_TYPE_MISMATCH", `cannot access .${segment} on non-object at ${path.join("")}`, false)
      }
      if (!(segment in (current as Record<string, unknown>))) {
        throw new NodeExecutionError("NODE_PATH_MISSING", `missing field .${segment} at ${path.join("")}`, false)
      }
      path.push(`.${segment}`)
      current = (current as Record<string, unknown>)[segment]
      continue
    }
    if (!Array.isArray(current)) {
      throw new NodeExecutionError("NODE_TYPE_MISMATCH", `cannot index non-list at ${path.join("")}`, false)
    }
    if (segment < 0 || segment >= current.length) {
      throw new NodeExecutionError("NODE_PATH_MISSING", `index ${segment} out of bounds at ${path.join("")}`, false)
    }
    path.push(`[${segment}]`)
    current = current[segment]
  }
}

/**
 * Validate every `$node` chain in `source` against the definition
 * (unknown ids) and the completed outputs (execution state, paths),
 * then evaluate with the existing engine. Throws typed
 * `NodeExecutionError` (refs) or `ExpressionError` (syntax/bounds).
 */
export function evaluateNodeRefs(
  source: string,
  outputs: CompletedOutputs,
  knownNodeIds: readonly string[],
  completedIds: ReadonlySet<string>,
): CelValue {
  const ast = parseExpression(source)
  const chains: Chain[] = []
  collectNodeChains(ast.root, chains)
  // Recursion re-derives sub-chains; validate each distinct chain once.
  const seen = new Set<string>()
  const distinct = chains.filter((chain) => {
    const key = JSON.stringify([chain.nodeId, chain.segments])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const known = new Set(knownNodeIds)
  for (const chain of distinct) {
    if (!known.has(chain.nodeId)) {
      throw new NodeExecutionError("NODE_UNKNOWN_REFERENCE", `unknown node id in $node ref: ${chain.nodeId}`, false)
    }
  }
  for (const chain of distinct) checkChain(chain, outputs, completedIds)
  return evaluateExpression(ast, { $node: Object.fromEntries(outputs) })
}
export function extractNodeRefIds(source: string): readonly string[] {
  const ast = parseExpression(source)
  const chains: Chain[] = []
  collectNodeChains(ast.root, chains)
  const seen = new Set<string>()
  const out: string[] = []
  for (const chain of chains) {
    if (!seen.has(chain.nodeId)) {
      seen.add(chain.nodeId)
      out.push(chain.nodeId)
    }
  }
  return out
}
export function collectConfigNodeRefs(config: unknown): string[] {
  const out: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.includes("$node")) out.push(...extractNodeRefIds(value))
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item)
    }
  }
  walk(config)
  return [...new Set(out)]
}
