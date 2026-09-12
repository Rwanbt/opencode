import { NamedError } from "@unifia/util/error"
import z from "zod"
import { isTerminalStage, LifecycleStageSchema, type LifecycleStage } from "../model-intelligence/lifecycle"
import { validateGraph, type GraphValidationOptions, type GraphValidationResult } from "./graph-validator"
import type { PlannerTask, TaskPlan } from "./task-planner"

// =============================================================================
// dry-run.ts — TEAM-E05
//
// Simulates a full Team run for a validated TaskPlan without ever calling a
// worker: no LLM, no provider, no network, no git, no filesystem write. Every
// number this module produces is derived from data the caller supplies
// (the plan, a model shortlist snapshot, an environment snapshot, and
// optional cost/time heuristics) — never fetched internally. That is what
// makes the report reproducible for an identical snapshot (acceptance
// criterion): same inputs in, byte-identical `reproducibilityKey` out.
//
// Model eligibility reuses TEAM-C08's own `isTerminalStage` /
// `LifecycleStageSchema` (model-intelligence/lifecycle.ts) instead of
// re-deriving lifecycle rules here — that module is the sole owner of the
// lifecycle state machine. This module does NOT import model-intelligence's
// Effect-based Registry/Layer: dry-run only needs the plain lifecycle
// predicate, and pulling in the registry would add a live-data dependency
// this simulator must not have.
// =============================================================================

// -----------------------------------------------------------------------
// Boundary validation
// -----------------------------------------------------------------------

export const DryRunInputError = NamedError.create(
  "DryRunInputError",
  z.object({
    entity: z.string(),
    issues: z.array(
      z.object({
        path: z.string(),
        code: z.string(),
        message: z.string(),
      }),
    ),
  }),
)

function parseBoundary<Schema extends z.ZodTypeAny>(schema: Schema, entity: string, raw: unknown): z.infer<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new DryRunInputError({
      entity,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    })
  }
  return result.data
}

// -----------------------------------------------------------------------
// Model shortlist
// -----------------------------------------------------------------------

export const DryRunModelCandidateSchema = z
  .object({
    modelId: z.string().min(1),
    family: z.string().min(1),
    lifecycleStage: LifecycleStageSchema,
    costPerMillionInputTokens: z.number().nonnegative(),
    costPerMillionOutputTokens: z.number().nonnegative(),
    averageLatencyMs: z.number().nonnegative(),
  })
  .strict()
export type DryRunModelCandidate = z.infer<typeof DryRunModelCandidateSchema>

export const DryRunModelCandidateListSchema = z.array(DryRunModelCandidateSchema).superRefine((list, ctx) => {
  const seen = new Set<string>()
  list.forEach((candidate, index) => {
    if (seen.has(candidate.modelId)) {
      ctx.addIssue({ code: "custom", path: [index, "modelId"], message: `duplicate modelId ${candidate.modelId}` })
    }
    seen.add(candidate.modelId)
  })
})

export interface ModelShortlistEntry {
  readonly modelId: string
  readonly family: string
  readonly lifecycleStage: LifecycleStage
  readonly eligible: boolean
  readonly reason: string | null
  readonly costPerMillionInputTokens: number
  readonly costPerMillionOutputTokens: number
}

function buildModelShortlist(candidates: readonly DryRunModelCandidate[]): readonly ModelShortlistEntry[] {
  return candidates.map((candidate) => {
    const terminal = isTerminalStage(candidate.lifecycleStage)
    return {
      modelId: candidate.modelId,
      family: candidate.family,
      lifecycleStage: candidate.lifecycleStage,
      eligible: !terminal,
      reason: terminal
        ? `lifecycle stage "${candidate.lifecycleStage}" is terminal (C08) and excluded from dry-run shortlists`
        : null,
      costPerMillionInputTokens: candidate.costPerMillionInputTokens,
      costPerMillionOutputTokens: candidate.costPerMillionOutputTokens,
    }
  })
}

