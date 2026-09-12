import { describe, expect, test } from "bun:test";
import {
  collectDescendants,
  measureDrift,
  ReplanInputError,
  Replanner,
  type ReplanRequest,
} from "../../src/team/replanner";
import type { PlannerTask, TaskPlan } from "../../src/team/task-planner";

function task(id: string, overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id,
    title: `Task ${id}`,
    objective: `Do ${id}`,
    dependsOn: [],
    readSet: [],
    writeSet: [`src/${id}.ts`],
    exclusiveResources: [],
    acceptanceCriteria: [`${id} works`],
    risks: [],
    gates: [],
    ...overrides,
  };
}

/** a -> b -> c, with d independent. */
function plan(tasks: readonly PlannerTask[] = defaultTasks()): TaskPlan {
  return {
    schemaVersion: "1.0.0",
    tasks: [...tasks],
    integrationStrategy: "sequential cherry-pick",
    rollback: "revert and revoke the lease",
    globalRisks: [],
    globalGates: ["T8"],
  };
}

function defaultTasks(): PlannerTask[] {
  return [task("a"), task("b", { dependsOn: ["a"] }), task("c", { dependsOn: ["b"] }), task("d")];
}

function request(overrides: Partial<ReplanRequest> = {}): ReplanRequest {
  return {
    plan: plan(),
    completedTaskIds: [],
    trigger: { kind: "TASK_FAILED", invalidatedTaskIds: ["b"], reason: "b failed validation" },
    ...overrides,
  };
}

const replanner = new Replanner();

describe("collectDescendants", () => {
  test("includes the roots and everything downstream", () => {
    expect(collectDescendants(defaultTasks(), ["a"])).toEqual(["a", "b", "c"]);
    expect(collectDescendants(defaultTasks(), ["b"])).toEqual(["b", "c"]);
    expect(collectDescendants(defaultTasks(), ["c"])).toEqual(["c"]);
  });

  test("does not reach siblings that merely share an ancestor", () => {
    expect(collectDescendants(defaultTasks(), ["d"])).toEqual(["d"]);
  });

  test("terminates on a dependency cycle instead of recursing forever", () => {
    // Cycle detection belongs to E03; this module must stay usable on a plan
    // that failed validation.
    const cyclic = [task("x", { dependsOn: ["y"] }), task("y", { dependsOn: ["x"] })];

    expect(collectDescendants(cyclic, ["x"])).toEqual(["x", "y"]);
  });
});

describe("Replanner — acceptance: no gratuitous full replan", () => {
  test("a local trigger reaches only the invalidated node and its descendants", () => {
    const result = replanner.replan(request());

    expect(result.scope).toBe("LOCAL");
    expect(result.revalidateTaskIds).toEqual(["b", "c"]);
    // "a" and "d" are untouched: nothing depends on the failure through them.
    expect(result.revalidateTaskIds).not.toContain("a");
    expect(result.revalidateTaskIds).not.toContain("d");
  });

  test("a leaf failure reaches only itself", () => {
    const result = replanner.replan(
      request({ trigger: { kind: "TASK_FAILED", invalidatedTaskIds: ["c"], reason: "c failed" } }),
    );

    expect(result.revalidateTaskIds).toEqual(["c"]);
  });

  test("only a plan-level trigger escalates to GLOBAL", () => {
    for (const kind of ["TASK_FAILED", "TASK_BLOCKED", "VALIDATOR_ISSUE"] as const) {
      const result = replanner.replan(
        request({ trigger: { kind, invalidatedTaskIds: ["c"], reason: "x" } }),
      );
      expect(result.scope).toBe("LOCAL");
    }
    for (const kind of [
      "INTEGRATION_STRATEGY_CHANGED",
      "GLOBAL_GATE_CHANGED",
      "ROLLBACK_STRATEGY_CHANGED",
    ] as const) {
      const result = replanner.replan(request({ trigger: { kind, invalidatedTaskIds: [], reason: "x" } }));
      expect(result.scope).toBe("GLOBAL");
    }
  });

  test("a global trigger still spares completed tasks", () => {
    const result = replanner.replan(
      request({
        completedTaskIds: ["a"],
        trigger: { kind: "GLOBAL_GATE_CHANGED", invalidatedTaskIds: [], reason: "gate T8 changed" },
      }),
    );

    expect(result.scope).toBe("GLOBAL");
    expect(result.revalidateTaskIds).toEqual(["b", "c", "d"]);
    expect(result.preservedTaskIds).toEqual(["a"]);
  });

  test("a completed descendant is not scheduled for revalidation", () => {
    const result = replanner.replan(request({ completedTaskIds: ["c"] }));

    expect(result.revalidateTaskIds).toEqual(["b"]);
  });
});

