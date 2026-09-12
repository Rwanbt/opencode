import { describe, expect, test } from "bun:test"
import {
  criticalPathLength,
  layoutTaskGraph,
  summarizeTasks,
  totalCostUsd,
  type TaskNode,
} from "../../../src/cli/cmd/tui/util/team-dag"

// Unit coverage for the TEAM-M02 graph layout.
//
// This is the part of the TUI that has to be right: what the dialog draws is
// only as true as the scheduling it is drawing. The 200-task acceptance
// criterion is asserted here rather than through the renderer, because a slow
// frame is a symptom and the algorithm is the cause.

const task = (taskId: string, dependsOn: string[] = [], extra: Partial<TaskNode> = {}): TaskNode => ({
  taskId,
  dependsOn,
  ...extra,
})

describe("layoutTaskGraph — waves are the critical path", () => {
  test("independent tasks all run in the first wave", () => {
    const layout = layoutTaskGraph([task("a"), task("b"), task("c")])

    expect(layout.waves).toHaveLength(1)
    expect(layout.waves[0].taskIds).toEqual(["a", "b", "c"])
    expect(criticalPathLength(layout)).toBe(1)
  })

  test("a chain cannot collapse into fewer waves than its length", () => {
    const layout = layoutTaskGraph([task("a"), task("b", ["a"]), task("c", ["b"])])

    expect(layout.waves.map((wave) => wave.taskIds)).toEqual([["a"], ["b"], ["c"]])
    expect(criticalPathLength(layout)).toBe(3)
  })

  test("a task waits for its slowest dependency, not its first", () => {
    // d depends on a (wave 0) and on c (wave 2), so it belongs in wave 3.
    // Placing it at wave 1 would say the run is shorter than it can be.
    const layout = layoutTaskGraph([task("a"), task("b", ["a"]), task("c", ["b"]), task("d", ["a", "c"])])

    expect(layout.waves).toHaveLength(4)
    expect(layout.waves[3].taskIds).toEqual(["d"])
  })

  test("a fan-out is one wave wide, not one task per wave", () => {
    const tasks = [task("root"), ...Array.from({ length: 20 }, (_, i) => task(`leaf-${i}`, ["root"]))]
    const layout = layoutTaskGraph(tasks)

    expect(layout.waves).toHaveLength(2)
    expect(layout.waves[1].taskIds).toHaveLength(20)
  })

  test("an empty run has no waves and nothing wrong with it", () => {
    const layout = layoutTaskGraph([])

    expect(layout.waves).toEqual([])
    expect(layout.unschedulable).toEqual([])
    expect(layout.hasCycle).toBe(false)
  })
})

describe("layoutTaskGraph — what can never run is reported, not dropped", () => {
  test("a cycle is named rather than hung on", () => {
    // Dropping cycle members would render them as absent, which reads as
    // "already done" — the opposite of "will never happen".
    const layout = layoutTaskGraph([task("a", ["b"]), task("b", ["a"])])

    expect(layout.waves).toEqual([])
    expect(layout.unschedulable.toSorted()).toEqual(["a", "b"])
    expect(layout.hasCycle).toBe(true)
  })

  test("tasks outside a cycle still get their waves", () => {
    const layout = layoutTaskGraph([task("ok"), task("a", ["b"]), task("b", ["a"])])

    expect(layout.waves[0].taskIds).toEqual(["ok"])
    expect(layout.unschedulable.toSorted()).toEqual(["a", "b"])
  })

  test("a dependency the run does not contain is reported as missing, not as a cycle", () => {
    // The two have different fixes: one is a broken plan, the other is a
    // partial fetch. Reporting both as "cycle" sends the reader after the
    // wrong thing.
    const layout = layoutTaskGraph([task("a", ["ghost"])])

    expect(layout.missingDependencies).toEqual(["ghost"])
    expect(layout.unschedulable).toEqual(["a"])
    expect(layout.hasCycle).toBe(false)
  })

  test("a missing dependency is listed once however many tasks want it", () => {
    const layout = layoutTaskGraph([task("a", ["ghost"]), task("b", ["ghost"])])

    expect(layout.missingDependencies).toEqual(["ghost"])
  })

  test("a cycle alongside a missing dependency still reports the cycle", () => {
    const layout = layoutTaskGraph([task("a", ["ghost"]), task("x", ["y"]), task("y", ["x"])])

    expect(layout.missingDependencies).toEqual(["ghost"])
    expect(layout.hasCycle).toBe(true)
  })
})

