/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-start-run-form.ts — A5-06
//
// Pure draft-state and validation for the "start a new run" form — the exact
// shape sdk.client.team.startRun needs (packages/unifia/src/server/routes/
// team.ts:122-142's StartRunSchema), built from form-friendly string fields
// (comma-separated lists, numeric inputs as strings) rather than the
// server's typed arrays/numbers directly.
//
// Reimplements validateTeamTaskGraph's four rules (application-service.ts:
// 276-295) client-side — non-empty unique ids, dependsOn references that
// exist and aren't self-referential, and an explicit cycle check (wavesFor
// does not detect cycles; it silently dumps leftovers into a final wave) —
// so a bad graph is rejected instantly instead of round-tripping to a 400.
// =============================================================================

export type TaskMode = "read" | "write"
export type TaskRisk = "" | "low" | "medium" | "high" | "critical"

// Not readonly: held in a Solid store and mutated field-by-field as the user
// edits a row (see setBudget/updateRow in work-start-run.tsx) — readonly
// fields make SetStoreFunction's key parameter resolve to `never`.
export interface DraftTask {
  id: string
  description: string
  prompt: string
  agent: string
  mode: TaskMode
  risk: TaskRisk
  /** Comma-separated task ids, as typed. */
  dependsOn: string
  /** Comma-separated file paths, as typed. */
  readSet: string
  /** Comma-separated file paths, as typed. */
  writeSet: string
  modelIndex: number | undefined
}

export function emptyDraftTask(): DraftTask {
  return {
    id: "",
    description: "",
    prompt: "",
    agent: "",
    mode: "read",
    risk: "",
    dependsOn: "",
    readSet: "",
    writeSet: "",
    modelIndex: undefined,
  }
}

// Not readonly, same reason as DraftTask above.
export interface DraftBudget {
  maxCostUsd: string
  maxTokens: string
  maxParallel: string
}

export function emptyDraftBudget(): DraftBudget {
  return { maxCostUsd: "", maxTokens: "", maxParallel: "" }
}

export function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export type DraftError =
  | { readonly kind: "descriptionRequired" }
  | { readonly kind: "noTasks" }
  | { readonly kind: "missingFields"; readonly id: string }
  | { readonly kind: "duplicateId"; readonly id: string }
  | { readonly kind: "selfDependency"; readonly id: string }
  | { readonly kind: "unknownDependency"; readonly id: string; readonly dependsOn: string }
  | { readonly kind: "cycle" }

function hasCycle(tasks: readonly { readonly id: string; readonly dependsOn: readonly string[] }[]): boolean {
  const remaining = new Map(tasks.map((task) => [task.id, task]))
  const done = new Set<string>()
  let progressed = true
  while (remaining.size > 0 && progressed) {
    progressed = false
    for (const [id, task] of [...remaining]) {
      if (task.dependsOn.every((dependency) => done.has(dependency))) {
        done.add(id)
        remaining.delete(id)
        progressed = true
      }
    }
  }
  return remaining.size > 0
}

export function validateDraft(description: string, tasks: readonly DraftTask[]): readonly DraftError[] {
  const errors: DraftError[] = []
  if (description.trim().length === 0) errors.push({ kind: "descriptionRequired" })
  if (tasks.length === 0) errors.push({ kind: "noTasks" })

  const idSet = new Set(tasks.map((task) => task.id.trim()).filter((id) => id.length > 0))
  const seenIds = new Set<string>()

  for (const task of tasks) {
    const id = task.id.trim()
    const missingRequired =
      id.length === 0 || task.description.trim().length === 0 || task.prompt.trim().length === 0 || task.agent.trim().length === 0
    if (missingRequired) {
      errors.push({ kind: "missingFields", id: id || "?" })
      continue
    }
    if (seenIds.has(id)) {
      errors.push({ kind: "duplicateId", id })
      continue
    }
    seenIds.add(id)
    for (const dependency of parseList(task.dependsOn)) {
      if (dependency === id) errors.push({ kind: "selfDependency", id })
      else if (!idSet.has(dependency)) errors.push({ kind: "unknownDependency", id, dependsOn: dependency })
    }
  }

  if (errors.length === 0) {
    const graph = tasks.map((task) => ({ id: task.id.trim(), dependsOn: parseList(task.dependsOn) }))
    if (hasCycle(graph)) errors.push({ kind: "cycle" })
  }

  return errors
}

// Not readonly: passed directly as sdk.client.team.startRun's parameters,
// whose generated type expects plain mutable arrays.
export interface StartRunPayload {
  description: string
  budget?: {
    maxCostUsd?: number
    maxTokens?: number
    maxParallel?: number
  }
  tasks: Array<{
    id: string
    description: string
    prompt: string
    agent: string
    mode: TaskMode
    risk?: Exclude<TaskRisk, "">
    dependsOn?: string[]
    readSet?: string[]
    writeSet?: string[]
    modelIndex?: number
  }>
}

/** Assumes validateDraft(description, tasks) returned no errors. */
export function toStartRunPayload(description: string, budget: DraftBudget, tasks: readonly DraftTask[]): StartRunPayload {
  const maxCostUsd = budget.maxCostUsd.trim() ? Number(budget.maxCostUsd) : undefined
  const maxTokens = budget.maxTokens.trim() ? Number(budget.maxTokens) : undefined
  const maxParallel = budget.maxParallel.trim() ? Number(budget.maxParallel) : undefined
  const hasBudget = maxCostUsd !== undefined || maxTokens !== undefined || maxParallel !== undefined

  return {
    description: description.trim(),
    ...(hasBudget ? { budget: { maxCostUsd, maxTokens, maxParallel } } : {}),
    tasks: tasks.map((task) => {
      const dependsOn = parseList(task.dependsOn)
      const readSet = parseList(task.readSet)
      const writeSet = parseList(task.writeSet)
      return {
        id: task.id.trim(),
        description: task.description.trim(),
        prompt: task.prompt.trim(),
        agent: task.agent.trim(),
        mode: task.mode,
        ...(task.risk ? { risk: task.risk } : {}),
        ...(dependsOn.length > 0 ? { dependsOn } : {}),
        ...(readSet.length > 0 ? { readSet } : {}),
        ...(writeSet.length > 0 ? { writeSet } : {}),
        ...(task.modelIndex !== undefined ? { modelIndex: task.modelIndex } : {}),
      }
    }),
  }
}
