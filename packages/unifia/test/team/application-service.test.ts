import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  TeamApplicationService,
  type TeamApplicationRequest,
  type TeamIntegrationAdapter,
  type TeamWorkerAdapter,
  type TeamWorkerResult,
} from "../../src/team/application-service"
import type { ReviewModel, ReviewModelSelector } from "../../src/team/review-runtime"
import { TeamStore } from "../../src/team/team-store"

const roots: string[] = []
const stores: TeamStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await new Promise((resolve) => setTimeout(resolve, 25))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }).catch(() => {})
})

async function store(): Promise<TeamStore> {
  const root = await mkdtemp(join(tmpdir(), "opencode-team-application-"))
  roots.push(root)
  const value = TeamStore.open(join(root, "team.db"))
  stores.push(value)
  return value
}

function request(overrides: Partial<TeamApplicationRequest> = {}): TeamApplicationRequest {
  return {
    runId: "run-1",
    planId: "plan-1",
    parentSessionId: "session-parent",
    objective: "Implement and verify Team runtime",
    primaryWorkspacePath: "D:/repo",
    integrationTargetBranch: "team/integration-run-1",
    integrationBaseSha: "base-sha",
    tasks: [
      { taskId: "research", description: "Research", mode: "read", required: true, dependsOn: [], scope: { read: ["src"] }, risk: "low" },
      { taskId: "implement", description: "Implement", mode: "write", required: true, dependsOn: ["research"], scope: { write: ["src/team.ts"] }, risk: "high" },
    ],
    ...overrides,
  }
}

function result(taskId: string): TeamWorkerResult {
  const write = taskId === "implement"
  return {
    status: "COMPLETED",
    workerId: `worker-${taskId}`,
    sessionId: `session-${taskId}`,
    modelId: write ? "model-implementer" : "model-research",
    worktreePath: write ? "D:/repo-worktrees/implement" : null,
    output: `${taskId} output`,
    commit: write ? "commit-implement" : null,
    diff: write ? "diff --git a/src/team.ts b/src/team.ts" : "",
    changedPaths: write ? ["src/team.ts"] : [],
    tests: write ? ["bun test"] : [],
    handoff: write ? "Implementation complete with tests." : "",
    proofRef: `proof:${taskId}`,
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 50,
  }
}

function reviewer(modelId = "model-reviewer"): ReviewModelSelector {
  const model: ReviewModel = {
    modelId,
    review: async () => ({ verdict: "APPROVED", findings: [], evidence: ["diff and tests reviewed"] }),
  }
  return { selectIndependent: async () => model }
}

class Integration implements TeamIntegrationAdapter {
  calls = 0
  async execute() {
    this.calls++
    return { status: "COMPLETED" as const, proofRefs: ["integration:test"], rollbackStatus: "TESTED" as const }
  }
}

