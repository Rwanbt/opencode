/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Transform executor (Phase 1) � deterministic and bounded. No
 * arbitrary code: every field is either a literal or an expression in
 * the existing bounded expression language (same engine, same limits
 * as `$node` refs and branch conditions).
 *
 * Covered: projection (`{a: <expr>}`), rename (assign under a new
 * key), object construction (nested literals), primitive/list access
 * (`.`/`[]`), simple conditions (ternary, already in the grammar).
 * Anything else is a typed error, never a silent drop.
 */
import { evaluateNodeRefs, type CompletedOutputs } from "./env.js"
import { NodeExecutionError, NODE_TRANSFORM_MAX_FIELDS } from "./io.js"

export type TransformConfig = {
  /** Field assignments; each expression is evaluated independently
   * against the `$node` env (fields cannot read sibling fields). */
  readonly fields: Record<string, string>
}

export function parseTransformConfig(config: Record<string, unknown>): TransformConfig {
  const fields = config["fields"]
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    throw new NodeExecutionError("TRANSFORM_INVALID", "transform node needs a fields object mapping names to expressions", false)
  }
  const entries = Object.entries(fields as Record<string, unknown>)
  if (entries.length === 0) {
    throw new NodeExecutionError("TRANSFORM_INVALID", "transform node needs at least one field", false)
  }
  if (entries.length > NODE_TRANSFORM_MAX_FIELDS) {
    throw new NodeExecutionError("TRANSFORM_INVALID", `transform node exceeds ${NODE_TRANSFORM_MAX_FIELDS} fields`, false)
  }
  for (const [name, expr] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new NodeExecutionError("TRANSFORM_INVALID", `transform field name must be an identifier: ${JSON.stringify(name)}`, false)
    }
    if (typeof expr !== "string" || expr.length === 0) {
      throw new NodeExecutionError("TRANSFORM_INVALID", `transform field ${JSON.stringify(name)} must be a non-empty expression string`, false)
    }
  }
  return { fields: fields as Record<string, string> }
}

export function executeTransform(
  config: TransformConfig,
  outputs: CompletedOutputs,
  knownNodeIds: readonly string[],
  completedIds: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  try {
    for (const [name, expr] of Object.entries(config.fields)) {
      out[name] = evaluateNodeRefs(expr, outputs, knownNodeIds, completedIds)
    }
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error
    throw error
  }
  return out
}