// -----------------------------------------------------------------------
// Environment snapshot + cost/time assumptions
// -----------------------------------------------------------------------

export const DryRunEnvironmentSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1),
    diskFreeBytes: z.number().nonnegative(),
    diskRequiredBytesPerTask: z.number().positive(),
    existingWorktreeCount: z.number().int().nonnegative(),
    maxConcurrentWorktrees: z.number().int().positive(),
  })
  .strict()
export type DryRunEnvironmentSnapshot = z.infer<typeof DryRunEnvironmentSnapshotSchema>

export const DryRunAssumptionsSchema = z
  .object({
    minInputTokensPerTask: z.number().int().nonnegative(),
    maxInputTokensPerTask: z.number().int().nonnegative(),
    minOutputTokensPerTask: z.number().int().nonnegative(),
    maxOutputTokensPerTask: z.number().int().nonnegative(),
    minSecondsPerTask: z.number().nonnegative(),
    maxSecondsPerTask: z.number().nonnegative(),
    reviewOverheadFactor: z.number().positive(),
  })
  .strict()
  .superRefine((assumptions, ctx) => {
    if (assumptions.maxInputTokensPerTask < assumptions.minInputTokensPerTask) {
      ctx.addIssue({ code: "custom", path: ["maxInputTokensPerTask"], message: "must be >= minInputTokensPerTask" })
    }
    if (assumptions.maxOutputTokensPerTask < assumptions.minOutputTokensPerTask) {
      ctx.addIssue({ code: "custom", path: ["maxOutputTokensPerTask"], message: "must be >= minOutputTokensPerTask" })
    }
    if (assumptions.maxSecondsPerTask < assumptions.minSecondsPerTask) {
      ctx.addIssue({ code: "custom", path: ["maxSecondsPerTask"], message: "must be >= minSecondsPerTask" })
    }
  })
export type DryRunAssumptions = z.infer<typeof DryRunAssumptionsSchema>

export const DEFAULT_DRY_RUN_ASSUMPTIONS: DryRunAssumptions = {
  minInputTokensPerTask: 2_000,
  maxInputTokensPerTask: 20_000,
  minOutputTokensPerTask: 500,
  maxOutputTokensPerTask: 6_000,
  minSecondsPerTask: 60,
  maxSecondsPerTask: 900,
  reviewOverheadFactor: 1.5,
}

// -----------------------------------------------------------------------
// Wave simulation
// -----------------------------------------------------------------------

export interface MinMax {
  readonly min: number
  readonly max: number
}

export interface DryRunWave {
  readonly index: number
  readonly taskIds: readonly string[]
  readonly estimatedDurationSeconds: MinMax
}

/**
 * Dependency level per task: 0 for a task with no in-plan dependency, else
 * 1 + max(level of its dependencies). A cycle (already rejected by
 * validateGraph as an ACYCLIC issue) is defensively pinned to level 0 rather
 * than recursing forever.
 */
function computeTaskLevels(tasks: readonly PlannerTask[]): ReadonlyMap<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task] as const))
  const levels = new Map<string, number>()
  const visiting = new Set<string>()

  function levelOf(id: string): number {
    const cached = levels.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const task = byId.get(id)
    const dependencyLevels = (task?.dependsOn ?? []).filter((dep) => byId.has(dep)).map(levelOf)
    const level = dependencyLevels.length === 0 ? 0 : Math.max(...dependencyLevels) + 1
    visiting.delete(id)
    levels.set(id, level)
    return level
  }

  for (const task of tasks) levelOf(task.id)
  return levels
}

