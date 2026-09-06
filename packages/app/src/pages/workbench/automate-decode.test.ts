/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { decodeFile, parseWorkflowDefinition } from "./automate-decode"

// C-PRE1-01 phase 2 — round-trip tests for the extracted helpers.
//
// Phase 1 (`automate-surface.test.ts`) verifies the surface shape by
// reading the source file. Phase 2 imports the extracted helpers and
// tests their behavior directly. The extraction lives in
// `automate-decode.ts` and is wired back into the surface in
// `automate-surface.tsx` (which still uses the helper for the
// start-selected-workflow path).

describe("decodeFile", () => {
  test("returns utf-8 content unchanged", () => {
    expect(decodeFile({ content: "hello", encoding: "utf-8" })).toBe("hello")
  })

  test("decodes base64 utf-8 bytes to the original string", () => {
    // "héllo" in utf-8 = 0x68 0xC3 0xA9 0x6C 0x6C 0x6F = base64 "aMOpbGxv"
    expect(decodeFile({ content: "aMOpbGxv", encoding: "base64" })).toBe("héllo")
  })

  test("decodes base64 empty content to empty string", () => {
    expect(decodeFile({ content: "", encoding: "base64" })).toBe("")
  })

  test("decodes a realistic workflow definition body round-trip", () => {
    const body = JSON.stringify({
      id: "wf-1",
      version: 1,
      steps: [
        { id: "prepare", capability: "workspace.read", input: {} },
        { id: "publish", capability: "artifact.export", input: {}, requiresApproval: true },
      ],
    })
    const encoded = btoa(body)
    const decoded = decodeFile({ content: encoded, encoding: "base64" })
    expect(decoded).toBe(body)
    // The decoded body parses back to the same shape.
    expect(JSON.parse(decoded)).toEqual({
      id: "wf-1",
      version: 1,
      steps: [
        { id: "prepare", capability: "workspace.read", input: {} },
        { id: "publish", capability: "artifact.export", input: {}, requiresApproval: true },
      ],
    })
  })
})

describe("parseWorkflowDefinition", () => {
  test("accepts a valid workflow definition", () => {
    const result = parseWorkflowDefinition(
      JSON.stringify({ id: "wf-1", version: 1, steps: [{ id: "s1", capability: "workspace.read", input: {} }] }),
    )
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.definition.id).toBe("wf-1")
      expect(result.definition.version).toBe(1)
      expect(result.definition.steps).toHaveLength(1)
    }
  })

  test("rejects an empty body", () => {
    const result = parseWorkflowDefinition("")
    expect(result.kind).toBe("error")
  })

  test("rejects malformed JSON with a descriptive message", () => {
    const result = parseWorkflowDefinition("{not json")
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.message).toMatch(/JSON|Unexpected token/i)
    }
  })

  test("rejects a missing id", () => {
    const result = parseWorkflowDefinition(JSON.stringify({ version: 1, steps: [] }))
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.message).toBe("id must be a non-empty string")
    }
  })

  test("rejects an empty id", () => {
    const result = parseWorkflowDefinition(JSON.stringify({ id: "", version: 1, steps: [] }))
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.message).toBe("id must be a non-empty string")
    }
  })

  test("rejects a non-1 version (current runtime contract)", () => {
    const result = parseWorkflowDefinition(JSON.stringify({ id: "wf-1", version: 2, steps: [] }))
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.message).toBe("version must be exactly 1")
    }
  })

  test("rejects a missing steps array", () => {
    const result = parseWorkflowDefinition(JSON.stringify({ id: "wf-1", version: 1 }))
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.message).toBe("steps must be an array")
    }
  })

  test("accepts a definition with an empty steps array (current runtime allows it; the workflow-catalog rejects it elsewhere)", () => {
    // The current `WorkflowRuntime` accepts an empty steps array (it
    // marks the run "completed" immediately). The new contract from
    // `workflow-catalog/src` rejects it. This pins the current
    // contract so a future migration to the strict contract is a
    // deliberate decision, not a silent drift.
    const result = parseWorkflowDefinition(JSON.stringify({ id: "wf-1", version: 1, steps: [] }))
    expect(result.kind).toBe("ok")
  })
})
