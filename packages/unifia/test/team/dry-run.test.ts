import { describe, expect, it } from "bun:test"
import {
  DEFAULT_DRY_RUN_ASSUMPTIONS,
  DryRunInputError,
  type DryRunEnvironmentSnapshot,
  type DryRunModelCandidate,
  simulateDryRun,
} from "../../src/team/dry-run"
import type { TaskPlan } from "../../src/team/task-planner"

function plan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    schemaVersion: "1.0.0",
    integrationStrategy: "cherry-pick into Team sequentially",
    rollback: "revert the cherry-pick and revoke the lease",
    globalRisks: [],
    globalGates: ["T4"],
    tasks: [
      {
        id: "a",
        title: "Task A",
        objective: "Do A",
        dependsOn: [],
        readSet: [],
        writeSet: ["src/a.ts"],
        exclusiveResources: [],
        acceptanceCriteria: ["A works"],
        risks: [],
        gates: [],
      },
      {
        id: "b",
        title: "Task B",
        objective: "Do B, depends on A",
        dependsOn: ["a"],
        readSet: ["src/a.ts"],
        writeSet: ["src/b.ts"],
        exclusiveResources: [],
        acceptanceCriteria: ["B works"],
        risks: [],
        gates: [],
      },
      {
        id: "c",
        title: "Task C",
        objective: "Do C, independent of A/B",
        dependsOn: [],
        readSet: [],
        writeSet: ["src/c.ts"],
        exclusiveResources: [],
        acceptanceCriteria: ["C works"],
        risks: [],
        gates: [],
      },
    ],
    ...overrides,
  }
}

function candidate(overrides: Partial<DryRunModelCandidate> = {}): DryRunModelCandidate {
  return {
    modelId: "claude-sonnet",
    family: "claude",
    lifecycleStage: "general_eligible",
    costPerMillionInputTokens: 3,
    costPerMillionOutputTokens: 15,
    averageLatencyMs: 1200,
    ...overrides,
  }
}

function environment(overrides: Partial<DryRunEnvironmentSnapshot> = {}): DryRunEnvironmentSnapshot {
  return {
    snapshotId: "snap-1",
    diskFreeBytes: 50_000_000_000,
    diskRequiredBytesPerTask: 500_000_000,
    existingWorktreeCount: 2,
    maxConcurrentWorktrees: 8,
    ...overrides,
  }
}

describe("simulateDryRun — no worker calls, pure simulation", () => {
  it("produces an unblocked report for a valid plan with an eligible model", () => {
    const report = simulateDryRun({ plan: plan(), modelCandidates: [candidate()], environment: environment() })

    expect(report.blocked).toBe(false)
    expect(report.blockingReasons).toEqual([])
    expect(report.graphValidation.valid).toBe(true)
    expect(report.estimate.confidence).toBe("high")
  })

  it("groups independent tasks into the same wave and respects dependency order", () => {
    const report = simulateDryRun({ plan: plan(), modelCandidates: [candidate()], environment: environment() })

    expect(report.waves).toHaveLength(2)
    expect([...report.waves[0]!.taskIds].sort()).toEqual(["a", "c"])
    expect(report.waves[1]!.taskIds).toEqual(["b"])
  })

  it("is reproducible for an identical snapshot", () => {
    const input = { plan: plan(), modelCandidates: [candidate()], environment: environment() }
    const first = simulateDryRun(input)
    const second = simulateDryRun(input)

    expect(second.reproducibilityKey).toBe(first.reproducibilityKey)
  })

  it("changes the reproducibility key when the environment snapshot id changes", () => {
    const first = simulateDryRun({ plan: plan(), modelCandidates: [candidate()], environment: environment() })
    const second = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate()],
      environment: environment({ snapshotId: "snap-2" }),
    })

    expect(second.reproducibilityKey).not.toBe(first.reproducibilityKey)
  })

  it("keeps the same reproducibility key when task array order differs but content is identical", () => {
    const original = plan()
    const reordered = plan({ tasks: [...original.tasks].reverse() })
    const a = simulateDryRun({ plan: original, modelCandidates: [candidate()], environment: environment() })
    const b = simulateDryRun({ plan: reordered, modelCandidates: [candidate()], environment: environment() })

    expect(b.reproducibilityKey).toBe(a.reproducibilityKey)
  })
})

describe("simulateDryRun — model shortlist (C08 lifecycle reuse)", () => {
  it("marks a terminal-stage candidate ineligible with a reason", () => {
    const report = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate({ modelId: "old-model", lifecycleStage: "deprecated" })],
      environment: environment(),
    })

    expect(report.modelShortlist).toHaveLength(1)
    expect(report.modelShortlist[0]!.eligible).toBe(false)
    expect(report.modelShortlist[0]!.reason).toMatch(/terminal/)
    expect(report.blocked).toBe(true)
    expect(report.blockingReasons).toContain("no eligible model candidate in the shortlist")
  })

  it("keeps a quarantined candidate out of the shortlist but still lists it", () => {
    const report = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate({ modelId: "flagged", lifecycleStage: "quarantined" }), candidate()],
      environment: environment(),
    })

    expect(report.modelShortlist).toHaveLength(2)
    expect(report.modelShortlist.find((entry) => entry.modelId === "flagged")!.eligible).toBe(false)
    expect(report.blocked).toBe(false)
  })

  it("rejects a duplicate modelId in the candidate list", () => {
    expect(() =>
      simulateDryRun({
        plan: plan(),
        modelCandidates: [candidate(), candidate()],
        environment: environment(),
      }),
    ).toThrow(DryRunInputError)
  })
})

