/* SPDX-License-Identifier: MIT */

import { parseSpec, resolveEffectiveCapabilities, type Spec } from "@unifia/spec-runtime"

export type DesignSpecSource = { kind: "inline"; value: string } | { kind: "file"; path: string; value: string }
export type DesignSpecDiagnostic = { severity: "error"; message: string; line: number; column: number }
export type DesignSpecPanelState = {
  source: DesignSpecSource
  // V04 — explicit terminal "empty" state. `true` means the source is
  // blank or whitespace-only: no parse attempted, no diagnostic, no
  // spec. The editor uses this to skip the danger banner and the
  // fallback "JSON invalid" message so the user sees a neutral
  // placeholder before typing. Distinguishing `empty` from
  // `diagnostics.length === 0` (a *valid* spec) matters: both have
  // no diagnostics but the empty state must not be treated as parsed.
  empty: boolean
  spec?: Spec
  diagnostics: readonly DesignSpecDiagnostic[]
  capabilities: { granted: readonly string[]; denied: readonly string[] }
}

function location(source: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, source.length))
  const prefix = source.slice(0, bounded)
  const lines = prefix.split("\n")
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function syntaxLocation(source: string, message: string): { line: number; column: number } {
  const lineAndColumn = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  if (lineAndColumn) return { line: Number(lineAndColumn[1]), column: Number(lineAndColumn[2]) }
  const position = message.match(/position\s+(\d+)/i)?.[1]
  return location(source, position ? Number(position) : source.length)
}

/** Parses one untrusted design spec into a renderable panel state. */
export function createDesignSpecPanelState(source: DesignSpecSource): DesignSpecPanelState {
  // V04 — empty / whitespace input is a separate, neutral state. No
  // parse attempt, no diagnostic, no spec. The audit caught the panel
  // rendering "expected property name or '}'" as a red banner the
  // moment the textarea was cleared. The remote validation query is
  // already short-circuited on `source.trim().length > 0`; this brings
  // the local model in line.
  if (source.value.trim() === "") {
    return { source, empty: true, diagnostics: [], capabilities: { granted: [], denied: [] } }
  }
  try {
    const spec = parseSpec(source.value)
    const capabilities = resolveEffectiveCapabilities(spec, [])
    return { source, empty: false, spec, diagnostics: [], capabilities }
  } catch (error) {
    const message = error instanceof Error ? error.message : "spec validation failed"
    const position = message.includes("valid JSON") ? syntaxLocation(source.value, message) : location(source.value, 0)
    return { source, empty: false, diagnostics: [{ severity: "error", message, ...position }], capabilities: { granted: [], denied: [] } }
  }
}
