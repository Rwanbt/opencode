/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-events.ts — A5-05
//
// Turns one real Team event (context/team.tsx's EventRow — kind is a bare
// string, payload is unknown, both redacted server-side) into an i18n key +
// params. The five kinds handled here are the only ones the DAG execution
// loop ever appends (packages/unifia/src/team/application-service.ts:155,
// 159,180,202,234) — anything else falls back to showing the raw kind
// rather than guessing at a payload shape that isn't one of these five.
// =============================================================================

export interface DescribedEvent {
  readonly key: string
  readonly params: Record<string, string | number>
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

export function describeEvent(kind: string, payload: unknown): DescribedEvent {
  const data = asRecord(payload)
  switch (kind) {
    case "team.started": {
      const taskIds = Array.isArray(data.taskIds) ? data.taskIds : []
      return { key: "workbench.work.event.started", params: { count: taskIds.length } }
    }
    case "team.budget_handoff":
      return { key: "workbench.work.event.budgetHandoff", params: { taskId: asString(data.taskId) } }
    case "team.task_finished":
      return {
        key: "workbench.work.event.taskFinished",
        params: { taskId: asString(data.taskId), status: asString(data.status) },
      }
    case "team.final_validation":
      return { key: "workbench.work.event.finalValidation", params: { verdict: asString(data.verdict, "?") } }
    case "team.runtime_failed":
      return { key: "workbench.work.event.runtimeFailed", params: { error: asString(data.error) } }
    default:
      return { key: "workbench.work.event.unknown", params: { kind } }
  }
}

/** The real kinds the DAG execution loop emits, for a filterable list. */
export const EVENT_KINDS = [
  "team.started",
  "team.budget_handoff",
  "team.task_finished",
  "team.final_validation",
  "team.runtime_failed",
] as const

export type EventKind = (typeof EVENT_KINDS)[number]
