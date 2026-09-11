/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { nextActionableTask, pickActiveRun, taskProgress, type WorkRun } from "./work-team"

// Unit coverage for A5-01's Work-surface decisions: which run is "the" active
// one, and how complete its tasks are. Pure and Solid-free, like team.test.ts.

const run = (runId: string, status: string, updatedAt: string): WorkRun => ({ runId, status, updatedAt })

describe("pickActiveRun — a live run always wins over a finished one", () => {
  test("prefers running over pending over completed", () => {
    const runs = [run("r1", "completed", "2026-01-01"), run("r2", "running", "2026-01-02"), run("r3", "pending", "2026-01-03")]
    expect(pickActiveRun(runs)?.runId).toBe("r2")
  })

  test("among equally-in-flight runs, the most recently updated wins", () => {
    const runs = [run("r1", "running", "2026-01-01"), run("r2", "running", "2026-01-05")]
    expect(pickActiveRun(runs)?.runId).toBe("r2")
  })

  test("falls back to the most recently updated run when nothing is in flight", () => {
    const runs = [run("r1", "completed", "2026-01-01"), run("r2", "failed", "2026-01-03")]
    expect(pickActiveRun(runs)?.runId).toBe("r2")
  })

  test("no runs means no active run", () => {
    expect(pickActiveRun([])).toBeUndefined()
  })
})

describe("taskProgress — an honest completed/total percentage", () => {
  test("counts completed tasks against the total", () => {
    const tasks = [{ taskId: "t1", status: "completed" }, { taskId: "t2", status: "running" }, { taskId: "t3", status: "completed" }]
    expect(taskProgress(tasks)).toEqual({ completed: 2, total: 3, percent: 67 })
  })

  test("an empty task list is 0%, not NaN or a division by zero", () => {
    expect(taskProgress([])).toEqual({ completed: 0, total: 0, percent: 0 })
  })

  test("all tasks completed is 100%", () => {
    const tasks = [{ taskId: "t1", status: "completed" }, { taskId: "t2", status: "completed" }]
    expect(taskProgress(tasks)).toEqual({ completed: 2, total: 2, percent: 100 })
  })
})

describe("nextActionableTask — the earliest incomplete task in DAG order", () => {
  const task = (taskId: string, status: string, dependsOn: string[] = []): TeamGraphTask => ({
    taskId,
    status,
    dependsOn,
  })

  test("a task with no dependencies and not yet completed is next", () => {
    const tasks = [task("t1", "completed"), task("t2", "running")]
    expect(nextActionableTask(tasks)?.taskId).toBe("t2")
  })

  test("a task blocked on an incomplete dependency is not next — its dependency is", () => {
    const tasks = [task("t1", "running"), task("t2", "pending", ["t1"])]
    expect(nextActionableTask(tasks)?.taskId).toBe("t1")
  })

  test("once every wave is completed, there is no next task", () => {
    const tasks = [task("t1", "completed"), task("t2", "completed", ["t1"])]
    expect(nextActionableTask(tasks)).toBeUndefined()
  })

  test("no tasks means no next task", () => {
    expect(nextActionableTask([])).toBeUndefined()
  })
})
