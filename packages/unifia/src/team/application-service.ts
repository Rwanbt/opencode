import { FinalValidator, type AcceptanceCriterion, type RollbackStatus, type ValidatedTask } from "./final-validator"
import { IntegrationRuntime, type IntegrationCandidate, type IntegrationPlan } from "./integration-runtime"
import { ReportBuilder, type CostSummary, type RunReport } from "./report-builder"
import {
  IndependentReviewRuntime,
  type ReviewModelSelector,
  type ReviewResult,
  type ReviewRisk,
} from "./review-runtime"
import type { TeamStore } from "./team-store"

export interface TeamApplicationTask {
  readonly taskId: string
  readonly description: string
  readonly mode: "read" | "write"
  readonly required: boolean
  readonly dependsOn: readonly string[]
  readonly scope: unknown
  readonly risk: ReviewRisk
}

export interface TeamApplicationRequest {
  readonly runId: string
  readonly planId: string
  readonly parentSessionId: string
  readonly objective: string
  readonly primaryWorkspacePath: string
  readonly integrationTargetBranch: string
  readonly integrationBaseSha: string
  readonly tasks: readonly TeamApplicationTask[]
  readonly maxParallel?: number
  readonly budget?: { readonly maxCostUsd?: number; readonly maxTokens?: number }
  readonly control?: { waitUntilRunnable(): Promise<void> }
  readonly cost?: CostSummary
}

export interface TeamWorkerResult {
  readonly status: "COMPLETED" | "FAILED" | "CANCELLED"
  readonly workerId: string
  readonly sessionId: string
  readonly modelId: string
  readonly worktreePath: string | null
  readonly output: string
  readonly commit: string | null
  readonly diff: string
  readonly changedPaths: readonly string[]
  readonly tests: readonly string[]
  readonly handoff: string
  readonly proofRef: string | null
  readonly costUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly error?: string
}

export interface TeamWorkerAdapter {
  run(input: {
    readonly runId: string
    readonly parentSessionId: string
    readonly task: TeamApplicationTask
    readonly dependencyOutputs: readonly string[]
    readonly signal: AbortSignal
    /** Model IDs (`providerID/modelID`) that have burned ≥95% of the run's budget — the adapter should route around them when it can. */
    readonly excludedModelIds: readonly string[]
  }): Promise<TeamWorkerResult>
}

export interface TeamIntegrationResult {
  readonly status: "COMPLETED" | "FAILED"
  readonly proofRefs: readonly string[]
  readonly rollbackStatus: RollbackStatus
  readonly error?: string
}

export interface TeamIntegrationAdapter {
  execute(plan: IntegrationPlan, signal: AbortSignal): Promise<TeamIntegrationResult>
}

export interface TeamApplicationResult {
  readonly runId: string
  readonly report: RunReport
  readonly taskResults: ReadonlyMap<string, TeamWorkerResult>
  readonly reviews: ReadonlyMap<string, ReviewResult>
  readonly integrationPlan: IntegrationPlan | null
}

interface TaskExecution {
  readonly worker: TeamWorkerResult
  readonly review: ReviewResult | null
}

export class TeamApplicationService {
  readonly #reviewRuntime = new IndependentReviewRuntime()
  readonly #integrationRuntime = new IntegrationRuntime()
  readonly #validator = new FinalValidator()
  readonly #reportBuilder = new ReportBuilder()

  constructor(
    private readonly store: TeamStore,
    private readonly workers: TeamWorkerAdapter,
    private readonly reviewers: ReviewModelSelector,
    private readonly integration: TeamIntegrationAdapter,
  ) {}

