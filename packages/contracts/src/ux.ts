/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * UX contracts (Plan V2.3.1 §230, ADR-002 cross-ref).
 *
 * Defines the contract between the workflow editor UI and the
 * underlying WorkflowDefinition. The actual rendering is in the
 * workbench package.
 *
 * UX-01 — Workflow editor (nodes / edges / optional draft).
 *
 * The `family` enum intentionally lists node families that are NOT
 * yet in the current IR (e.g. `control.while`, `control.child`):
 * the editor is a forward-looking authoring surface, while the
 * runtime IR grows additively (ADR-002). The `irNodeId` field is
 * only populated once the node is committed to the IR.
 */
import { z } from "zod"
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "./workflow-ir.js"

/* ------------------------------------------------------------------ */
/* UX-01 — Workflow editor                                            */
/* ------------------------------------------------------------------ */

export const EDITOR_NODE_TYPE_VALUES = [
  "control.if",
  "control.switch",
  "control.parallel",
  "control.merge",
  "control.map",
  "control.repeat",
  "control.while",
  "control.child",
  "tool.http",
  "human.approval",
  "wait",
] as const

export const EditorNodeSchema = z.object({
  /** Stable id within the editor session (NOT the IR node id). */
  editorId: z.string().min(1).max(128),
  family: z.enum(EDITOR_NODE_TYPE_VALUES),
  /** Position on the editor canvas. */
  position: z.object({ x: z.number(), y: z.number() }),
  /** The IR node id once the editor session commits. Optional. */
  irNodeId: z.string().min(1).max(128).optional(),
})
export type EditorNode = z.infer<typeof EditorNodeSchema>

export const EditorEdgeSchema = z.object({
  editorId: z.string().min(1).max(128),
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
})
export type EditorEdge = z.infer<typeof EditorEdgeSchema>

export const WorkflowEditorSchema = z.object({
  nodes: z.array(EditorNodeSchema).readonly(),
  edges: z.array(EditorEdgeSchema).readonly(),
  /** The current draft IR (not yet committed). */
  draft: WorkflowDefinitionSchema.optional(),
})
export type WorkflowEditor = z.infer<typeof WorkflowEditorSchema>

export function parseWorkflowEditor(input: unknown): WorkflowEditor {
  return WorkflowEditorSchema.parse(input)
}

/**
 * Re-export so callers that import UX-01 types can also use the
 * canonical `WorkflowDefinition` type without a second import.
 */
export type { WorkflowDefinition }