describe("layoutTaskGraph — 200 tasks stay cheap", () => {
  // The acceptance criterion is responsiveness at 200 tasks. Kahn's algorithm
  // is O(V+E); the ceilings below are far above what that costs and far below
  // what a quadratic implementation would, so they fail on a regression in the
  // algorithm without failing on a slow machine.

  test("a 200-long chain lays out correctly and quickly", () => {
    const tasks = Array.from({ length: 200 }, (_, i) => task(`t-${i}`, i === 0 ? [] : [`t-${i - 1}`]))

    const started = performance.now()
    const layout = layoutTaskGraph(tasks)
    const elapsed = performance.now() - started

    expect(layout.waves).toHaveLength(200)
    expect(layout.unschedulable).toEqual([])
    expect(elapsed).toBeLessThan(100)
  })

  test("200 tasks all depending on one root is two waves, not 200", () => {
    const tasks = [task("root"), ...Array.from({ length: 199 }, (_, i) => task(`t-${i}`, ["root"]))]

    const layout = layoutTaskGraph(tasks)

    expect(layout.waves).toHaveLength(2)
    expect(layout.waves[1].taskIds).toHaveLength(199)
  })

  test("a dense graph — 200 tasks, ~10 000 edges — still lays out quickly", () => {
    // Every task depends on the 50 before it: this is where an implementation
    // that rescans the task list per edge falls over.
    const tasks = Array.from({ length: 200 }, (_, i) =>
      task(
        `t-${i}`,
        Array.from({ length: Math.min(i, 50) }, (_, k) => `t-${i - 1 - k}`),
      ),
    )

    const started = performance.now()
    const layout = layoutTaskGraph(tasks)
    const elapsed = performance.now() - started

    expect(layout.waves).toHaveLength(200)
    expect(elapsed).toBeLessThan(250)
  })

  test("200 unschedulable tasks do not cost more than 200 schedulable ones", () => {
    // Regression guard: the "is this a cycle or a missing dependency?" check
    // used to scan the task list per unschedulable task.
    const tasks = Array.from({ length: 200 }, (_, i) => task(`t-${i}`, ["ghost"]))

    const started = performance.now()
    const layout = layoutTaskGraph(tasks)
    const elapsed = performance.now() - started

    expect(layout.unschedulable).toHaveLength(200)
    expect(layout.hasCycle).toBe(false)
    expect(elapsed).toBeLessThan(100)
  })
})

describe("summarizeTasks", () => {
  test("counts by status and totals", () => {
    const summary = summarizeTasks([
      task("a", [], { status: "completed" }),
      task("b", [], { status: "completed" }),
      task("c", [], { status: "running" }),
    ])

    expect(summary.total).toBe(3)
    expect(summary.byStatus).toEqual({ completed: 2, running: 1 })
  })

  test("a task with no status is counted as unknown, not skipped", () => {
    // Skipping it would make the counts add up to less than the total, and the
    // reader would not know which number to trust.
    const summary = summarizeTasks([task("a"), task("b", [], { status: "running" })])

    expect(summary.total).toBe(2)
    expect(summary.byStatus).toEqual({ unknown: 1, running: 1 })
  })
})

describe("totalCostUsd — unmeasured is not free", () => {
  test("sums what was measured", () => {
    expect(totalCostUsd([task("a", [], { costUsd: 0.5 }), task("b", [], { costUsd: 0.25 })])).toBe(0.75)
  })

  test("nothing measured returns undefined, never 0", () => {
    // "$0.00" for a run whose cost was never recorded is a number the reader
    // will believe.
    expect(totalCostUsd([task("a"), task("b")])).toBeUndefined()
  })

  test("a genuine zero is still a zero", () => {
    expect(totalCostUsd([task("a", [], { costUsd: 0 })])).toBe(0)
  })

  test("partial measurement sums what exists rather than giving up", () => {
    expect(totalCostUsd([task("a", [], { costUsd: 1 }), task("b")])).toBe(1)
  })
})