  async run(request: TeamApplicationRequest, signal = new AbortController().signal): Promise<TeamApplicationResult> {
    validateTeamApplicationRequest(request)
    await this.persistStart(request)
    const executions = new Map<string, TaskExecution>()

    try {
      for (const wave of computeWaves(request.tasks)) {
        const maxParallel = request.budget?.maxCostUsd !== undefined || request.budget?.maxTokens !== undefined ? 1 : request.maxParallel ?? wave.length
        for (let offset = 0; offset < wave.length; offset += maxParallel) {
          await request.control?.waitUntilRunnable()
          const batch = wave.slice(offset, offset + maxParallel)
          if (signal.aborted || budgetExceeded(request, executions)) {
            for (const task of batch) await this.store.updateTaskStatus(task.taskId, signal.aborted ? "cancelled" : "blocked")
            continue
          }
          await Promise.all(batch.map((task) => this.executeTask(request, task, executions, signal)))
        }
        if (signal.aborted) break
      }

      const candidates = buildCandidates(request.tasks, executions)
      const integrationPlan = candidates.length === 0
        ? null
        : this.#integrationRuntime.plan({
            targetBranch: request.integrationTargetBranch,
            baseSha: request.integrationBaseSha,
            candidates,
          })
      const integrationResult = await this.integrate(integrationPlan, signal)
      const validatedTasks = buildValidatedTasks(request.tasks, executions, integrationResult)
      const acceptanceCriteria = buildAcceptanceCriteria(request, validatedTasks, integrationPlan, integrationResult)
      const validation = this.#validator.validate({
        runId: request.runId,
        objective: request.objective,
        tasks: validatedTasks,
        rollbackStatus: integrationResult.rollbackStatus,
        acceptanceCriteria,
      })
      const report = this.#reportBuilder.build({
        validation,
        objective: request.objective,
        cost: request.cost ?? executionCost(executions),
        fallbacks: [],
        openRisks: validation.blockingReasons.map((reason) => ({
          id: reason.subjectId,
          description: reason.detail,
          severity: reason.kind.includes("FAILED") ? "high" : "medium",
        })),
        proofRefs: [...new Set(validatedTasks.flatMap((task) => task.proofRef ?? []).concat(integrationResult.proofRefs))],
      })
      await this.store.appendEvent(request.runId, crypto.randomUUID(), "team.final_validation", validation)
      await this.store.updateRunStatus(request.runId, signal.aborted ? "aborted" : validation.verdict === "COMPLETE" ? "completed" : "failed")
      return result(request.runId, report, executions, integrationPlan)
    } catch (error) {
      await this.store.appendEvent(request.runId, crypto.randomUUID(), "team.runtime_failed", {
        error: error instanceof Error ? error.message : String(error),
      })
      await this.store.updateRunStatus(request.runId, signal.aborted ? "aborted" : "failed")
      throw error
    }
  }

  private async persistStart(request: TeamApplicationRequest): Promise<void> {
    const existing = this.store.getRun(request.runId)
    if (existing && existing.planId !== request.planId) throw new Error(`Team run ${request.runId} already belongs to plan ${existing.planId}`)
    if (existing) await this.store.updateRunStatus(request.runId, "running")
    else await this.store.createRun({ runId: request.runId, planId: request.planId, status: "running" })
    for (const task of request.tasks) {
      await this.store.createTask({
        taskId: task.taskId,
        runId: request.runId,
        dependsOn: [...task.dependsOn],
        scope: task.scope,
      })
    }
    await this.store.appendEvent(request.runId, crypto.randomUUID(), "team.started", {
      objective: request.objective,
      taskIds: request.tasks.map((task) => task.taskId),
    })
  }

  private async executeTask(
    request: TeamApplicationRequest,
    task: TeamApplicationTask,
    executions: Map<string, TaskExecution>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || task.dependsOn.some((dependency) => !dependencySucceeded(executions.get(dependency)))) {
      await this.store.updateTaskStatus(task.taskId, signal.aborted ? "cancelled" : "blocked")
      return
    }

    const attemptId = crypto.randomUUID()
    await this.store.updateTaskStatus(task.taskId, "running")
    await this.store.createAttempt({ attemptId, taskId: task.taskId, workerId: "pending" })
    const excludedModelIds = modelsNearBudgetLimit(request, executions)
    if (excludedModelIds.length > 0) {
      await this.store.appendEvent(request.runId, crypto.randomUUID(), "team.budget_handoff", { taskId: task.taskId, excludedModelIds })
    }
    let worker: TeamWorkerResult
    try {
      worker = await this.workers.run({
        runId: request.runId,
        parentSessionId: request.parentSessionId,
        task,
        dependencyOutputs: task.dependsOn.map((dependency) => executions.get(dependency)!.worker.output),
        signal,
        excludedModelIds,
      })
      assertWorkerResult(request, task, worker)
    } catch (error) {
      await this.store.finishAttempt(attemptId, signal.aborted ? "aborted" : "failure", {
        report: { error: error instanceof Error ? error.message : String(error) },
      })
      await this.store.updateTaskStatus(task.taskId, signal.aborted ? "cancelled" : "blocked")
      return
    }

    if (worker.status !== "COMPLETED") {
      await this.store.finishAttempt(attemptId, worker.status === "CANCELLED" ? "aborted" : "failure", { report: worker })
      await this.store.updateTaskStatus(task.taskId, worker.status === "CANCELLED" ? "cancelled" : "blocked")
      executions.set(task.taskId, { worker, review: null })
      return
    }

    await this.store.finishAttempt(attemptId, "success", { commitSha: worker.commit ?? undefined, report: worker })
    const review = task.mode === "write" ? await this.reviewTask(request.runId, task, worker, signal) : null
    executions.set(task.taskId, { worker, review })
    await this.store.updateTaskStatus(task.taskId, review && review.verdict !== "APPROVED" ? "blocked" : "completed")
    await this.store.appendEvent(request.runId, crypto.randomUUID(), "team.task_finished", {
      taskId: task.taskId,
      status: worker.status,
      reviewVerdict: review?.verdict ?? null,
    })
  }

  private async reviewTask(runId: string, task: TeamApplicationTask, worker: TeamWorkerResult, signal: AbortSignal): Promise<ReviewResult> {
    const review = await this.#reviewRuntime.run({
      cardId: task.taskId,
      implementationCommit: worker.commit!,
      implementerModelId: worker.modelId,
      risk: task.risk,
      diff: worker.diff,
      tests: worker.tests,
      handoff: worker.handoff,
    }, this.reviewers, signal)
    await this.store.recordGate({
      gateId: crypto.randomUUID(),
      runId,
      taskId: task.taskId,
      verdict: review.verdict === "APPROVED" ? "APPROVED" : "CHANGES_REQUESTED",
      findings: { originalVerdict: review.verdict, reviewerModelId: review.reviewerModelId, findings: review.findings, evidence: review.evidence },
    })
    return review
  }

  private async integrate(plan: IntegrationPlan | null, signal: AbortSignal): Promise<TeamIntegrationResult> {
    if (plan === null) return { status: "COMPLETED", proofRefs: ["no write integration required"], rollbackStatus: "NOT_REQUIRED" }
    if (plan.excluded.length > 0 || plan.conflicts.length > 0 || signal.aborted) {
      return { status: "FAILED", proofRefs: [], rollbackStatus: "NOT_REQUIRED", error: "integration plan contains exclusions, conflicts, or cancellation" }
    }
    return this.integration.execute(plan, signal)
  }
}