describe("Replanner — acceptance: completed tasks are preserved", () => {
  test("refuses a proposal that modifies a completed task", () => {
    const proposed = plan([
      task("a", { objective: "Do a differently" }),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["b"] }),
      task("d"),
    ]);
    const result = replanner.replan(request({ completedTaskIds: ["a"], proposedPlan: proposed }));

    expect(result.outcome).toBe("STOP");
    expect(result.refusal).toBe("COMPLETED_TASK_MUTATED");
  });

  test("refuses a proposal that drops a completed task", () => {
    const proposed = plan([task("b", { dependsOn: [] }), task("c", { dependsOn: ["b"] }), task("d")]);
    const result = replanner.replan(request({ completedTaskIds: ["a"], proposedPlan: proposed }));

    expect(result.outcome).toBe("STOP");
    expect(result.refusal).toBe("COMPLETED_TASK_REMOVED");
  });

  test("accepts a proposal that rewrites only unfinished tasks", () => {
    const proposed = plan([
      task("a"),
      task("b", { dependsOn: ["a"], objective: "Do b another way" }),
      task("c", { dependsOn: ["b"] }),
      task("d"),
    ]);
    const result = replanner.replan(request({ completedTaskIds: ["a"], proposedPlan: proposed }));

    expect(result.outcome).toBe("REPLAN");
    expect(result.refusal).toBeNull();
  });

  test("checks preservation before scope growth, so a rewritten record is never merely gated", () => {
    // The proposal both mutates a completed task and adds one. Mutation is
    // unrecoverable, so it must win over the recoverable gate.
    const proposed = plan([
      task("a", { objective: "rewritten" }),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["b"] }),
      task("d"),
      task("e"),
    ]);
    const result = replanner.replan(request({ completedTaskIds: ["a"], proposedPlan: proposed }));

    expect(result.outcome).toBe("STOP");
    expect(result.refusal).toBe("COMPLETED_TASK_MUTATED");
  });
});

