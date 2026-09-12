import type { PlannerTask, TaskPlan } from "./task-planner";

// =============================================================================
// replanner.ts — TEAM-I03
//
// Decides how much of a DAG has to change when something invalidates part of
// it, and refuses to change more than that.
//
// The default failure mode of a replanner is to throw the plan away and
// regenerate it: cheap to implement, and it destroys every completed task's
// provenance while making the run unauditable. So the question this module
// answers is not "what is the new plan" — E02's planner owns that — but
// "how far does the damage actually reach, and is anyone allowed to widen
// it".
//
//   Local vs global      An invalidation is LOCAL when it reaches only the
//                        transitive descendants of the invalidated nodes.
//                        It is GLOBAL only when it touches plan-level
//                        commitments (integration strategy, rollback, global
//                        gates) — those are shared by every task, so nothing
//                        smaller than the whole plan can absorb the change.
//
//   Completed preserved  A completed task is history. The replanner refuses
//                        a proposal that modifies or drops one rather than
//                        quietly rewriting the record.
//
//   Scope growth gated   Adding tasks or widening a write set is scope
//                        growth. It may be legitimate, but it is not a
//                        decision a replanner gets to make on its own, so it
//                        returns a human gate instead of proceeding.
//
//   Drift measured       Every decision carries a drift metric, so "we
//                        replanned a bit" is a number someone can audit
//                        rather than a claim.
//
// Pure: no LLM, network, git, clock or filesystem access.
// =============================================================================

export const REPLANNER_SCHEMA_VERSION = "1.0.0" as const;

export class ReplanInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ReplanInputError";
  }
}

// -----------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------

/** What went wrong. Plan-level kinds force a GLOBAL classification. */
export type ReplanTriggerKind =
  | "TASK_FAILED"
  | "TASK_BLOCKED"
  | "VALIDATOR_ISSUE"
  | "INTEGRATION_STRATEGY_CHANGED"
  | "GLOBAL_GATE_CHANGED"
  | "ROLLBACK_STRATEGY_CHANGED";

const PLAN_LEVEL_TRIGGERS: ReadonlySet<ReplanTriggerKind> = new Set([
  "INTEGRATION_STRATEGY_CHANGED",
  "GLOBAL_GATE_CHANGED",
  "ROLLBACK_STRATEGY_CHANGED",
]);

export interface ReplanTrigger {
  readonly kind: ReplanTriggerKind;
  /** Tasks directly invalidated. Empty is only valid for plan-level triggers. */
  readonly invalidatedTaskIds: readonly string[];
  readonly reason: string;
}

export interface ReplanRequest {
  readonly plan: TaskPlan;
  /** Tasks already finished; their records must survive untouched. */
  readonly completedTaskIds: readonly string[];
  readonly trigger: ReplanTrigger;
  /** Optional replacement to validate. Absent = ask only for the blast radius. */
  readonly proposedPlan?: TaskPlan;
}

// -----------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------

export type InvalidationScope = "LOCAL" | "GLOBAL";

export type ReplanOutcome = "REPLAN" | "HUMAN_GATE_REQUIRED" | "STOP";

export type ReplanRefusal =
  | "COMPLETED_TASK_MUTATED"
  | "COMPLETED_TASK_REMOVED"
  | "NOTHING_INVALIDATED"
  | "UNKNOWN_TASK_INVALIDATED";

export type ScopeGrowthKind =
  | "TASK_ADDED"
  | "WRITE_SET_WIDENED"
  | "EXCLUSIVE_RESOURCE_ADDED"
  | "INTEGRATION_STRATEGY_CHANGED"
  | "ROLLBACK_STRATEGY_CHANGED"
  | "GLOBAL_GATE_REMOVED"
  | "GLOBAL_GATE_ADDED";

export interface ScopeGrowth {
  readonly kind: ScopeGrowthKind;
  /** `null` for a plan-level commitment, which belongs to no single task. */
  readonly taskId: string | null;
  readonly detail: string;
}

/**
 * How far the proposal moves the plan. `changedRatio` is over the tasks that
 * were *eligible* to change (total minus completed): counting frozen tasks in
 * the denominator would make any replan look small on a mostly-finished plan.
 */
