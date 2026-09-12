/* SPDX-License-Identifier: MIT */
/**
 * DataFlow guard for shell, plugins, MCP, and tool outputs.
 *
 * The plan gelé §7 P14 says: "Shell, filesystem, MCP, plugins et
 * tools sont dans le périmètre de sécurité." The `egress.ts`
 * module decides ContextItem-level egress; this module applies
 * the same `DataClassification` notion to command output and
 * filesystem content.
 *
 * The guard is intentionally minimal in V1: it classifies the
 * output of a shell command (stdout, stderr) and refuses writes
 * to disk that would propagate a `secret` classification without
 * a `DeclassificationGrant`.
 */

export type DataClassification = "public" | "internal" | "secret"

export interface DataFlowDecision {
  classification: DataClassification
  reason: string
}

/**
 * Heuristic classifier for a single string. Conservative: any
 * match of a secret-like pattern is `secret`.
 */
export function classifyText(input: string): DataFlowDecision {
  if (input.length === 0) return { classification: "public", reason: "empty" }
  // Private key block.
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(input)) {
    return { classification: "secret", reason: "private key block detected" }
  }
  // GitHub PAT.
  if (/ghp_[A-Za-z0-9]{30,}/.test(input)) {
    return { classification: "secret", reason: "GitHub personal access token" }
  }
  // OpenAI/Anthropic-style key.
  if (/sk-[A-Za-z0-9]{20,}/.test(input)) {
    return { classification: "secret", reason: "OpenAI/Anthropic-style key" }
  }
  // AWS access key.
  if (/AKIA[0-9A-Z]{16}/.test(input)) {
    return { classification: "secret", reason: "AWS access key" }
  }
  // Generic "token=..." in shell output.
  if (/([Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt])[=:]\s*[A-Za-z0-9_\-]{16,}/.test(input)) {
    return { classification: "secret", reason: "credential pattern" }
  }
  return { classification: "internal", reason: "no secret pattern" }
}

export interface WriteDecision {
  allowed: boolean
  reason: string
}

/** Decide whether a `secret`-classified payload may be written. */
export function decideWrite(
  classification: DataClassification,
  hasDeclassificationGrant: boolean,
): WriteDecision {
  if (classification !== "secret") return { allowed: true, reason: "not classified as secret" }
  if (hasDeclassificationGrant) return { allowed: true, reason: "declassification grant present" }
  return { allowed: false, reason: "secret content requires a declassification grant" }
}
