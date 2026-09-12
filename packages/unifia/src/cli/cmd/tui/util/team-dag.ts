// =============================================================================
// tui/util/team-dag.ts — TEAM-M02
//
// The scheduling shape of a Team run's task graph, computed for display.
//
// Kept free of the renderer so the thing that has to be correct — which tasks
// can run when, and which can never run at all — is tested for what it decides
// rather than for what it draws. It is also what makes 200 tasks cheap: this is
// Kahn's algorithm at O(V+E), and the dialog calls it once per data change
// rather than once per frame.
// =============================================================================

export interface TaskNode {
  readonly taskId: string
  readonly dependsOn: readonly string[]
  readonly status?: string
  /** Present only when a producer measured it. Absent is not zero. */
  readonly costUsd?: number
}

export interface Wave {
  readonly index: number
  readonly taskIds: readonly string[]
}

export interface GraphLayout {
  /** Tasks grouped by the earliest step at which they could run. */
  readonly waves: readonly Wave[]
  /**
   * Tasks that can never be scheduled, with the reason.
   *
   * Reported rather than dropped. A task silently missing from every wave
   * reads as "already done" on screen, which is the opposite of the truth: it
   * is the one thing in the run that will never happen.
   */
  readonly unschedulable: readonly string[]
  /** Dependencies naming a task the run does not contain. */
  readonly missingDependencies: readonly string[]
  /** Whether a cycle is what made anything unschedulable. */
  readonly hasCycle: boolean
}

/**
 * Group tasks into the waves in which they could run.
 *
 * A task's wave is one past the highest wave of its dependencies, so wave count
 * is the critical path — the shortest number of sequential steps the run can
 * take no matter how much parallelism is available.
 */
export function layoutTaskGraph(tasks: readonly TaskNode[]): GraphLayout {
  const known = new Set(tasks.map((task) => task.taskId))

  const missingDependencies: string[] = []
  const seenMissing = new Set<string>()
  const dependents = new Map<string, string[]>()
  const remaining = new Map<string, number>()
  const awaitsMissing = new Set<string>()

  for (const task of tasks) {
    let blockers = 0
    for (const dependency of task.dependsOn) {
      if (!known.has(dependency)) {
        if (!seenMissing.has(dependency)) {
          seenMissing.add(dependency)
          missingDependencies.push(dependency)
        }
        // A dependency that is not in the run can never complete, so the task
        // is permanently blocked. Counting it keeps the task out of every wave
        // and lands it in `unschedulable`, which is the honest answer.
        awaitsMissing.add(task.taskId)
        blockers++
        continue
      }
      blockers++
      const list = dependents.get(dependency)
      if (list) list.push(task.taskId)
      else dependents.set(dependency, [task.taskId])
    }
    remaining.set(task.taskId, blockers)
  }

  const waves: Wave[] = []
  let frontier = tasks.filter((task) => remaining.get(task.taskId) === 0).map((task) => task.taskId)
  let placed = 0

  while (frontier.length > 0) {
    waves.push({ index: waves.length, taskIds: frontier })
    placed += frontier.length
    const next: string[] = []
    for (const taskId of frontier) {
      for (const dependent of dependents.get(taskId) ?? []) {
        const left = (remaining.get(dependent) ?? 0) - 1
        remaining.set(dependent, left)
        if (left === 0) next.push(dependent)
      }
    }
    frontier = next
  }

  const unschedulable = placed === tasks.length ? [] : tasks.filter((t) => (remaining.get(t.taskId) ?? 0) > 0).map((t) => t.taskId)

  // A missing dependency also leaves tasks unplaced, so the two causes are told
  // apart rather than both being reported as a cycle. Membership is looked up
  // in a set built during the single pass above, which is what keeps the whole
  // function O(V+E) rather than quadratic in the unschedulable count.
  const blockedOnlyByMissing = unschedulable.every((taskId) => awaitsMissing.has(taskId))

  return {
    waves,
    unschedulable,
    missingDependencies,
    hasCycle: unschedulable.length > 0 && !blockedOnlyByMissing,
  }
}

export interface TaskSummary {
  readonly total: number
  readonly byStatus: Readonly<Record<string, number>>
}

export function summarizeTasks(tasks: readonly TaskNode[]): TaskSummary {
  const byStatus: Record<string, number> = {}
  for (const task of tasks) {
    const status = task.status ?? "unknown"
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  return { total: tasks.length, byStatus }
}

/**
 * Total measured cost, or `undefined` when nothing measured any.
 *
 * Deliberately not `0` in that case. A run whose cost was never recorded and a
 * run that genuinely cost nothing render identically as "$0.00", and only one
 * of them is true.
 */
export function totalCostUsd(tasks: readonly TaskNode[]): number | undefined {
  let total = 0
  let measured = false
  for (const task of tasks) {
    if (task.costUsd === undefined) continue
    measured = true
    total += task.costUsd
  }
  return measured ? total : undefined
}

/** Sequential steps the run needs at best, however much parallelism it gets. */
export function criticalPathLength(layout: GraphLayout): number {
  return layout.waves.length
}
