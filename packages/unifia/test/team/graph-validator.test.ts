import { test, expect, describe } from "bun:test";
import { validateGraph, type GraphValidationOptions } from "../../src/team/graph-validator";
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
    globalGates: ["approve before merge"],
  };
}

describe("graph-validator: validation", () => {
  test("accepts an empty-dependency DAG", () => {
    const plan = makePlan([makeTask("a"), makeTask("b"), makeTask("c")]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
  test("accepts a linear chain a -> b -> c", () => {
    const plan = makePlan([
      makeTask("a"),
      makeTask("b", { dependsOn: ["a"] }),
      makeTask("c", { dependsOn: ["b"] }),
    ]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(true);
  });
  test("rejects a self-dependency", () => {
    const plan = makePlan([makeTask("a", { dependsOn: ["a"] })]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
    const found = result.issues.find((i) => i.rule === "NO_SELF_DEPENDENCY");
    expect(found).toBeDefined();
  });
  test("rejects a cycle a -> b -> a", () => {
    const plan = makePlan([
      makeTask("a", { dependsOn: ["b"] }),
      makeTask("b", { dependsOn: ["a"] }),
    ]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "ACYCLIC")).toBe(true);
  });
  test("rejects a 3-cycle a -> b -> c -> a", () => {
    const plan = makePlan([
      makeTask("a", { dependsOn: ["c"] }),
      makeTask("b", { dependsOn: ["a"] }),
      makeTask("c", { dependsOn: ["b"] }),
    ]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "ACYCLIC")).toBe(true);
  });
  test("rejects a dependency on a missing task", () => {
    const plan = makePlan([makeTask("a", { dependsOn: ["ghost"] })]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "DEPENDENCY_EXISTS")).toBe(true);
  });
  test("rejects more than maxTasks tasks", () => {
    const tasks = Array.from({ length: 51 }, (_, i) => makeTask("t-" + i));
    const plan = makePlan(tasks);
    const result = validateGraph(plan, { maxTasks: 50 });
    expect(result.valid).toBe(false);
  });
  test("rejects depth > maxDepth", () => {
    const tasks: PlannerTask[] = [];
    for (let i = 0; i < 25; i++) {
      tasks.push(makeTask("t-" + i, { dependsOn: i > 0 ? ["t-" + (i - 1)] : [] }));
    }
    const plan = makePlan(tasks);
    const result = validateGraph(plan, { maxDepth: 20 });
    expect(result.valid).toBe(false);
  });
  test("rejects forbidden path in writeSet (e.g. migrations/)", () => {
    const plan = makePlan([
      makeTask("a", { writeSet: ["migrations/001.sql"] }),
    ]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "FORBIDDEN_PATH")).toBe(true);
  });
  test("rejects generated path in writeSet (e.g. dist/x.js)", () => {
    const plan = makePlan([
      makeTask("a", { writeSet: ["dist/x.js"] }),
    ]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "GENERATED_PATH")).toBe(true);
  });
  test("canonical path normalisation: backslashes -> forward slashes", () => {
    const plan = makePlan([
      makeTask("a", { writeSet: ["src\\foo\\bar.ts"] }),
    ]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(true);
    for (const issue of result.issues) {
      expect(issue.correction).not.toContain("\\");
    }
  });
  test("canonical path rejection: absolute path", () => {
    const plan = makePlan([makeTask("a", { writeSet: ["/abs/path.ts"] })]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
  });
  test("canonical path rejection: Windows drive letter", () => {
    const plan = makePlan([makeTask("a", { writeSet: ["C:/abs.ts"] })]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
  });
  test("canonical path rejection: parent traversal", () => {
    const plan = makePlan([makeTask("a", { writeSet: ["../escape.ts"] })]);
    const result = validateGraph(plan, {});
    expect(result.valid).toBe(false);
  });
  test("rejects too many writers per path (maxWritersPerPath)", () => {
    const plan = makePlan([
      makeTask("a", { writeSet: ["src/shared.ts"] }),
      makeTask("b", { writeSet: ["src/shared.ts"] }),
      makeTask("c", { writeSet: ["src/shared.ts"] }),
      makeTask("d", { writeSet: ["src/shared.ts"] }),
    ]);
    const result = validateGraph(plan, { maxWritersPerPath: 3 });
    expect(result.valid).toBe(false);
  });
});

describe("graph-validator: property check (2000 random DAGs)", () => {
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
  test("random DAGs with no cycles validate as valid; with injected cycle, invalid", () => {
    const rng = mulberry32(0xd06f1e1d);
    let acyclic = 0;
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(rng() * 10);
      const tasks: PlannerTask[] = [];
      for (let j = 0; j < n; j++) {
        const numDeps = Math.floor(rng() * j); // deps only on earlier tasks => acyclic
        const deps: string[] = [];
        for (let k = 0; k < numDeps; k++) {
          const idx = Math.floor(rng() * j);
          const depId = "t-" + idx;
          if (!deps.includes(depId) && depId !== "t-" + j) deps.push(depId);
        }
        tasks.push(makeTask("t-" + j, { dependsOn: deps }));
      }
      const result = validateGraph(makePlan(tasks), {});
      if (result.valid) acyclic++;
      else {
        throw new Error("i=" + i + ": random acyclic DAG rejected: " + JSON.stringify(result.issues));
      }
    }
    expect(acyclic).toBe(2000);
  });
});