function buildWaves(
  tasks: readonly PlannerTask[],
  assumptions: DryRunAssumptions,
  environment: DryRunEnvironmentSnapshot,
): readonly DryRunWave[] {
  const levels = computeTaskLevels(tasks)
  const maxLevel = Math.max(0, ...levels.values())
  const waves: DryRunWave[] = []
  for (let index = 0; index <= maxLevel; index++) {
    const taskIds = tasks.filter((task) => levels.get(task.id) === index).map((task) => task.id)
    if (taskIds.length === 0) continue
    // Tasks in a wave run concurrently up to maxConcurrentWorktrees; beyond
    // that they queue in sequential batches within the same wave.
    const batches = Math.max(1, Math.ceil(taskIds.length / environment.maxConcurrentWorktrees))
    waves.push({
      index,
      taskIds,
      estimatedDurationSeconds: {
        min: assumptions.minSecondsPerTask * assumptions.reviewOverheadFactor * batches,
        max: assumptions.maxSecondsPerTask * assumptions.reviewOverheadFactor * batches,
      },
    })
  }
  return waves
}

// -----------------------------------------------------------------------
// Disk / worktree preflight
// -----------------------------------------------------------------------

export interface DiskWorktreePreflight {
  readonly ok: boolean
  readonly warnings: readonly string[]
  readonly peakConcurrentTasks: number
  readonly projectedWorktreeCount: number
  readonly projectedDiskUsageBytes: number
}

function buildDiskWorktreePreflight(
  waves: readonly DryRunWave[],
  environment: DryRunEnvironmentSnapshot,
): DiskWorktreePreflight {
  const widestWave = Math.max(0, ...waves.map((wave) => wave.taskIds.length))
  const peakConcurrentTasks = Math.min(environment.maxConcurrentWorktrees, widestWave)
  const projectedWorktreeCount = environment.existingWorktreeCount + peakConcurrentTasks
  const projectedDiskUsageBytes = peakConcurrentTasks * environment.diskRequiredBytesPerTask
  const warnings: string[] = []
  if (projectedWorktreeCount > environment.maxConcurrentWorktrees) {
    warnings.push(
      `projected worktree count ${projectedWorktreeCount} exceeds maxConcurrentWorktrees ${environment.maxConcurrentWorktrees}`,
    )
  }
  if (projectedDiskUsageBytes > environment.diskFreeBytes) {
    warnings.push(
      `projected disk usage ${projectedDiskUsageBytes} bytes exceeds diskFreeBytes ${environment.diskFreeBytes}`,
    )
  }
  return { ok: warnings.length === 0, warnings, peakConcurrentTasks, projectedWorktreeCount, projectedDiskUsageBytes }
}

// -----------------------------------------------------------------------
// Cost / time / risk estimate
// -----------------------------------------------------------------------

export type DryRunConfidence = "low" | "medium" | "high"

export interface DryRunEstimate {
  readonly costUsd: MinMax
  readonly durationSeconds: MinMax
  readonly confidence: DryRunConfidence
  readonly assumptionNotes: readonly string[]
  readonly riskFactors: readonly string[]
}