export interface PlanDrift {
  readonly totalTasks: number;
  readonly preservedTasks: number;
  readonly revalidatedTasks: number;
  readonly addedTasks: number;
  readonly removedTasks: number;
  readonly modifiedTasks: number;
  readonly changedRatio: number;
}

export interface ReplanCheckpoint {
  readonly schemaVersion: typeof REPLANNER_SCHEMA_VERSION;
  readonly triggerKind: ReplanTriggerKind;
  readonly scope: InvalidationScope;
  /** Tasks frozen at checkpoint time — the resume point's contract. */
  readonly preservedTaskIds: readonly string[];
  /** Tasks a resumed run must revalidate before trusting them. */
  readonly revalidateTaskIds: readonly string[];
}

export interface ReplanResult {
  readonly schemaVersion: typeof REPLANNER_SCHEMA_VERSION;
  readonly outcome: ReplanOutcome;
  readonly scope: InvalidationScope;
  readonly reason: string;
  /** Completed tasks, which the replan must not touch. */
  readonly preservedTaskIds: readonly string[];
  /** Invalidated tasks plus their transitive descendants. */
  readonly revalidateTaskIds: readonly string[];
  readonly drift: PlanDrift;
  readonly checkpoint: ReplanCheckpoint;
  readonly scopeGrowth: readonly ScopeGrowth[];
  readonly refusal: ReplanRefusal | null;
}

// -----------------------------------------------------------------------
// Graph helpers
// -----------------------------------------------------------------------

function indexById(tasks: readonly PlannerTask[]): ReadonlyMap<string, PlannerTask> {
  return new Map(tasks.map((task) => [task.id, task] as const));
}

/**
 * Every task reachable downstream of `roots`, roots included.
 *
 * Iterative with a visited set rather than recursive: a plan that still
 * contains a dependency cycle must not blow the stack here — detecting
 * cycles is E03's job, and this module has to stay usable on a plan that
 * failed validation.
 */
export function collectDescendants(tasks: readonly PlannerTask[], roots: readonly string[]): readonly string[] {
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      const existing = dependents.get(dependency);
      if (existing) existing.push(task.id);
      else dependents.set(dependency, [task.id]);
    }
  }

  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of dependents.get(current) ?? []) {
      if (!seen.has(child)) queue.push(child);
    }
  }
  return [...seen].sort();
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const other = new Set(right);
  return left.every((value) => other.has(value));
}

/** Fields whose change means the task itself was rewritten, not merely re-run. */
function isModified(before: PlannerTask, after: PlannerTask): boolean {
  return (
    before.title !== after.title ||
    before.objective !== after.objective ||
    !sameSet(before.dependsOn, after.dependsOn) ||
    !sameSet(before.readSet, after.readSet) ||
    !sameSet(before.writeSet, after.writeSet) ||
    !sameSet(before.exclusiveResources, after.exclusiveResources) ||
    !sameSet(before.acceptanceCriteria, after.acceptanceCriteria)
  );
}

function widened(before: readonly string[], after: readonly string[]): readonly string[] {
  const known = new Set(before);
  return after.filter((entry) => !known.has(entry));
}

// -----------------------------------------------------------------------
// Replanner
// -----------------------------------------------------------------------

