/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-board.ts — A5-04
//
// Pure grouping logic for the Board tab: real tasks sorted into the real
// 6-value task status enum. The mockup's Board has a "Review" column with no
// server-side counterpart (packages/unifia/src/server/routes/team.ts:87 has
// no such status) — reproducing it here would show a column that can never
// receive a real card, so it's dropped rather than faked.
// =============================================================================

import type { TeamGraphTask } from "@unifia/ui/team-graph"

export const KANBAN_COLUMNS = ["pending", "assigned", "running", "blocked", "completed", "cancelled"] as const

export type KanbanColumn = (typeof KANBAN_COLUMNS)[number]

export type KanbanGrouping = Record<KanbanColumn, TeamGraphTask[]>

export function groupByColumn(tasks: readonly TeamGraphTask[]): KanbanGrouping {
  const grouping: KanbanGrouping = {
    pending: [],
    assigned: [],
    running: [],
    blocked: [],
    completed: [],
    cancelled: [],
  }
  for (const task of tasks) {
    const column = task.status as KanbanColumn
    if (column in grouping) grouping[column].push(task)
  }
  return grouping
}