function buildEstimate(
  tasks: readonly PlannerTask[],
  waves: readonly DryRunWave[],
  shortlist: readonly ModelShortlistEntry[],
  assumptions: DryRunAssumptions,
  graphValidation: GraphValidationResult,
  diskPreflight: DiskWorktreePreflight,
): DryRunEstimate {
  const eligible = shortlist.filter((entry) => entry.eligible)
  const durationSeconds: MinMax = {
    min: waves.reduce((sum, wave) => sum + wave.estimatedDurationSeconds.min, 0),
    max: waves.reduce((sum, wave) => sum + wave.estimatedDurationSeconds.max, 0),
  }

  const assumptionNotes: string[] = [
    `${tasks.length} task(s) across ${waves.length} wave(s).`,
    `Per-task tokens (uniform heuristic, not task-specific): ${assumptions.minInputTokensPerTask}-${assumptions.maxInputTokensPerTask} input, ${assumptions.minOutputTokensPerTask}-${assumptions.maxOutputTokensPerTask} output.`,
    `Per-task duration before the ${assumptions.reviewOverheadFactor}x review overhead factor: ${assumptions.minSecondsPerTask}-${assumptions.maxSecondsPerTask}s.`,
    "Concurrency within a wave is capped at environment.maxConcurrentWorktrees.",
  ]

  const riskFactors: string[] = graphValidation.issues.map(
    (issue) => `${issue.rule}${issue.nodeId ? ` (${issue.nodeId})` : ""}: ${issue.message}`,
  )
  if (!diskPreflight.ok) riskFactors.push(...diskPreflight.warnings)
  if (eligible.length === 0) riskFactors.push("no eligible model candidate in the shortlist")

  if (eligible.length === 0) {
    return { costUsd: { min: 0, max: 0 }, durationSeconds, confidence: "low", assumptionNotes, riskFactors }
  }

  const cheapestInput = Math.min(...eligible.map((model) => model.costPerMillionInputTokens))
  const cheapestOutput = Math.min(...eligible.map((model) => model.costPerMillionOutputTokens))
  const priciestInput = Math.max(...eligible.map((model) => model.costPerMillionInputTokens))
  const priciestOutput = Math.max(...eligible.map((model) => model.costPerMillionOutputTokens))

  const costUsd: MinMax = {
    min:
      tasks.length *
      ((assumptions.minInputTokensPerTask / 1_000_000) * cheapestInput +
        (assumptions.minOutputTokensPerTask / 1_000_000) * cheapestOutput),
    max:
      tasks.length *
      ((assumptions.maxInputTokensPerTask / 1_000_000) * priciestInput +
        (assumptions.maxOutputTokensPerTask / 1_000_000) * priciestOutput),
  }

  // graphValidation.valid is exactly `issues.length === 0` (graph-validator.ts),
  // so once the branch above rules out `!graphValidation.valid`, issues is
  // already guaranteed empty here — only the disk/worktree preflight can
  // still downgrade confidence.
  let confidence: DryRunConfidence
  if (!graphValidation.valid || eligible.length === 0) confidence = "low"
  else if (!diskPreflight.ok) confidence = "medium"
  else confidence = "high"

  return { costUsd, durationSeconds, confidence, assumptionNotes, riskFactors }
}

// -----------------------------------------------------------------------
// Rollback plan
// -----------------------------------------------------------------------

function buildRollbackPlan(waves: readonly DryRunWave[]): readonly string[] {
  const steps: string[] = [
    "This dry-run performs no writes; no rollback of the objective plan itself is required.",
    "If a real run was already attempted before this dry-run, restore the last checkpoint first.",
    "Revoke any lease associated with this dry-run.",
    "Preserve all evidence produced by this dry-run report.",
  ]
  for (const wave of [...waves].reverse()) {
    steps.push(
      `Wave ${wave.index}: if it was actually executed, remove only the worktrees/branches created for tasks ${wave.taskIds.join(", ")} after verification.`,
    )
  }
  steps.push("Never touch dev or main directly during rollback.")
  return steps
}

// -----------------------------------------------------------------------
// Reproducibility key
// -----------------------------------------------------------------------