export class Replanner {
  /**
   * Classify an invalidation and, when a replacement plan is supplied,
   * check it against the preservation rules.
   *
   * Returns a result rather than throwing for every expected outcome — a
   * refusal and a human gate are both normal and must be recorded.
   * Malformed input still throws.
   */
  replan(request: ReplanRequest): ReplanResult {
    validateRequest(request);

    const { plan, trigger } = request;
    const completed = [...new Set(request.completedTaskIds)].sort();
    const planLevel = PLAN_LEVEL_TRIGGERS.has(trigger.kind);
    const scope: InvalidationScope = planLevel ? "GLOBAL" : "LOCAL";

    // A global trigger reaches every task that has not already completed;
    // a local one reaches only the invalidated nodes and what depends on them.
    const completedSet = new Set(completed);
    const revalidate = planLevel
      ? plan.tasks.map((task) => task.id).filter((id) => !completedSet.has(id)).sort()
      : collectDescendants(plan.tasks, trigger.invalidatedTaskIds).filter((id) => !completedSet.has(id));

    const base = {
      schemaVersion: REPLANNER_SCHEMA_VERSION,
      scope,
      preservedTaskIds: completed,
      revalidateTaskIds: revalidate,
    } as const;

    const checkpoint: ReplanCheckpoint = {
      schemaVersion: REPLANNER_SCHEMA_VERSION,
      triggerKind: trigger.kind,
      scope,
      preservedTaskIds: completed,
      revalidateTaskIds: revalidate,
    };

    // No proposal: the caller only wants the blast radius.
    if (request.proposedPlan === undefined) {
      return {
        ...base,
        outcome: "REPLAN",
        reason: planLevel
          ? `plan-level trigger ${trigger.kind} invalidates every unfinished task`
          : `local trigger ${trigger.kind} reaches ${revalidate.length} task(s)`,
        drift: measureDrift(plan, plan, completed, revalidate),
        checkpoint,
        scopeGrowth: [],
        refusal: null,
      };
    }

    const proposed = request.proposedPlan;
    const before = indexById(plan.tasks);
    const after = indexById(proposed.tasks);

    // Completed tasks are history. Check this before anything else: a
    // proposal that rewrites the record is refused whatever else it does.
    for (const id of completed) {
      const original = before.get(id);
      if (original === undefined) continue;
      const replacement = after.get(id);
      if (replacement === undefined) {
        return {
          ...base,
          outcome: "STOP",
          reason: `completed task ${id} is missing from the proposed plan`,
          drift: measureDrift(plan, proposed, completed, revalidate),
          checkpoint,
          scopeGrowth: [],
          refusal: "COMPLETED_TASK_REMOVED",
        };
      }
      if (isModified(original, replacement)) {
        return {
          ...base,
          outcome: "STOP",
          reason: `completed task ${id} was modified by the proposed plan`,
          drift: measureDrift(plan, proposed, completed, revalidate),
          checkpoint,
          scopeGrowth: [],
          refusal: "COMPLETED_TASK_MUTATED",
        };
      }
    }

    const scopeGrowth = [
      ...detectPlanCommitmentChanges(plan, proposed),
      ...detectScopeGrowth(before, proposed.tasks),
    ];
    const drift = measureDrift(plan, proposed, completed, revalidate);

    if (scopeGrowth.length > 0) {
      return {
        ...base,
        outcome: "HUMAN_GATE_REQUIRED",
        reason: `the proposal grows scope in ${scopeGrowth.length} place(s); a replanner may not widen scope on its own`,
        drift,
        checkpoint,
        scopeGrowth,
        refusal: null,
      };
    }

    return {
      ...base,
      outcome: "REPLAN",
      reason: `proposal preserves ${completed.length} completed task(s) and stays within the existing scope`,
      drift,
      checkpoint,
      scopeGrowth: [],
      refusal: null,
    };
  }
}

// -----------------------------------------------------------------------
// Scope growth and drift
// -----------------------------------------------------------------------

/**
 * Changes to the commitments the whole plan shares.
 *
 * These are the very fields that make an invalidation GLOBAL when a trigger
 * touches them, so letting a *proposal* rewrite them unnoticed would
 * contradict the module's own classification: a proposal could swap the
 * integration strategy, or drop a global gate outright, and still be
 * reported as an in-scope local replan.
 */
function detectPlanCommitmentChanges(current: TaskPlan, proposed: TaskPlan): readonly ScopeGrowth[] {
  const changes: ScopeGrowth[] = [];

  if (current.integrationStrategy !== proposed.integrationStrategy) {
    changes.push({
      kind: "INTEGRATION_STRATEGY_CHANGED",
      taskId: null,
      detail: `integration strategy changed from "${current.integrationStrategy}" to "${proposed.integrationStrategy}"`,
    });
  }
  if (current.rollback !== proposed.rollback) {
    changes.push({
      kind: "ROLLBACK_STRATEGY_CHANGED",
      taskId: null,
      detail: `rollback strategy changed from "${current.rollback}" to "${proposed.rollback}"`,
    });
  }

  const proposedGates = new Set(proposed.globalGates);
  const currentGates = new Set(current.globalGates);
  for (const gate of current.globalGates) {
    if (!proposedGates.has(gate)) {
      changes.push({ kind: "GLOBAL_GATE_REMOVED", taskId: null, detail: `global gate ${gate} was removed` });
    }
  }
  for (const gate of proposed.globalGates) {
    if (!currentGates.has(gate)) {
      changes.push({ kind: "GLOBAL_GATE_ADDED", taskId: null, detail: `global gate ${gate} was added` });
    }
  }
  return changes;
}