export function validateTeamApplicationRequest(request: TeamApplicationRequest): void {
  if (!request.runId.trim() || !request.planId.trim() || !request.objective.trim()) throw new TypeError("runId, planId and objective are required")
  if (request.maxParallel !== undefined && (!Number.isInteger(request.maxParallel) || request.maxParallel < 1)) throw new RangeError("maxParallel must be a positive integer")
  validateTeamTaskGraph(request.tasks)
}

export function validateTeamTaskGraph(tasks: readonly TeamApplicationTask[]): void {
  if (tasks.length === 0) throw new TypeError("at least one Team task is required")
  const ids = new Set(tasks.map((task) => task.taskId))
  if (ids.size !== tasks.length || tasks.some((task) => !task.taskId.trim())) throw new TypeError("Team task IDs must be unique and non-empty")
  for (const task of tasks) for (const dependency of task.dependsOn) if (!ids.has(dependency) || dependency === task.taskId) throw new TypeError(`invalid dependency ${task.taskId} -> ${dependency}`)
  computeWaves(tasks)
}

function computeWaves(tasks: readonly TeamApplicationTask[]): readonly (readonly TeamApplicationTask[])[] {
  const remaining = new Map(tasks.map((task) => [task.taskId, task] as const))
  const complete = new Set<string>()
  const waves: TeamApplicationTask[][] = []
  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((task) => task.dependsOn.every((dependency) => complete.has(dependency)))
    if (wave.length === 0) throw new TypeError("Team task graph contains a dependency cycle")
    waves.push(wave)
    for (const task of wave) { remaining.delete(task.taskId); complete.add(task.taskId) }
  }
  return waves
}

function assertWorkerResult(request: TeamApplicationRequest, task: TeamApplicationTask, worker: TeamWorkerResult): void {
  if (worker.status !== "COMPLETED") return
  if (!worker.modelId.trim() || !worker.proofRef?.trim()) throw new Error(`Team task ${task.taskId} completed without model or proof evidence`)
  if (task.mode === "read") return
  if (!worker.worktreePath || samePath(request.primaryWorkspacePath, worker.worktreePath)) throw new Error(`Write task ${task.taskId} did not run in an isolated worktree`)
  if (!worker.commit?.trim() || !worker.diff.trim() || worker.tests.length === 0 || !worker.handoff.trim()) throw new Error(`Write task ${task.taskId} completed without commit, diff, tests, or handoff evidence`)
}

function samePath(left: string, right: string): boolean {
  const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  return normalize(left) === normalize(right)
}

function dependencySucceeded(execution: TaskExecution | undefined): boolean {
  return execution?.worker.status === "COMPLETED" && (execution.review === null || execution.review.verdict === "APPROVED")
}
function buildCandidates(tasks: readonly TeamApplicationTask[], executions: ReadonlyMap<string, TaskExecution>): IntegrationCandidate[] {
  return tasks.filter((task) => task.mode === "write").map((task) => {
    const execution = executions.get(task.taskId)
    return {
      cardId: task.taskId,
      commit: execution?.worker.commit ?? "UNAVAILABLE",
      dependsOn: task.dependsOn.filter((dependency) => tasks.find((candidate) => candidate.taskId === dependency)?.mode === "write"),
      verdict: execution?.review?.verdict ?? "BLOCKED",
      reviewedCommit: execution?.review ? execution.worker.commit ?? "UNAVAILABLE" : "UNREVIEWED",
      changedPaths: execution?.worker.changedPaths ?? [],
    }
  })
}