describe("simulateDryRun — graph validation propagation (E03 reuse)", () => {
  it("blocks and reports low confidence when the plan itself is invalid", () => {
    const invalidPlan = plan({
      tasks: [
        {
          id: "x",
          title: "Self dependency",
          objective: "Broken",
          dependsOn: ["x"],
          readSet: [],
          writeSet: [],
          exclusiveResources: [],
          acceptanceCriteria: ["n/a"],
          risks: [],
          gates: [],
        },
      ],
    })

    const report = simulateDryRun({ plan: invalidPlan, modelCandidates: [candidate()], environment: environment() })

    expect(report.graphValidation.valid).toBe(false)
    expect(report.blocked).toBe(true)
    expect(report.blockingReasons).toContain("plan fails graph validation (see graphValidation.issues)")
    expect(report.estimate.confidence).toBe("low")
  })

  it("feeds its own token estimate into graph-validator's BUDGET rule when the caller sets maxTotalTokens", () => {
    const report = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate()],
      environment: environment(),
      validationOptions: { maxTotalTokens: 1 },
    })

    expect(report.graphValidation.valid).toBe(false)
    expect(report.graphValidation.issues.some((issue) => issue.rule === "BUDGET")).toBe(true)
  })

  it("lets the caller override the estimated token total fed into BUDGET", () => {
    const withinBudget = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate()],
      environment: environment(),
      validationOptions: { estimatedTokens: 1, maxTotalTokens: 1_000_000 },
    })

    expect(withinBudget.graphValidation.issues.some((issue) => issue.rule === "BUDGET")).toBe(false)
  })
})

describe("simulateDryRun — disk/worktree preflight", () => {
  it("flags insufficient disk space", () => {
    const report = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate()],
      environment: environment({ diskFreeBytes: 10, diskRequiredBytesPerTask: 1_000_000 }),
    })

    expect(report.diskWorktreePreflight.ok).toBe(false)
    expect(report.blocked).toBe(true)
    expect(report.estimate.confidence).toBe("medium")
  })

  it("caps peak concurrent tasks at maxConcurrentWorktrees and reports ok when within budget", () => {
    const report = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate()],
      environment: environment({ maxConcurrentWorktrees: 1, existingWorktreeCount: 0 }),
    })

    expect(report.diskWorktreePreflight.peakConcurrentTasks).toBe(1)
    expect(report.diskWorktreePreflight.ok).toBe(true)
  })
})

describe("simulateDryRun — cost/time estimate", () => {
  it("scales the cost range with task count and uses the eligible cost bounds", () => {
    const cheap = candidate({ modelId: "cheap", costPerMillionInputTokens: 1, costPerMillionOutputTokens: 1 })
    const pricey = candidate({ modelId: "pricey", costPerMillionInputTokens: 100, costPerMillionOutputTokens: 100 })
    const report = simulateDryRun({ plan: plan(), modelCandidates: [cheap, pricey], environment: environment() })

    expect(report.estimate.costUsd.min).toBeGreaterThan(0)
    expect(report.estimate.costUsd.max).toBeGreaterThan(report.estimate.costUsd.min)
  })

  it("returns a zero cost range with low confidence when no candidate is eligible", () => {
    const report = simulateDryRun({
      plan: plan(),
      modelCandidates: [candidate({ lifecycleStage: "deprecated" })],
      environment: environment(),
    })

    expect(report.estimate.costUsd).toEqual({ min: 0, max: 0 })
    expect(report.estimate.confidence).toBe("low")
  })

  it("always includes the protected-branch rule in the rollback plan", () => {
    const report = simulateDryRun({ plan: plan(), modelCandidates: [candidate()], environment: environment() })

    expect(report.rollbackPlan.at(-1)).toBe("Never touch dev or main directly during rollback.")
  })
})

describe("simulateDryRun — boundary validation", () => {
  it("throws DryRunInputError on a malformed environment snapshot", () => {
    expect(() =>
      simulateDryRun({
        plan: plan(),
        modelCandidates: [candidate()],
        // @ts-expect-error deliberately malformed for the boundary test
        environment: { snapshotId: "", diskFreeBytes: -1 },
      }),
    ).toThrow(DryRunInputError)
  })

  it("throws DryRunInputError on assumptions where max < min", () => {
    expect(() =>
      simulateDryRun({
        plan: plan(),
        modelCandidates: [candidate()],
        environment: environment(),
        assumptions: { ...DEFAULT_DRY_RUN_ASSUMPTIONS, maxSecondsPerTask: 1, minSecondsPerTask: 100 },
      }),
    ).toThrow(DryRunInputError)
  })
})
