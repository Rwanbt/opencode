/* SPDX-License-Identifier: MIT */

import type { ParsedWorkflowDefinition } from "./automate-decode"

export type WorkflowStepSummary = {
  readonly id: string
  readonly label: string
  readonly requiresApproval: boolean
}

/**
 * Creates an inspector-safe representation of legacy workflow steps.
 * The server remains the authority for validation and execution; this view
 * deliberately preserves unknown step fields instead of inventing an IR.
 */
export function summarizeWorkflowSteps(definition: ParsedWorkflowDefinition): readonly WorkflowStepSummary[] {
  return definition.steps.map((step, index) => {
    const record = isRecord(step) ? step : {}
    const id = typeof record.id === "string" && record.id ? record.id : `step-${index + 1}`
    const family = typeof record.family === "string" && record.family ? record.family : undefined
    const capability = typeof record.capability === "string" && record.capability ? record.capability : undefined
    return {
      id,
      label: family ?? capability ?? "untyped step",
      requiresApproval: record.requiresApproval === true,
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