describe("Replanner — acceptance: scope growth needs a human gate", () => {
  test("gates an added task rather than accepting it", () => {
    const proposed = plan([...defaultTasks(), task("e")]);
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("HUMAN_GATE_REQUIRED");
    expect(result.scopeGrowth).toEqual([
      { kind: "TASK_ADDED", taskId: "e", detail: "task e does not exist in the current plan" },
    ]);
  });

  test("gates a widened write set", () => {
    const proposed = plan([
      task("a"),
      task("b", { dependsOn: ["a"], writeSet: ["src/b.ts", "src/elsewhere.ts"] }),
      task("c", { dependsOn: ["b"] }),
      task("d"),
    ]);
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("HUMAN_GATE_REQUIRED");
    expect(result.scopeGrowth[0]!.kind).toBe("WRITE_SET_WIDENED");
    expect(result.scopeGrowth[0]!.detail).toContain("src/elsewhere.ts");
  });

  test("gates a newly claimed exclusive resource", () => {
    const proposed = plan([
      task("a"),
      task("b", { dependsOn: ["a"], exclusiveResources: ["db/migrations"] }),
      task("c", { dependsOn: ["b"] }),
      task("d"),
    ]);
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("HUMAN_GATE_REQUIRED");
    expect(result.scopeGrowth[0]!.kind).toBe("EXCLUSIVE_RESOURCE_ADDED");
  });

  test("gates a changed integration strategy", () => {
    // These are the very fields that make an invalidation GLOBAL. Letting a
    // proposal rewrite them unnoticed would contradict the classification.
    const proposed: TaskPlan = { ...plan(), integrationStrategy: "big-bang merge" };
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("HUMAN_GATE_REQUIRED");
    expect(result.scopeGrowth[0]!.kind).toBe("INTEGRATION_STRATEGY_CHANGED");
    expect(result.scopeGrowth[0]!.taskId).toBeNull();
  });

  test("gates a changed rollback strategy", () => {
    const proposed: TaskPlan = { ...plan(), rollback: "none" };
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("HUMAN_GATE_REQUIRED");
    expect(result.scopeGrowth[0]!.kind).toBe("ROLLBACK_STRATEGY_CHANGED");
  });

  test("gates a removed global gate rather than silently dropping a safety gate", () => {
    const proposed: TaskPlan = { ...plan(), globalGates: [] };
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("HUMAN_GATE_REQUIRED");
    expect(result.scopeGrowth[0]!.kind).toBe("GLOBAL_GATE_REMOVED");
    expect(result.scopeGrowth[0]!.detail).toContain("T8");
  });

  test("gates an added global gate too, since the plan's commitments changed", () => {
    const proposed: TaskPlan = { ...plan(), globalGates: ["T8", "T9"] };
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("HUMAN_GATE_REQUIRED");
    expect(result.scopeGrowth[0]!.kind).toBe("GLOBAL_GATE_ADDED");
  });

  test("does not gate a narrowed write set", () => {
    // Shrinking scope is always safe; only growth needs authorisation.
    const proposed = plan([
      task("a"),
      task("b", { dependsOn: ["a"], writeSet: [] }),
      task("c", { dependsOn: ["b"] }),
      task("d"),
    ]);
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("REPLAN");
    expect(result.scopeGrowth).toEqual([]);
  });

  test("does not gate a removed task", () => {
    const proposed = plan([task("a"), task("b", { dependsOn: ["a"] }), task("d")]);
    const result = replanner.replan(request({ proposedPlan: proposed }));

    expect(result.outcome).toBe("REPLAN");
    expect(result.drift.removedTasks).toBe(1);
  });
});

describe("Replanner — acceptance: plan drift is measured", () => {
  test("reports zero drift when nothing is proposed", () => {
    const result = replanner.replan(request());

    expect(result.drift.addedTasks).toBe(0);
    expect(result.drift.modifiedTasks).toBe(0);
    expect(result.drift.removedTasks).toBe(0);
    expect(result.drift.changedRatio).toBe(0);
  });

  test("counts additions, removals and modifications separately", () => {
    const proposed = plan([
      task("a"),
      task("b", { dependsOn: ["a"], objective: "changed" }),
      task("e"),
    ]);
    const drift = measureDrift(plan(), proposed, [], []);

    expect(drift.addedTasks).toBe(1);
    expect(drift.modifiedTasks).toBe(1);
    expect(drift.removedTasks).toBe(2); // c and d dropped
  });

  test("excludes completed tasks from the denominator", () => {
    // 4 tasks, 3 completed, 1 eligible and modified -> ratio 1, not 0.25.
    const proposed = plan([
      task("a"),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["b"] }),
      task("d", { objective: "changed" }),
    ]);
    const drift = measureDrift(plan(), proposed, ["a", "b", "c"], []);

    expect(drift.preservedTasks).toBe(3);
    expect(drift.modifiedTasks).toBe(1);
    expect(drift.changedRatio).toBe(1);
  });

  test("reports a ratio of 0 when every task is already completed", () => {
    const drift = measureDrift(plan(), plan(), ["a", "b", "c", "d"], []);

    expect(drift.changedRatio).toBe(0);
  });
});