describe("TeamApplicationService", () => {
  test("owns the durable worker -> review -> integration -> final validation lifecycle", async () => {
    const durable = await store()
    const seenDependencies: string[][] = []
    const workers: TeamWorkerAdapter = {
      run: async ({ task, dependencyOutputs }) => {
        seenDependencies.push([...dependencyOutputs])
        return result(task.taskId)
      },
    }
    const integration = new Integration()
    const service = new TeamApplicationService(durable, workers, reviewer(), integration)

    const run = await service.run(request())

    expect(run.report.verdict).toBe("COMPLETE")
    expect(integration.calls).toBe(1)
    expect(seenDependencies).toEqual([[], ["research output"]])
    expect(run.integrationPlan?.order.map((candidate) => candidate.cardId)).toEqual(["implement"])
    expect(run.reviews.get("implement")?.reviewerModelId).toBe("model-reviewer")
    expect(durable.getRun("run-1")?.status).toBe("completed")
    expect(durable.listTasks("run-1").map((task) => task.status)).toEqual(["completed", "completed"])
    expect(durable.listGates("run-1")[0]?.verdict).toBe("APPROVED")
  })

  test("fails closed when a write worker falls back to the primary workspace", async () => {
    const durable = await store()
    const workers: TeamWorkerAdapter = {
      run: async ({ task }) => task.mode === "write" ? { ...result(task.taskId), worktreePath: "d:\\repo" } : result(task.taskId),
    }
    const integration = new Integration()
    const service = new TeamApplicationService(durable, workers, reviewer(), integration)

    const run = await service.run(request())

    expect(run.report.verdict).not.toBe("COMPLETE")
    expect(integration.calls).toBe(0)
    expect(durable.listTasks("run-1").find((task) => task.taskId === "implement")?.status).toBe("blocked")
  })

  test("blocks dependants of a write task whose independent review did not approve", async () => {
    const durable = await store()
    const called: string[] = []
    const workers: TeamWorkerAdapter = { run: async ({ task }) => { called.push(task.taskId); return result(task.taskId) } }
    const reviewModel: ReviewModel = {
      modelId: "model-reviewer",
      review: async () => ({
        verdict: "CHANGES_REQUESTED",
        findings: [{ severity: "P1", title: "unsafe", evidence: "diff", remediation: "fix" }],
        evidence: ["diff reviewed"],
      }),
    }
    const service = new TeamApplicationService(durable, workers, { selectIndependent: async () => reviewModel }, new Integration())
    const run = await service.run(request({
      tasks: [
        { taskId: "implement", description: "Implement", mode: "write", required: true, dependsOn: [], scope: {}, risk: "high" },
        { taskId: "followup", description: "Follow up", mode: "read", required: true, dependsOn: ["implement"], scope: {}, risk: "low" },
      ],
    }))

    expect(called).toEqual(["implement"])
    expect(durable.listTasks("run-1").find((task) => task.taskId === "followup")?.status).toBe("blocked")
    expect(run.report.verdict).toBe("FAILED")
  })
  test("routes a task away from a model that has burned 95% of the run's budget", async () => {
    const durable = await store()
    const seenExclusions: (readonly string[])[] = []
    const workers: TeamWorkerAdapter = {
      run: async ({ task, excludedModelIds }) => {
        seenExclusions.push(excludedModelIds)
        const heavy = task.taskId === "research"
        return {
          ...result(task.taskId),
          modelId: heavy ? "model-a" : excludedModelIds.includes("model-a") ? "model-b" : "model-a",
          costUsd: heavy ? 0.96 : 0.01,
        }
      },
    }
    const service = new TeamApplicationService(durable, workers, reviewer(), new Integration())

    await service.run(request({ budget: { maxCostUsd: 1 } }))

    // The first task (no dependencies) sees no exclusion; by the time the
    // second task is dispatched, model-a has already burned 96% of the run's
    // 1 USD ceiling, so it is excluded and the adapter picks another model.
    expect(seenExclusions).toEqual([[], ["model-a"]])
    const handoffEvents = durable.listEvents("run-1").items.filter((event) => event.kind === "team.budget_handoff")
    expect(handoffEvents).toHaveLength(1)
    expect(handoffEvents[0]!.payload).toMatchObject({ taskId: "implement", excludedModelIds: ["model-a"] })
  })

  test("never integrates when no independent reviewer is available", async () => {
    const durable = await store()
    const workers: TeamWorkerAdapter = { run: async ({ task }) => result(task.taskId) }
    const integration = new Integration()
    const service = new TeamApplicationService(durable, workers, { selectIndependent: async () => null }, integration)

    const run = await service.run(request())

    expect(run.reviews.get("implement")?.verdict).toBe("BLOCKED")
    expect(run.report.verdict).toBe("FAILED")
    expect(integration.calls).toBe(0)
    expect(durable.listGates("run-1")[0]?.findings).toMatchObject({ originalVerdict: "BLOCKED" })
  })
})