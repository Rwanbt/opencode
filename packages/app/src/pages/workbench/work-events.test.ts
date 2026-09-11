/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { describeEvent } from "./work-events"

describe("describeEvent — real event kinds map to real payload fields", () => {
  test("team.started counts the real taskIds array", () => {
    expect(describeEvent("team.started", { objective: "x", taskIds: ["t1", "t2", "t3"] })).toEqual({
      key: "workbench.work.event.started",
      params: { count: 3 },
    })
  })

  test("team.budget_handoff surfaces the real taskId", () => {
    expect(describeEvent("team.budget_handoff", { taskId: "t1", excludedModelIds: ["m1"] })).toEqual({
      key: "workbench.work.event.budgetHandoff",
      params: { taskId: "t1" },
    })
  })

  test("team.task_finished surfaces taskId and status", () => {
    expect(describeEvent("team.task_finished", { taskId: "t1", status: "COMPLETED", reviewVerdict: null })).toEqual({
      key: "workbench.work.event.taskFinished",
      params: { taskId: "t1", status: "COMPLETED" },
    })
  })

  test("team.final_validation surfaces the real verdict", () => {
    expect(describeEvent("team.final_validation", { verdict: "COMPLETE" })).toEqual({
      key: "workbench.work.event.finalValidation",
      params: { verdict: "COMPLETE" },
    })
  })

  test("team.runtime_failed surfaces the real error message", () => {
    expect(describeEvent("team.runtime_failed", { error: "boom" })).toEqual({
      key: "workbench.work.event.runtimeFailed",
      params: { error: "boom" },
    })
  })

  test("an unrecognized kind falls back to showing the raw kind, not a guess", () => {
    expect(describeEvent("something.else", { anything: true })).toEqual({
      key: "workbench.work.event.unknown",
      params: { kind: "something.else" },
    })
  })

  test("a malformed payload (not an object) never throws", () => {
    expect(describeEvent("team.started", null)).toEqual({ key: "workbench.work.event.started", params: { count: 0 } })
    expect(describeEvent("team.started", "garbage")).toEqual({
      key: "workbench.work.event.started",
      params: { count: 0 },
    })
  })
})
