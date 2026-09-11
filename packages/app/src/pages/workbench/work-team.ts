/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-team.ts — A5-01
//
// Pure derivations for the Work surface's Team-backed panels: which run is the
// active one, how far its tasks have progressed, and what to do next. Kept
// free of Solid and the SDK, like context/team.tsx's own pure section, so
// each decision is tested for what it decides rather than for how it renders.
// =============================================================================

import { wavesFor, type TeamGraphTask } from "@unifia/ui/team-graph"

export interface WorkRun {
  readonly runId: string
  readonly status: string
  readonly updatedAt: string
}

export interface WorkTask {
  readonly taskId: string
  readonly status: string
}

/**
 * The run the Work surface should show by default.
 *
 * Prefers a run still in flight (running, then pending) over a finished one,
 * and among those with equal claim to attention, the most recently updated —
 * a page with several idle finished runs and one live run should always land
 * on the live one, not on whichever run happens to sort first.
 */
export function pickActiveRun(runs: readonly WorkRun[]): WorkRun | undefined {
  const inFlight = runs.filter((run) => run.status === "running" || run.status === "pending")
  const pool = inFlight.length > 0 ? inFlight : runs
  const rank = (run: WorkRun) => (run.status === "running" ? 0 : 1)
  return [...pool].sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt))[0]
}

export interface TaskProgress {
  readonly completed: number
  readonly total: number
  readonly percent: number
}

export function taskProgress(tasks: readonly WorkTask[]): TaskProgress {
  const total = tasks.length
  const completed = tasks.filter((task) => task.status === "completed").length
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) }
}

/**
 * The first task, in DAG order, that is not yet completed.
 *
 * `wavesFor` already resolves dependencies into an execution order; taking
 * the earliest incomplete task from it is the honest analog of "next safe
 * action" — whatever the plan itself says should happen next, not a
 * fabricated confidence score.
 */
export function nextActionableTask(tasks: readonly TeamGraphTask[]): TeamGraphTask | undefined {
  const byId = new Map(tasks.map((task) => [task.taskId, task]))
  for (const wave of wavesFor(tasks)) {
    for (const taskId of wave.taskIds) {
      const task = byId.get(taskId)
      if (task && task.status !== "completed") return task
    }
  }
  return undefined
}
