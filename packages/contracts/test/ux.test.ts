/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * PostM3-R2 — UX (UX-01) (Plan V2.3.1 §230, ADR-002 cross-ref).
 *
 * Locked invariants (regression net, 8 tests):
 *   UX-01 Workflow editor (8):
 *     (1) EditorNodeSchema — parses a minimal valid node.
 *     (2) EditorNodeSchema — accepts all 11 documented family values
 *         (including the forward-looking `control.while` and
 *         `control.child` that the IR has not yet enabled).
 *     (3) EditorEdgeSchema — parses a minimal valid edge.
 *     (4) WorkflowEditorSchema — parses an empty editor (no nodes, no edges).
 *     (5) WorkflowEditorSchema — accepts the optional `draft` field.
 *     (6) WorkflowEditorSchema — accepts an editor with one of every
 *         documented family (sample full editor).
 *     (7) WorkflowEditorSchema — rejects an invalid WorkflowDefinition in `draft`.
 *     (8) parseWorkflowEditor — round-trips a valid editor through JSON.
 */
import { describe, expect, test } from "bun:test"
import {
  EDITOR_NODE_TYPE_VALUES,
  EditorNodeSchema,
  EditorEdgeSchema,
  parseWorkflowEditor,
} from "../src/ux.ts"

// =========================================================================
// UX-01 — Workflow editor
// =========================================================================

describe("UX-01 Editor node + edge", () => {
  test("(1) EditorNodeSchema_ParsesValid", () => {
    const parsed = EditorNodeSchema.parse({
      editorId: "en-1",
      family: "control.if",
      position: { x: 10, y: 20 },
    })
    expect(parsed.editorId).toBe("en-1")
    expect(parsed.family).toBe("control.if")
    expect(parsed.position).toEqual({ x: 10, y: 20 })
    expect(parsed.irNodeId).toBeUndefined()
  })

  test("(2) EditorNodeSchema_AcceptsAll11Families — incl. control.while and control.child", () => {
    expect(EDITOR_NODE_TYPE_VALUES).toHaveLength(11)
    for (const family of EDITOR_NODE_TYPE_VALUES) {
      const parsed = EditorNodeSchema.parse({
        editorId: `en-${family}`,
        family,
        position: { x: 0, y: 0 },
      })
      expect(parsed.family).toBe(family)
    }
  })

  test("(3) EditorEdgeSchema_ParsesValid", () => {
    const parsed = EditorEdgeSchema.parse({
      editorId: "ee-1",
      from: "en-1",
      to: "en-2",
    })
    expect(parsed.editorId).toBe("ee-1")
    expect(parsed.from).toBe("en-1")
    expect(parsed.to).toBe("en-2")
  })
})

describe("UX-01 Workflow editor — payload", () => {
  test("(4) WorkflowEditorSchema_ParsesEmpty — no nodes, no edges", () => {
    const parsed = parseWorkflowEditor({ nodes: [], edges: [] })
    expect(parsed.nodes).toEqual([])
    expect(parsed.edges).toEqual([])
    expect(parsed.draft).toBeUndefined()
  })

  test("(5) WorkflowEditorSchema_AcceptsOptionalDraft — WorkflowDefinition in draft", () => {
    const parsed = parseWorkflowEditor({
      nodes: [],
      edges: [],
      draft: {
        definitionId: "def-1",
        ownershipScope: { organizationId: "o-1", workspaceId: "w-1" },
        displayName: "Draft",
        nodes: [],
        edges: [],
        concurrency: { kind: "none" },
        defaultFailurePolicy: { kind: "propagate" },
        defaultTimeoutMs: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    })
    expect(parsed.draft?.definitionId).toBe("def-1")
  })

  test("(6) WorkflowEditorSchema_AcceptsAllNodeFamilies — sample editor with all 11 family values", () => {
    const nodes = EDITOR_NODE_TYPE_VALUES.map((family, i) => ({
      editorId: `n-${i}`,
      family,
      position: { x: i, y: i * 2 },
    }))
    const parsed = parseWorkflowEditor({ nodes, edges: [] })
    expect(parsed.nodes).toHaveLength(11)
  })

  test("(7) WorkflowEditorSchema_RejectsBadDraft — invalid WorkflowDefinition is refused", () => {
    expect(() =>
      parseWorkflowEditor({
        nodes: [],
        edges: [],
        draft: { definitionId: "def-bad" }, // missing required fields
      }),
    ).toThrow()
  })

  test("(8) parseWorkflowEditor_RoundTripsValid — JSON round-trip", () => {
    const original = {
      nodes: [
        {
          editorId: "en-1",
          family: "tool.http" as const,
          position: { x: 1, y: 2 },
        },
      ],
      edges: [{ editorId: "ee-1", from: "en-1", to: "en-2" }],
    }
    const parsed = parseWorkflowEditor(original)
    const round = JSON.parse(JSON.stringify(parsed))
    expect(round.nodes[0].family).toBe("tool.http")
    expect(round.edges[0].from).toBe("en-1")
  })
})
