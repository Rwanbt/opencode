import { NamedError } from "@unifia/util/error"
import z from "zod"
import type { GraphValidationIssue } from "./graph-validator"
import type { PlannerTask, TaskPlan } from "./task-planner"

const MAX_ATTEMPTS = 2
export const PlanRepairIssueSchema = z.object({ rule: z.string().min(1), nodeId: z.string().min(1).nullable(), message: z.string().min(1), correction: z.string().min(1) }).strict()
export const PlanRepairRequestSchema = z.object({ plan: z.unknown(), issues: z.array(PlanRepairIssueSchema).min(1), attempt: z.number().int().min(1) }).strict()
export type PlanRepairRequest = { readonly plan: TaskPlan; readonly issues: readonly GraphValidationIssue[]; readonly attempt: number }
export interface PlanRepairResult { readonly plan: TaskPlan; readonly changedTaskIds: readonly string[]; readonly attempt: number }

export const PlanRepairBlockedError = NamedError.create("PlanRepairBlockedError", z.object({ attempt: z.number().int().nonnegative(), reason: z.string().min(1) }))

function normalizedPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/\.\//g, "/")
}
function repairTask(task: PlannerTask, rules: readonly GraphValidationIssue[]): PlannerTask {
  let repaired = { ...task, dependsOn: [...task.dependsOn], readSet: [...task.readSet], writeSet: [...task.writeSet], exclusiveResources: [...task.exclusiveResources] }
  for (const finding of rules) {
    if (finding.rule === "DEPENDENCY_EXISTS" || finding.rule === "NO_SELF_DEPENDENCY" || finding.rule === "ACYCLIC") repaired = { ...repaired, dependsOn: repaired.dependsOn.filter((dependency) => dependency !== task.id && dependency !== finding.message.match(/Dependency ([^ ]+)/)?.[1]) }
    if (["CANONICAL_PATH", "GENERATED_PATH", "FORBIDDEN_PATH"].includes(finding.rule)) {
      const clean = (paths: readonly string[]) => paths.map(normalizedPath).filter((path) => !/(^|\/)(dist|build|generated|target|migrations?|secrets?|credentials?)(\/|$)/i.test(path))
      repaired = { ...repaired, readSet: clean(repaired.readSet), writeSet: clean(repaired.writeSet), exclusiveResources: clean(repaired.exclusiveResources) }
    }
  }
  return repaired
}

export function repairPlan(request: PlanRepairRequest): PlanRepairResult {
  if (request.attempt > MAX_ATTEMPTS) throw new PlanRepairBlockedError({ attempt: request.attempt, reason: "Maximum two repair attempts reached; escalate with structured validator issues." })
  const targetedIds = new Set(request.issues.flatMap((finding) => finding.nodeId ? [finding.nodeId] : []))
  if (request.issues.some((finding) => finding.rule === "BUDGET" || finding.rule === "REVIEWER_AVAILABLE" || finding.rule === "HUMAN_GATE")) throw new PlanRepairBlockedError({ attempt: request.attempt, reason: "Issue requires an external decision and cannot be repaired locally." })
  if (targetedIds.size === 0) throw new PlanRepairBlockedError({ attempt: request.attempt, reason: "No target node was identified; refusing whole-plan rewrite." })
  const tasks = request.plan.tasks.map((task) => targetedIds.has(task.id) ? repairTask(task, request.issues.filter((finding) => finding.nodeId === task.id)) : task)
  return { plan: { ...request.plan, tasks }, changedTaskIds: [...targetedIds], attempt: request.attempt }
}
