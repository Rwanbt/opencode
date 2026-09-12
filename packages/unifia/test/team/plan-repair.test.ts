import { test, expect, describe } from "bun:test";
import { repairPlan, PlanRepairBlockedError } from "../../src/team/plan-repair";
import type { GraphValidationIssue } from "../../src/team/graph-validator";
import type { TaskPlan, PlannerTask } from "../../src/team/task-planner";

function makeTask(id: string, overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id,
    title: "Task " + id,
    objective: "Implement " + id,
    dependsOn: [],
    readSet: [],
    writeSet: [],
    exclusiveResources: [],
    acceptanceCriteria: ["done"],
    risks: [],
    gates: [],
    ...overrides,
  };
}

function makePlan(tasks: PlannerTask[]): TaskPlan {
  return {
    schemaVersion: "1.0.0",
    tasks,
    integrationStrategy: "cherry-pick",
    rollback: "revert",
    globalRisks: [],
    globalGates: [],
  };
}

function issue(rule: string, nodeId: string | null = "t-1", message?: string): GraphValidationIssue {
  return { rule, nodeId, message: message ?? "Dependency ghost does not exist", correction: "fix " + rule };
}

describe("plan-repair: contract", () => {
  test("attempt 1 with DEPENDENCY_EXISTS removes the bad dependency", () => {
    const plan = makePlan([
      makeTask("a", { dependsOn: ["ghost"] }),
      makeTask("b"),
    ]);
    const result = repairPlan({
      plan,
      issues: [issue("DEPENDENCY_EXISTS", "a")],
      attempt: 1,
    });
    expect(result.changedTaskIds).toContain("a");
    expect(result.plan.tasks[0]!.dependsOn).not.toContain("ghost");
  });
  test("attempt > MAX_ATTEMPTS throws PlanRepairBlockedError", () => {
    const plan = makePlan([makeTask("a")]);
    expect(() =>
      repairPlan({ plan, issues: [issue("DEPENDENCY_EXISTS")], attempt: 3 }),
    ).toThrow(PlanRepairBlockedError);
  });
  test("BUDGET issue requires external decision, blocked", () => {
    const plan = makePlan([makeTask("a")]);
    expect(() =>
      repairPlan({ plan, issues: [issue("BUDGET")], attempt: 1 }),
    ).toThrow(PlanRepairBlockedError);
  });
  test("REVIEWER_AVAILABLE issue requires external decision, blocked", () => {
    const plan = makePlan([makeTask("a")]);
    expect(() =>
      repairPlan({ plan, issues: [issue("REVIEWER_AVAILABLE")], attempt: 1 }),
    ).toThrow(PlanRepairBlockedError);
  });
  test("HUMAN_GATE issue requires external decision, blocked", () => {
    const plan = makePlan([makeTask("a")]);
    expect(() =>
      repairPlan({ plan, issues: [issue("HUMAN_GATE")], attempt: 1 }),
    ).toThrow(PlanRepairBlockedError);
  });
  test("issues with no nodeId throw PlanRepairBlockedError (refuse whole-plan rewrite)", () => {
    const plan = makePlan([makeTask("a")]);
    expect(() =>
      repairPlan({ plan, issues: [issue("FORBIDDEN_PATH", null)], attempt: 1 }),
    ).toThrow(PlanRepairBlockedError);
  });
  test("FORBIDDEN_PATH in writeSet is cleaned to remove dist/build/generated/migrations/secrets/credentials", () => {
    const plan = makePlan([
      makeTask("a", { writeSet: ["src/foo.ts", "dist/x.js", "migrations/1.sql"] }),
    ]);
    const result = repairPlan({
      plan,
      issues: [issue("FORBIDDEN_PATH", "a")],
      attempt: 1,
    });
    const ws = result.plan.tasks[0]!.writeSet;
    expect(ws).toContain("src/foo.ts");
    expect(ws).not.toContain("dist/x.js");
    expect(ws).not.toContain("migrations/1.sql");
  });
  test("GENERATED_PATH cleanup also removes dist/build/generated/target", () => {
    const plan = makePlan([
      makeTask("a", { writeSet: ["build/x.js", "generated/y.ts", "target/z.js"] }),
    ]);
    const result = repairPlan({
      plan,
      issues: [issue("GENERATED_PATH", "a")],
      attempt: 1,
    });
    const ws = result.plan.tasks[0]!.writeSet;
    expect(ws).toHaveLength(0);
  });
  test("CANONICAL_PATH cleanup normalises backslashes to forward slashes", () => {
    const plan = makePlan([makeTask("a", { writeSet: ["src\\foo\\bar.ts"] })]);
    const result = repairPlan({
      plan,
      issues: [issue("CANONICAL_PATH", "a")],
      attempt: 1,
    });
    expect(result.plan.tasks[0]!.writeSet).toContain("src/foo/bar.ts");
  });
  test("unchanged tasks are not duplicated in changedTaskIds", () => {
    const plan = makePlan([
      makeTask("a"),
      makeTask("b", { dependsOn: ["ghost"] }),
    ]);
    const result = repairPlan({
      plan,
      issues: [issue("DEPENDENCY_EXISTS", "b")],
      attempt: 1,
    });
    expect(result.changedTaskIds).toEqual(["b"]);
  });
  test("mixed issues across tasks only repair targeted tasks", () => {
    const plan = makePlan([
      makeTask("a", { writeSet: ["src/foo.ts"] }),
      makeTask("b", { writeSet: ["dist/x.js"] }),
    ]);
    const result = repairPlan({
      plan,
      issues: [issue("FORBIDDEN_PATH", "b")],
      attempt: 1,
    });
    expect(result.plan.tasks[0]!.writeSet).toContain("src/foo.ts");
    expect(result.plan.tasks[1]!.writeSet).toEqual([]);
  });
});

describe("plan-repair: property check (1000 random repair scenarios)", () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  test("1000 random repairs: blocked issues never silently 'repaired'", () => {
    const rng = mulberry32(0xb10c4ed);
    const BLOCKED = ["BUDGET", "REVIEWER_AVAILABLE", "HUMAN_GATE"];
    for (let i = 0; i < 1000; i++) {
      const plan = makePlan([makeTask("a"), makeTask("b")]);
      const which = BLOCKED[Math.floor(rng() * BLOCKED.length)]!;
      let threw = false;
      try {
        repairPlan({ plan, issues: [issue(which)], attempt: 1 });
      } catch (e) {
        if (e instanceof PlanRepairBlockedError) threw = true;
      }
      if (!threw) {
        throw new Error("i=" + i + ": blocked issue " + which + " was not blocked");
      }
    }
  });
});