function buildValidatedTasks(tasks: readonly TeamApplicationTask[], executions: ReadonlyMap<string, TaskExecution>, integration: TeamIntegrationResult): ValidatedTask[] {
  return tasks.map((task) => {
    const execution = executions.get(task.taskId)
    const passed = execution?.worker.status === "COMPLETED" && (task.mode === "read" || (execution.review?.verdict === "APPROVED" && integration.status === "COMPLETED"))
    return { taskId: task.taskId, required: task.required, outcome: passed ? "PASSED" : execution ? "FAILED" : "NOT_RUN", proofRef: passed ? execution!.worker.proofRef : null }
  })
}

function buildAcceptanceCriteria(request: TeamApplicationRequest, tasks: readonly ValidatedTask[], plan: IntegrationPlan | null, integration: TeamIntegrationResult): AcceptanceCriterion[] {
  const requiredPassed = tasks.filter((task) => task.required).every((task) => task.outcome === "PASSED" && task.proofRef)
  const integrationRequired = request.tasks.some((task) => task.mode === "write")
  const integrated = !integrationRequired || (plan !== null && integration.status === "COMPLETED")
  return [{ id: "objective", statement: request.objective, satisfied: requiredPassed && integrated, proofRef: requiredPassed && integrated ? integration.proofRefs.join(", ") : null }]
}

function executionCost(executions: ReadonlyMap<string, TaskExecution>): CostSummary {
  return [...executions.values()].reduce((cost, execution) => ({
    totalCostUsd: cost.totalCostUsd + execution.worker.costUsd,
    inputTokens: cost.inputTokens + execution.worker.inputTokens,
    outputTokens: cost.outputTokens + execution.worker.outputTokens,
  }), { totalCostUsd: 0, inputTokens: 0, outputTokens: 0 })
}

/**
 * Fraction of the run's budget (0.95) at which a model is treated as "about
 * to hit the hard stop" and steered away from for tasks that have not
 * started yet. This is a soft, run-level proxy — the request only carries
 * one cost/token pool, not a per-model sub-budget — so it hands off *before*
 * `budgetExceeded` would give up on the remaining tasks outright.
 */
const BUDGET_HANDOFF_THRESHOLD = 0.95

function costPerModel(executions: ReadonlyMap<string, TaskExecution>): ReadonlyMap<string, { costUsd: number; totalTokens: number }> {
  const byModel = new Map<string, { costUsd: number; totalTokens: number }>()
  for (const execution of executions.values()) {
    const modelId = execution.worker.modelId
    const current = byModel.get(modelId) ?? { costUsd: 0, totalTokens: 0 }
    byModel.set(modelId, {
      costUsd: current.costUsd + execution.worker.costUsd,
      totalTokens: current.totalTokens + execution.worker.inputTokens + execution.worker.outputTokens,
    })
  }
  return byModel
}

function modelsNearBudgetLimit(request: TeamApplicationRequest, executions: ReadonlyMap<string, TaskExecution>): readonly string[] {
  if (request.budget?.maxCostUsd === undefined && request.budget?.maxTokens === undefined) return []
  const near: string[] = []
  for (const [modelId, usage] of costPerModel(executions)) {
    const overCost = request.budget?.maxCostUsd !== undefined && usage.costUsd >= BUDGET_HANDOFF_THRESHOLD * request.budget.maxCostUsd
    const overTokens = request.budget?.maxTokens !== undefined && usage.totalTokens >= BUDGET_HANDOFF_THRESHOLD * request.budget.maxTokens
    if (overCost || overTokens) near.push(modelId)
  }
  return near
}

function budgetExceeded(request: TeamApplicationRequest, executions: ReadonlyMap<string, TaskExecution>): boolean {
  const cost = executionCost(executions)
  const tokens = cost.inputTokens + cost.outputTokens
  return (request.budget?.maxCostUsd !== undefined && cost.totalCostUsd >= request.budget.maxCostUsd)
    || (request.budget?.maxTokens !== undefined && tokens >= request.budget.maxTokens)
}
function result(runId: string, report: RunReport, executions: ReadonlyMap<string, TaskExecution>, integrationPlan: IntegrationPlan | null): TeamApplicationResult {
  return {
    runId,
    report,
    taskResults: new Map([...executions].map(([taskId, execution]) => [taskId, execution.worker])),
    reviews: new Map([...executions].flatMap(([taskId, execution]) => execution.review ? [[taskId, execution.review] as const] : [])),
    integrationPlan,
  }
}