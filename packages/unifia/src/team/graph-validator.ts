import { NamedError } from "@unifia/util/error"
import z from "zod"
import type { PlannerTask, TaskPlan } from "./task-planner"

export const GraphValidationIssueSchema = z.object({
  rule: z.string().min(1),
  nodeId: z.string().min(1).nullable(),
  message: z.string().min(1),
  correction: z.string().min(1),
}).strict()

export type GraphValidationIssue = z.infer<typeof GraphValidationIssueSchema>

export interface GraphValidationOptions {
  readonly maxTasks?: number
  readonly maxDepth?: number
  readonly maxWritersPerPath?: number
  readonly reviewerAvailable?: boolean
  readonly maxTotalTokens?: number
  readonly estimatedTokens?: number
}

export interface GraphValidationResult {
  readonly valid: boolean
  readonly issues: readonly GraphValidationIssue[]
  readonly maxDepth: number
  readonly canonicalPaths: ReadonlyMap<string, string>
}

export const GraphValidationError = NamedError.create(
  "GraphValidationError",
  z.object({ issues: z.array(GraphValidationIssueSchema) }),
)

const DEFAULTS = { maxTasks: 50, maxDepth: 20, maxWritersPerPath: 3 } as const
const GENERATED_PATH = /(^|\/)(dist|build|generated|target)(\/|$)/i
const FORBIDDEN_PATH = /(^|\/)(migrations?|secrets?|credentials?)(\/|$)/i

function issue(rule: string, nodeId: string | null, message: string, correction: string): GraphValidationIssue {
  return { rule, nodeId, message, correction }
}

function canonicalPath(path: string): string | null {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+/g, "/")
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null
  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null
  return segments.join("/")
}

function dependencyDepth(tasks: readonly PlannerTask[], byId: ReadonlyMap<string, PlannerTask>): { depths: Map<string, number>; cycles: Set<string> } {
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  const completed = new Set<string>()
  const cycles = new Set<string>()
  function visit(id: string): number {
    if (completed.has(id)) return depths.get(id) ?? 1
    if (visiting.has(id)) { cycles.add(id); return 1 }
    visiting.add(id)
    const task = byId.get(id)
    const depth = task ? Math.max(1, ...task.dependsOn.filter((dep) => byId.has(dep)).map(visit).map((value) => value + 1)) : 1
    visiting.delete(id)
    completed.add(id)
    depths.set(id, depth)
    return depth
  }
  for (const task of tasks) visit(task.id)
  return { depths, cycles }
}

function hasDependencyPath(from: string, to: string, byId: ReadonlyMap<string, PlannerTask>, seen = new Set<string>()): boolean {
  if (from === to) return true
  if (seen.has(from)) return false
  seen.add(from)
  return (byId.get(from)?.dependsOn ?? []).some((dependency) => hasDependencyPath(dependency, to, byId, seen))
}

export function validateGraph(plan: TaskPlan, options: GraphValidationOptions = {}): GraphValidationResult {
  const limits = { ...DEFAULTS, ...options }
  const issues: GraphValidationIssue[] = []
  const byId = new Map<string, PlannerTask>()
  const canonicalPaths = new Map<string, string>()
  if (plan.tasks.length > limits.maxTasks) issues.push(issue("TASK_COUNT", null, `Plan has ${plan.tasks.length} tasks; limit is ${limits.maxTasks}.`, "Split the plan into bounded waves."))
  for (const task of plan.tasks) {
    if (byId.has(task.id)) issues.push(issue("UNIQUE_ID", task.id, `Task id ${task.id} is duplicated.`, "Assign a unique stable id."))
    byId.set(task.id, task)
    for (const path of [...task.readSet, ...task.writeSet, ...task.exclusiveResources]) {
      const canonical = canonicalPath(path)
      if (!canonical) issues.push(issue("CANONICAL_PATH", task.id, `Path or resource ${path} is not canonical.`, "Use a repository-relative slash-separated path without . or ..."))
      else canonicalPaths.set(path, canonical)
      const comparablePath = canonical ?? path.replaceAll("\\", "/")
      if (GENERATED_PATH.test(comparablePath)) issues.push(issue("GENERATED_PATH", task.id, `Generated path ${path} is not an editable graph target.`, "Replace it with the owning source path."))
      if (FORBIDDEN_PATH.test(comparablePath)) issues.push(issue("FORBIDDEN_PATH", task.id, `Restricted path ${path} requires a separate approved card.`, "Remove it from this plan or create the dedicated card."))
    }
  }
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency)) issues.push(issue("DEPENDENCY_EXISTS", task.id, `Dependency ${dependency} does not exist.`, "Reference an existing task id or remove the dependency."))
      if (dependency === task.id) issues.push(issue("NO_SELF_DEPENDENCY", task.id, "Task depends on itself.", "Remove the self dependency."))
    }
  }
  const { depths, cycles } = dependencyDepth(plan.tasks, byId)
  for (const id of cycles) issues.push(issue("ACYCLIC", id, "Dependency cycle detected.", "Break the cycle and keep dependencies flowing forward."))
  const maxDepth = Math.max(0, ...depths.values())
  if (maxDepth > limits.maxDepth) issues.push(issue("DEPTH", null, `Graph depth ${maxDepth} exceeds ${limits.maxDepth}.`, "Split the graph into smaller waves."))
  if (options.reviewerAvailable === false) issues.push(issue("REVIEWER_AVAILABLE", null, "No reviewer is available for this plan.", "Assign an eligible reviewer before execution."))
  if (options.estimatedTokens !== undefined && options.maxTotalTokens !== undefined && options.estimatedTokens > options.maxTotalTokens) issues.push(issue("BUDGET", null, "Estimated plan usage exceeds its token budget.", "Reduce scope or raise the budget through an explicit gate."))
  if (plan.globalGates.length === 0) issues.push(issue("HUMAN_GATE", null, "Plan has no global gate.", "Declare at least one approval or validation gate."))
  const writers = new Map<string, string[]>()
  for (const task of plan.tasks) for (const path of task.writeSet) { const key = canonicalPaths.get(path) ?? path; writers.set(key, [...(writers.get(key) ?? []), task.id]) }
  for (const [path, taskIds] of writers) if (taskIds.length > limits.maxWritersPerPath) issues.push(issue("HOTSPOT", taskIds[0] ?? null, `Path ${path} is written by ${taskIds.length} tasks.`, "Assign one owning task or split the resource explicitly."))
  for (let left = 0; left < plan.tasks.length; left++) for (let right = left + 1; right < plan.tasks.length; right++) {
    const a = plan.tasks[left]!, b = plan.tasks[right]!
    const aWrites = new Set([...a.writeSet, ...a.exclusiveResources].map((path) => canonicalPaths.get(path) ?? path))
    const bReads = new Set([...b.readSet, ...b.exclusiveResources].map((path) => canonicalPaths.get(path) ?? path))
    const bWrites = new Set([...b.writeSet, ...b.exclusiveResources].map((path) => canonicalPaths.get(path) ?? path))
    const conflict = [...aWrites].some((path) => bWrites.has(path) || bReads.has(path))
    if (conflict && !hasDependencyPath(a.id, b.id, byId) && !hasDependencyPath(b.id, a.id, byId)) issues.push(issue("RESOURCE_ORDER", a.id, `Tasks ${a.id} and ${b.id} have an unordered write/read or write/write conflict.`, "Add an explicit dependency or separate the paths."))
  }
  return { valid: issues.length === 0, issues, maxDepth, canonicalPaths }
}