function buildReproducibilityKey(
  plan: TaskPlan,
  shortlist: readonly ModelShortlistEntry[],
  environment: DryRunEnvironmentSnapshot,
  assumptions: DryRunAssumptions,
): string {
  const canonicalTasks = [...plan.tasks]
    .map((task) => ({
      id: task.id,
      dependsOn: [...task.dependsOn].sort(),
      readSet: [...task.readSet].sort(),
      writeSet: [...task.writeSet].sort(),
      exclusiveResources: [...task.exclusiveResources].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const canonicalShortlist = [...shortlist]
    .map((entry) => ({ modelId: entry.modelId, eligible: entry.eligible }))
    .sort((a, b) => a.modelId.localeCompare(b.modelId))
  const payload = JSON.stringify({
    schemaVersion: plan.schemaVersion,
    tasks: canonicalTasks,
    shortlist: canonicalShortlist,
    snapshotId: environment.snapshotId,
    assumptions,
  })
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(payload)
  return hasher.digest("hex")
}

// -----------------------------------------------------------------------
// Token estimate (feeds graph-validator's own BUDGET rule)
// -----------------------------------------------------------------------

/**
 * Total plan token usage implied by the per-task assumptions. Fed into
 * `validateGraph`'s `estimatedTokens` so the BUDGET rule (E03) can fire
 * from data this module already computes — without this, a caller would
 * have to run a dry-run first just to learn the number to feed back into
 * validation, which defeats the point of the estimate.
 */
function estimateTotalTokens(tasks: readonly PlannerTask[], assumptions: DryRunAssumptions): MinMax {
  return {
    min: tasks.length * (assumptions.minInputTokensPerTask + assumptions.minOutputTokensPerTask),
    max: tasks.length * (assumptions.maxInputTokensPerTask + assumptions.maxOutputTokensPerTask),
  }
}

// -----------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------

export interface DryRunInput {
  readonly plan: TaskPlan
  readonly modelCandidates: readonly DryRunModelCandidate[]
  readonly environment: DryRunEnvironmentSnapshot
  readonly assumptions?: DryRunAssumptions
  readonly validationOptions?: GraphValidationOptions
}

export interface DryRunReport {
  readonly reproducibilityKey: string
  readonly graphValidation: GraphValidationResult
  readonly modelShortlist: readonly ModelShortlistEntry[]
  readonly waves: readonly DryRunWave[]
  readonly diskWorktreePreflight: DiskWorktreePreflight
  readonly estimate: DryRunEstimate
  readonly rollbackPlan: readonly string[]
  readonly blocked: boolean
  readonly blockingReasons: readonly string[]
}

/**
 * Simulate a full Team run for `input.plan` with no worker, LLM, provider,
 * network, git, or filesystem call. Never throws on a plan that fails
 * validation or has no eligible model — those are reported via `blocked` /
 * `blockingReasons` so the caller gets a full report either way. Only
 * malformed *input shape* (bad modelCandidates/environment/assumptions)
 * throws `DryRunInputError`.
 */
export function simulateDryRun(input: DryRunInput): DryRunReport {
  const modelCandidates = parseBoundary(DryRunModelCandidateListSchema, "modelCandidates", input.modelCandidates)
  const environment = parseBoundary(DryRunEnvironmentSnapshotSchema, "environment", input.environment)
  const assumptions = input.assumptions
    ? parseBoundary(DryRunAssumptionsSchema, "assumptions", input.assumptions)
    : DEFAULT_DRY_RUN_ASSUMPTIONS

  const tokenEstimate = estimateTotalTokens(input.plan.tasks, assumptions)
  const graphValidation = validateGraph(input.plan, {
    ...input.validationOptions,
    estimatedTokens: input.validationOptions?.estimatedTokens ?? tokenEstimate.max,
  })
  const modelShortlist = buildModelShortlist(modelCandidates)
  const waves = buildWaves(input.plan.tasks, assumptions, environment)
  const diskWorktreePreflight = buildDiskWorktreePreflight(waves, environment)
  const estimate = buildEstimate(input.plan.tasks, waves, modelShortlist, assumptions, graphValidation, diskWorktreePreflight)
  const rollbackPlan = buildRollbackPlan(waves)
  const reproducibilityKey = buildReproducibilityKey(input.plan, modelShortlist, environment, assumptions)

  const blockingReasons: string[] = []
  if (!graphValidation.valid) blockingReasons.push("plan fails graph validation (see graphValidation.issues)")
  if (!modelShortlist.some((entry) => entry.eligible)) blockingReasons.push("no eligible model candidate in the shortlist")
  if (!diskWorktreePreflight.ok) blockingReasons.push(...diskWorktreePreflight.warnings)

  return {
    reproducibilityKey,
    graphValidation,
    modelShortlist,
    waves,
    diskWorktreePreflight,
    estimate,
    rollbackPlan,
    blocked: blockingReasons.length > 0,
    blockingReasons,
  }
}
