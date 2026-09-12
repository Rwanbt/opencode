/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { TeamRunGraph } from "../../../src/cli/cmd/tui/component/team-run-graph"
import { layoutTaskGraph, totalCostUsd, type TaskNode } from "../../../src/cli/cmd/tui/util/team-dag"

// Render coverage for the TEAM-M02 run graph.
//
// These assert against the real terminal frame rather than against a claim
// about it. The states that matter are the ones a reader would misread if the
// component quietly dropped them: a task that will never run, a cost nobody
// measured, a cycle told apart from a missing dependency.

const COLORS = {
  text: RGBA.fromInts(255, 255, 255, 255),
  muted: RGBA.fromInts(128, 128, 128, 255),
  error: RGBA.fromInts(255, 0, 0, 255),
  warning: RGBA.fromInts(255, 200, 0, 255),
}

const task = (taskId: string, dependsOn: string[] = [], costUsd?: number): TaskNode => ({
  taskId,
  dependsOn,
  ...(costUsd === undefined ? {} : { costUsd }),
})

async function frameFor(tasks: TaskNode[]) {
  const layout = layoutTaskGraph(tasks)
  const { renderOnce, captureCharFrame } = await testRender(
    () => <TeamRunGraph layout={layout} taskCount={tasks.length} costUsd={totalCostUsd(tasks)} colors={COLORS} />,
    { width: 120, height: 40 },
  )
  await renderOnce()
  return captureCharFrame()
}

describe("TeamRunGraph — the waves it draws are the ones that will run", () => {
  test("shows the task count and the number of waves", async () => {
    const frame = await frameFor([task("a"), task("b", ["a"]), task("c", ["b"])])

    expect(frame).toContain("3 tasks in 3 waves")
  })

  test("lists each wave's tasks", async () => {
    const frame = await frameFor([task("alpha"), task("beta", ["alpha"])])

    expect(frame).toContain("wave 1")
    expect(frame).toContain("alpha")
    expect(frame).toContain("wave 2")
    expect(frame).toContain("beta")
  })

  test("a fan-out is drawn as one wide wave, not one wave per task", async () => {
    const frame = await frameFor([task("root"), task("x", ["root"]), task("y", ["root"])])

    expect(frame).toContain("3 tasks in 2 waves")
    expect(frame).not.toContain("wave 3")
  })
})

describe("TeamRunGraph — what will never run is on screen", () => {
  test("a cycle is drawn and named a cycle", async () => {
    // Silently omitting these tasks would read as "already done".
    const frame = await frameFor([task("a", ["b"]), task("b", ["a"])])

    expect(frame).toContain("cycle")
    expect(frame).toContain("never runs")
    expect(frame).toContain("a")
    expect(frame).toContain("b")
  })

  test("a missing dependency is drawn as blocked, not as a cycle", async () => {
    // Different causes, different fixes: one is a broken plan, the other a
    // partial fetch.
    const frame = await frameFor([task("a", ["ghost"])])

    expect(frame).toContain("blocked")
    expect(frame).toContain("missing dependencies: ghost")
    expect(frame).not.toContain("cycle")
  })

  test("a healthy run says nothing about cycles or missing dependencies", async () => {
    const frame = await frameFor([task("a"), task("b", ["a"])])

    expect(frame).not.toContain("never runs")
    expect(frame).not.toContain("missing dependencies")
  })
})

describe("TeamRunGraph — an unmeasured cost is not a free run", () => {
  test("no measured cost reads as not recorded", async () => {
    const frame = await frameFor([task("a"), task("b")])

    expect(frame).toContain("cost: not recorded")
    expect(frame).not.toContain("$0.00")
  })

  test("a measured cost is shown as money", async () => {
    const frame = await frameFor([task("a", [], 1.5), task("b", [], 0.25)])

    expect(frame).toContain("cost: $1.75")
  })

  test("a genuine zero is shown as zero, not as unrecorded", async () => {
    const frame = await frameFor([task("a", [], 0)])

    expect(frame).toContain("cost: $0.00")
    expect(frame).not.toContain("not recorded")
  })
})
