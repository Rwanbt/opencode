/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Canonical node I/O model (Phase 1).
 *
 * WHY four shapes instead of one blob: configuration (authored, static),
 * runtime input (resolved, per attempt), runtime output (produced, typed)
 * and execution metadata answer different questions (replay? billing?
 * debug?) and have different redaction rules. A single `unknown` blob
 * would force every consumer to guess.
 */
import type { SecretRedactor } from "../native-attempts.js"

/** Static node configuration as authored (URLs, field maps, policies). */
export type NodeConfig = Record<string, unknown>

/** Runtime input: config with every `$node`/expression resolved. */
export type NodeResolvedInput = Record<string, unknown>

/** Runtime output payload. Must stay JSON-shaped and bounded. */
export type NodeOutputData = Record<string, unknown>

/** Execution metadata attached to every produced output. `attemptId` is
 * null for pure local executions (transform) that mint no attempt; it is
 * the effect attempt id for side-effecting nodes. */
export type NodeOutputMeta = {
  readonly attemptId: string | null
  readonly durationMs: number
  readonly bytes: number
}

/** Typed node failure. `retryable` advises the FailurePolicy path. */
export class NodeExecutionError extends Error {
  constructor(
    readonly code:
      | "NODE_CONFIG_INVALID"
      | "NODE_UNKNOWN_REFERENCE"
      | "NODE_NOT_EXECUTED"
      | "NODE_PATH_MISSING"
      | "NODE_TYPE_MISMATCH"
      | "NODE_EXPRESSION_ERROR"
      | "HTTP_NETWORK_ERROR"
      | "HTTP_TIMEOUT"
      | "HTTP_STATUS_ERROR"
      | "HTTP_RESPONSE_TOO_LARGE"
      | "HTTP_OUTPUT_TOO_LARGE"
      | "TRANSFORM_INVALID"
      | "DRIVER_BUDGET_EXCEEDED"
      | "NODE_EXECUTOR_ERROR"
      | "NODE_CAPABILITY_DENIED"
      | "NODE_CANCELLED",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = "NodeExecutionError"
  }
}

/** Bounds: explicit, deterministic, tested. */
export const NODE_OUTPUT_MAX_BYTES = 262144
export const NODE_HTTP_RESPONSE_MAX_BYTES = 1048576
export const NODE_HTTP_TIMEOUT_MS = 30000
export const NODE_HTTP_MAX_REDIRECTS = 3
export const NODE_TRANSFORM_MAX_FIELDS = 128

/** Key names redacted from observability copies (never from execution facts). */
const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|api[-_]?key|authorization|cookie|set-cookie|bearer|private[-_]?key|client[-_]?secret)/i

function redactKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactKeys)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactKeys(item)
    }
    return out
  }
  return value
}

/**
 * Redact a per-node input/output copy for observability (journal,
 * projections, API responses). Execution facts themselves stay exact �
 * redaction applies to COPIES only, so downstream `$node` refs and
 * reconciliation always see true data.
 */
export function redactNodeData(value: unknown, redactor?: Pick<SecretRedactor, "redact">): unknown {
  const keyed = redactKeys(value)
  return redactor ? redactor.redact(keyed) : keyed
}