describe("Replanner — acceptance: checkpoint", () => {
  test("carries the frozen and revalidate sets as the resume contract", () => {
    const result = replanner.replan(request({ completedTaskIds: ["a"] }));

    expect(result.checkpoint.triggerKind).toBe("TASK_FAILED");
    expect(result.checkpoint.scope).toBe("LOCAL");
    expect(result.checkpoint.preservedTaskIds).toEqual(["a"]);
    expect(result.checkpoint.revalidateTaskIds).toEqual(result.revalidateTaskIds);
  });

  test("is emitted on a refusal too, so a stop is still resumable", () => {
    const proposed = plan([task("a", { objective: "rewritten" }), task("b", { dependsOn: ["a"] })]);
    const result = replanner.replan(request({ completedTaskIds: ["a"], proposedPlan: proposed }));

    expect(result.outcome).toBe("STOP");
    expect(result.checkpoint.preservedTaskIds).toEqual(["a"]);
  });
});

describe("Replanner — input integrity", () => {
  test("rejects a task-level trigger that names no task", () => {
    // An empty task-level trigger is a malformed report, not an empty result.
    expect(() =>
      replanner.replan(request({ trigger: { kind: "TASK_FAILED", invalidatedTaskIds: [], reason: "x" } })),
    ).toThrow(ReplanInputError);
  });

  test("rejects an invalidated task that does not exist", () => {
    expect(() =>
      replanner.replan(request({ trigger: { kind: "TASK_FAILED", invalidatedTaskIds: ["ghost"], reason: "x" } })),
    ).toThrow(ReplanInputError);
  });

  test("rejects a completed task that does not exist", () => {
    expect(() => replanner.replan(request({ completedTaskIds: ["ghost"] }))).toThrow(ReplanInputError);
  });

  test("rejects duplicate task ids, which would defeat the preservation check", () => {
    // Indexing keeps the last occurrence, so a proposal listing a completed
    // task twice — once rewritten, once intact — would compare against the
    // intact copy and pass.
    const sneaky = plan([task("a", { objective: "REWRITTEN" }), task("a"), task("b", { dependsOn: ["a"] })]);

    expect(() => replanner.replan(request({ completedTaskIds: ["a"], proposedPlan: sneaky }))).toThrow(
      ReplanInputError,
    );
    expect(() => replanner.replan(request({ plan: sneaky }))).toThrow(ReplanInputError);
  });

  test("rejects an empty plan and an empty reason", () => {
    expect(() => replanner.replan(request({ plan: plan([]) }))).toThrow(ReplanInputError);
    expect(() =>
      replanner.replan(request({ trigger: { kind: "TASK_FAILED", invalidatedTaskIds: ["b"], reason: "  " } })),
    ).toThrow(ReplanInputError);
  });
});

describe("Replanner — determinism", () => {
  test("produces an identical result for identical input", () => {
    const input = request({ completedTaskIds: ["a"] });

    expect(replanner.replan(input)).toEqual(replanner.replan(input));
  });

  test("is independent of the order of completed and invalidated ids", () => {
    const forward = replanner.replan(
      request({
        completedTaskIds: ["a", "d"],
        trigger: { kind: "TASK_FAILED", invalidatedTaskIds: ["b", "c"], reason: "x" },
      }),
    );
    const reversed = replanner.replan(
      request({
        completedTaskIds: ["d", "a"],
        trigger: { kind: "TASK_FAILED", invalidatedTaskIds: ["c", "b"], reason: "x" },
      }),
    );

    expect(reversed).toEqual(forward);
  });

  test("deduplicates repeated completed ids", () => {
    const result = replanner.replan(request({ completedTaskIds: ["a", "a", "a"] }));

    expect(result.preservedTaskIds).toEqual(["a"]);
    expect(result.drift.preservedTasks).toBe(1);
  });
});
