/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Pure helpers for parsing workflow definition files served by the
 * Workbench wire bridge.
 *
 * Extracted from `automate-surface.tsx` so the surface remains a thin
 * SolidJS view while the parsing logic becomes testable in plain Node
 * (no `useWorkspaceWorkbench` mock, no TanStack Query mock, no
 * SolidJS router — those are exercised in e2e).
 *
 * C-PRE1-01 phase 2: this extraction is the smallest refactor that
 * unblocks a real round-trip test for `decodeFile`. Behaviour is
 * preserved bit-for-bit; the only change is that the helper is now
 * importable from a sibling test file.
 */

export type WorkbenchFileEncoding = "utf-8" | "base64"

export type WorkbenchFilePayload = {
  readonly content: string
  readonly encoding: WorkbenchFileEncoding
}

/**
 * Decodes a file payload fetched from the Workbench server.
 *
 * - `utf-8` is returned as-is.
 * - `base64` is decoded into UTF-8 bytes via `TextDecoder`. The current
 *   `atob` path is the legacy decoder; ADR-001 (canonicalization) will
 *   require a `Buffer` round-trip for the substrate-grade path.
 */
export function decodeFile(value: WorkbenchFilePayload): string {
  if (value.encoding === "utf-8") return value.content
  const bytes = Uint8Array.from(atob(value.content), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Parses a JSON-encoded workflow definition body and validates the
 * minimum shape required by the current runtime. This is the surface
 * check that already exists in `automate-surface.tsx`; centralised here
 * so the error messages and the contract are testable, and so ADR-002
 * (WorkflowIR) can replace this with a strict Zod validator without
 * touching the surface.
 */
export type ParsedWorkflowDefinition = {
  readonly id: string
  readonly version: number
  readonly steps: readonly unknown[]
}

export type ParseWorkflowDefinitionResult =
  | { kind: "ok"; definition: ParsedWorkflowDefinition }
  | { kind: "error"; message: string }

export function parseWorkflowDefinition(json: string): ParseWorkflowDefinitionResult {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "invalid JSON" }
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) return { kind: "error", message: "id must be a non-empty string" }
  if (raw.version !== 1) return { kind: "error", message: "version must be exactly 1" }
  if (!Array.isArray(raw.steps)) return { kind: "error", message: "steps must be an array" }
  return { kind: "ok", definition: { id: raw.id, version: 1, steps: raw.steps } }
}
