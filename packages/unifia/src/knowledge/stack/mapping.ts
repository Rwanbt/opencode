/* SPDX-License-Identifier: MIT */
/**
 * ai-native-dev-stack mapping (P6.1).
 *
 * Per runbook §16 Phase 6: map `AGENTS.md`, `AI_CONTEXT.md`,
 * `AI_SUMMARY.md`, ADR, failure patterns, Graphify, hooks,
 * skills, and anti-debt into Knowledge Spaces, without
 * increasing their authority.
 *
 * The mapping is a pure function: input is a list of source
 * files (paths or buffers), output is a list of knowledge
 * intents.
 */

import type {
  KnowledgeId,
  KnowledgeLocator,
  MemoryType,
  KnowledgeLifecycleState,
} from "@unifia/contracts/knowledge"

export type StackSourceKind =
  | "AGENTS.md"
  | "AI_CONTEXT.md"
  | "AI_SUMMARY.md"
  | "ADR"
  | "FAILURE_PATTERN"
  | "GRAPHIFY"
  | "HOOK"
  | "SKILL"
  | "ANTI_DEBT"
  | "OTHER"

export interface StackSource {
  kind: StackSourceKind
  path: string
  content: string
  /** Optional commit SHA. */
  commit?: string
}

export interface StackMapping {
  locator: KnowledgeLocator
  type: MemoryType
  lifecycle: KnowledgeLifecycleState
  /** Stable id assigned at mapping time (UUIDv7-like). */
  id: KnowledgeId
  /** The original source path. */
  sourcePath: string
  /** Provenance. */
  commit?: string
  /** Tags for retrieval. */
  tags: string[]
  /** Body (truncated to a sensible size). */
  body: string
}

const TYPE_FOR_KIND: Record<StackSourceKind, MemoryType> = {
  "AGENTS.md": "procedure",
  "AI_CONTEXT.md": "reference",
  "AI_SUMMARY.md": "reference",
  ADR: "decision",
  FAILURE_PATTERN: "failure",
  GRAPHIFY: "reference",
  HOOK: "procedure",
  SKILL: "procedure",
  ANTI_DEBT: "decision",
  OTHER: "reference",
}

const TAGS_FOR_KIND: Record<StackSourceKind, string[]> = {
  "AGENTS.md": ["source:agents-md", "stack:ai-native-dev-stack"],
  "AI_CONTEXT.md": ["source:ai-context", "stack:ai-native-dev-stack"],
  "AI_SUMMARY.md": ["source:ai-summary", "stack:ai-native-dev-stack"],
  ADR: ["source:adr", "stack:ai-native-dev-stack"],
  FAILURE_PATTERN: ["source:failure-pattern", "stack:ai-native-dev-stack"],
  GRAPHIFY: ["source:graphify", "stack:ai-native-dev-stack"],
  HOOK: ["source:hook", "stack:ai-native-dev-stack"],
  SKILL: ["source:skill", "stack:ai-native-dev-stack"],
  ANTI_DEBT: ["source:anti-debt", "stack:ai-native-dev-stack"],
  OTHER: ["source:stack-other"],
}

const MAX_BODY_BYTES = 64 * 1024

/** Map a `StackSource` to a `StackMapping` (no I/O). */
export function mapStackSource(source: StackSource, id: KnowledgeId): StackMapping {
  const body = source.content.length > MAX_BODY_BYTES
    ? source.content.slice(0, MAX_BODY_BYTES) + "\n…(truncated)…"
    : source.content
  const out: StackMapping = {
    locator: `UnifiaVault/stack/${source.kind}/${basename(source.path)}`,
    type: TYPE_FOR_KIND[source.kind],
    lifecycle: "active",
    id,
    sourcePath: source.path,
    tags: TAGS_FOR_KIND[source.kind],
    body,
  }
  if (source.commit !== undefined) out.commit = source.commit
  return out
}

/** Heuristic: pick a source kind from a path. */
export function classifySource(path: string): StackSourceKind {
  const base = basename(path).toUpperCase()
  if (base === "AGENTS.MD") return "AGENTS.md"
  if (base === "AI_CONTEXT.MD") return "AI_CONTEXT.md"
  if (base === "AI_SUMMARY.MD") return "AI_SUMMARY.md"
  if (base.startsWith("ADR-") || /^0\d{3,}-/.test(base)) return "ADR"
  if (base.includes("FAILURE") || base.includes("KNOWN_FAILURE")) return "FAILURE_PATTERN"
  if (base === "GRAPH.JSON" || base === "GRAPHIFY.JSON") return "GRAPHIFY"
  if (base.endsWith(".HOOK.TS") || base.endsWith(".HOOK.SH")) return "HOOK"
  if (base === "SKILL.MD" || base.startsWith("SKILL-")) return "SKILL"
  if (base.includes("ANTI-DEBT") || base.includes("DEBT")) return "ANTI_DEBT"
  return "OTHER"
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return i < 0 ? p : p.slice(i + 1)
}
