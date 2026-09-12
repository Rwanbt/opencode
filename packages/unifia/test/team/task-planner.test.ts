import { test, expect, describe } from "bun:test";
import {
  PlannerTaskSchema,
  TaskPlanSchema,
  type PlannerTask,
  type TaskPlan,
} from "../../src/team/task-planner";

function makeValidTask(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: "t-1",
    title: "Implement test",
    objective: "Write a test for the planner module",
    dependsOn: [],
    readSet: ["src/index.ts"],
    writeSet: ["src/test.ts"],
    exclusiveResources: [],
    acceptanceCriteria: ["tests pass"],
    risks: [],
    gates: [],
    ...overrides,
  };
}

function makeValidPlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    schemaVersion: "1.0.0",
    tasks: [makeValidTask()],
    integrationStrategy: "cherry-pick into main branch",
    rollback: "revert the cherry-pick",
    globalRisks: [],
    globalGates: [],
    ...overrides,
  };
}

describe("PlannerTaskSchema: validation", () => {
  test("accepts a valid task", () => {
    const t = makeValidTask();
    expect(PlannerTaskSchema.safeParse(t).success).toBe(true);
  });
  test("rejects empty title", () => {
    expect(PlannerTaskSchema.safeParse(makeValidTask({ title: "" })).success).toBe(false);
  });
  test("rejects empty objective", () => {
    expect(PlannerTaskSchema.safeParse(makeValidTask({ objective: "" })).success).toBe(false);
  });
  test("rejects empty acceptanceCriteria", () => {
    expect(
      PlannerTaskSchema.safeParse(makeValidTask({ acceptanceCriteria: [] })).success,
    ).toBe(false);
  });
  test("rejects taskId not matching kebab-case regex", () => {
    expect(PlannerTaskSchema.safeParse(makeValidTask({ id: "T_BAD" })).success).toBe(false);
    expect(PlannerTaskSchema.safeParse(makeValidTask({ id: "1bad" })).success).toBe(false);
  });
  test("rejects taskId > 64 chars", () => {
    const longId = "a".repeat(65);
    expect(PlannerTaskSchema.safeParse(makeValidTask({ id: longId })).success).toBe(false);
  });
  test("rejects extra fields (strict)", () => {
    const t = { ...makeValidTask(), unknown: "x" };
    expect(PlannerTaskSchema.safeParse(t).success).toBe(false);
  });
});

describe("TaskPlanSchema: validation", () => {
  test("accepts a valid plan", () => {
    const p = makeValidPlan();
    expect(TaskPlanSchema.safeParse(p).success).toBe(true);
  });
  test("rejects empty tasks array", () => {
    expect(TaskPlanSchema.safeParse(makeValidPlan({ tasks: [] })).success).toBe(false);
  });
  test("rejects > 50 tasks", () => {
    const tasks = Array.from({ length: 51 }, (_, i) =>
      makeValidTask({ id: "t-" + i.toString().padStart(3, "0") }),
    );
    expect(TaskPlanSchema.safeParse(makeValidPlan({ tasks })).success).toBe(false);
  });
  test("rejects non-1.0.0 schemaVersion", () => {
    expect(
      TaskPlanSchema.safeParse(makeValidPlan({ schemaVersion: "0.9.0" as never })).success,
    ).toBe(false);
  });
});

describe("PlannerTaskSchema: property check 1000 random tasks", () => {
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
  test("1000 random tasks: 0 violations of strict + regex + non-empty constraints", () => {
    const rng = mulberry32(0xa11ce);
    for (let i = 0; i < 1000; i++) {
      const id = rng() < 0.1 ? "" : "t-" + i.toString(36);
      const titleEmpty = rng() < 0.05;
      const objectiveEmpty = rng() < 0.05;
      const acceptanceEmpty = rng() < 0.05;
      const t = {
        id,
        title: titleEmpty ? "" : "Task " + i,
        objective: objectiveEmpty ? "" : "Do " + i,
        dependsOn: [],
        readSet: [],
        writeSet: [],
        exclusiveResources: [],
        acceptanceCriteria: acceptanceEmpty ? [] : ["done"],
        risks: [],
        gates: [],
      };
      const result = PlannerTaskSchema.safeParse(t).success;
      const expected =
        id.length > 0 &&
        /^[a-z][a-z0-9-]{0,63}$/.test(id) &&
        !titleEmpty &&
        !objectiveEmpty &&
        !acceptanceEmpty;
      if (result !== expected) {
        throw new Error("i=" + i + ": got " + result + " expected " + expected);
      }
    }
  });
});
