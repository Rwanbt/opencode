// =============================================================================
// ui/components/team-graph.tsx — TEAM-M03
//
// The interactive task graph of a Team run, as a reusable component.
//
// Lives in packages/ui because the desktop app and mobile draw the same graph
// and must not each grow their own version of "which task is blocked by which"
// — that is one fact, and it gets one owner.
//
// The layout arrives already computed. Deciding a graph's shape and drawing it
// are separate jobs, and only the first one has a right answer that can be
// tested; the pure part of that decision lives below the component and is
// exercised by team-graph.test.ts.
// =============================================================================

import { For, Show, createMemo, type JSX } from "solid-js"

export interface TeamGraphTask {
  readonly taskId: string
  readonly status: string
  readonly dependsOn: readonly string[]
}

export interface TeamGraphWave {
  readonly index: number
  readonly taskIds: readonly string[]
}

/** Deterministic topological waves for every Team surface. */
export function wavesFor(tasks: readonly TeamGraphTask[]): readonly TeamGraphWave[] {
  const remaining = new Map(tasks.map((task) => [task.taskId, task] as const))
  const completed = new Set<string>()
  const waves: TeamGraphWave[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((task) => task.dependsOn.every((dependency) => completed.has(dependency)))
      .map((task) => task.taskId)
      .sort()
    if (ready.length === 0) {
      waves.push({ index: waves.length, taskIds: [...remaining.keys()].sort() })
      break
    }
    waves.push({ index: waves.length, taskIds: ready })
    for (const taskId of ready) {
      remaining.delete(taskId)
      completed.add(taskId)
    }
  }
  return waves
}

/**
 * Which tasks are related to the selected one, and how.
 *
 * The two sets are not disjoint, and deliberately so: inside a cycle a task
 * genuinely is both upstream and downstream of the selection, and forcing it
 * into one would misreport the graph. `emphasisFor` is what resolves that into
 * a single presentation, so every node still gets exactly one appearance.
 */
export interface Relations {
  readonly ancestors: ReadonlySet<string>
  readonly descendants: ReadonlySet<string>
}

export const NO_RELATIONS: Relations = { ancestors: new Set(), descendants: new Set() }

/**
 * Everything the selected task waits for, and everything waiting on it.
 *
 * Transitive on purpose. Showing only direct neighbours answers "what did I
 * declare?" when the question a reader actually has is "what has to finish
 * before this can start?" — and in a deep plan those are different sets.
 */
export function relationsFor(tasks: readonly TeamGraphTask[], selected: string | undefined): Relations {
  if (selected === undefined) return NO_RELATIONS

  const byId = new Map(tasks.map((task) => [task.taskId, task]))
  if (!byId.has(selected)) return NO_RELATIONS

  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      const list = dependents.get(dependency)
      if (list) list.push(task.taskId)
      else dependents.set(dependency, [task.taskId])
    }
  }

  const walk = (start: string, next: (id: string) => readonly string[]): Set<string> => {
    const found = new Set<string>()
    const queue = [...next(start)]
    while (queue.length > 0) {
      const id = queue.pop()!
      // The visited check is also the cycle guard: a graph with a cycle must
      // colour its nodes, not hang the panel that draws them.
      if (found.has(id) || id === start) continue
      found.add(id)
      queue.push(...next(id))
    }
    return found
  }

  return {
    ancestors: walk(selected, (id) => byId.get(id)?.dependsOn ?? []),
    descendants: walk(selected, (id) => dependents.get(id) ?? []),
  }
}

/** How a task should be presented relative to the current selection. */
export type TaskEmphasis = "selected" | "ancestor" | "descendant" | "unrelated" | "none"

export function emphasisFor(taskId: string, selected: string | undefined, relations: Relations): TaskEmphasis {
  if (selected === undefined) return "none"
  if (taskId === selected) return "selected"
  if (relations.ancestors.has(taskId)) return "ancestor"
  if (relations.descendants.has(taskId)) return "descendant"
  return "unrelated"
}

export interface TeamGraphProps {
  readonly waves: readonly TeamGraphWave[]
  readonly tasks: readonly TeamGraphTask[]
  readonly selected?: string
  readonly onSelect?: (taskId: string | undefined) => void
  /** Rendered inside each node. The caller owns the wording. */
  readonly children?: (task: TeamGraphTask, emphasis: TaskEmphasis) => JSX.Element
  /** Accessible name for the graph region; supplied translated by the caller. */
  readonly label: string
}

export function TeamGraph(props: TeamGraphProps) {
  const byId = createMemo(() => new Map(props.tasks.map((task) => [task.taskId, task])))
  const relations = createMemo(() => relationsFor(props.tasks, props.selected))

  return (
    <div data-component="team-graph" role="group" aria-label={props.label}>
      <For each={props.waves}>
        {(wave) => (
          <div data-part="wave" data-wave={wave.index}>
            <For each={wave.taskIds}>
              {(taskId) => {
                const task = () => byId().get(taskId)
                const emphasis = () => emphasisFor(taskId, props.selected, relations())
                return (
                  <Show when={task()}>
                    {(resolved) => (
                      <button
                        type="button"
                        data-part="task"
                        data-status={resolved().status}
                        data-emphasis={emphasis()}
                        aria-pressed={emphasis() === "selected"}
                        onClick={() =>
                          props.onSelect?.(props.selected === taskId ? undefined : taskId)
                        }
                      >
                        {props.children?.(resolved(), emphasis()) ?? taskId}
                      </button>
                    )}
                  </Show>
                )
              }}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}