function detectScopeGrowth(
  before: ReadonlyMap<string, PlannerTask>,
  proposedTasks: readonly PlannerTask[],
): readonly ScopeGrowth[] {
  const growth: ScopeGrowth[] = [];
  for (const task of proposedTasks) {
    const original = before.get(task.id);
    if (original === undefined) {
      growth.push({ kind: "TASK_ADDED", taskId: task.id, detail: `task ${task.id} does not exist in the current plan` });
      continue;
    }
    const newWrites = widened(original.writeSet, task.writeSet);
    if (newWrites.length > 0) {
      growth.push({
        kind: "WRITE_SET_WIDENED",
        taskId: task.id,
        detail: `writes ${newWrites.join(", ")} were not in the task's original write set`,
      });
    }
    const newResources = widened(original.exclusiveResources, task.exclusiveResources);
    if (newResources.length > 0) {
      growth.push({
        kind: "EXCLUSIVE_RESOURCE_ADDED",
        taskId: task.id,
        detail: `exclusive resources ${newResources.join(", ")} were not previously claimed`,
      });
    }
  }
  return growth;
}

export function measureDrift(
  plan: TaskPlan,
  proposed: TaskPlan,
  completedTaskIds: readonly string[],
  revalidateTaskIds: readonly string[],
): PlanDrift {
  const before = indexById(plan.tasks);
  const after = indexById(proposed.tasks);
  const completed = new Set(completedTaskIds);

  let added = 0;
  let modified = 0;
  for (const task of proposed.tasks) {
    const original = before.get(task.id);
    if (original === undefined) added++;
    else if (isModified(original, task)) modified++;
  }
  const removed = plan.tasks.filter((task) => !after.has(task.id)).length;

  // Completed tasks are frozen, so they were never candidates for change.
  // Including them would make any replan look small on a nearly finished plan.
  const eligible = plan.tasks.filter((task) => !completed.has(task.id)).length;
  const changed = added + modified + removed;

  return {
    totalTasks: plan.tasks.length,
    preservedTasks: completed.size,
    revalidatedTasks: revalidateTaskIds.length,
    addedTasks: added,
    removedTasks: removed,
    modifiedTasks: modified,
    changedRatio: eligible === 0 ? 0 : changed / eligible,
  };
}

// -----------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------

/**
 * Duplicate ids would silently defeat the preservation check: indexing keeps
 * the last occurrence, so a proposal listing a completed task twice — once
 * rewritten, once intact — would compare against the intact copy and pass.
 */
function assertUniqueTaskIds(plan: TaskPlan, label: string): void {
  const seen = new Set<string>();
  for (const task of plan.tasks) {
    if (seen.has(task.id)) throw new ReplanInputError(`${label} contains duplicate task id ${task.id}`);
    seen.add(task.id);
  }
}

function validateRequest(request: ReplanRequest): void {
  if (request.plan.tasks.length === 0) throw new ReplanInputError("plan must contain at least one task");
  if (!request.trigger.reason.trim()) throw new ReplanInputError("trigger reason must not be empty");
  assertUniqueTaskIds(request.plan, "plan");
  if (request.proposedPlan !== undefined) assertUniqueTaskIds(request.proposedPlan, "proposedPlan");

  const known = new Set(request.plan.tasks.map((task) => task.id));
  for (const id of request.completedTaskIds) {
    if (!known.has(id)) throw new ReplanInputError(`completed task ${id} does not exist in the plan`);
  }

  const planLevel = PLAN_LEVEL_TRIGGERS.has(request.trigger.kind);
  if (!planLevel && request.trigger.invalidatedTaskIds.length === 0) {
    // Silently treating this as "nothing to do" would hide a caller bug: a
    // task-level trigger that names no task is a malformed report, not an
    // empty result.
    throw new ReplanInputError(`trigger ${request.trigger.kind} must name at least one invalidated task`);
  }
  for (const id of request.trigger.invalidatedTaskIds) {
    if (!known.has(id)) throw new ReplanInputError(`invalidated task ${id} does not exist in the plan`);
  }
}
