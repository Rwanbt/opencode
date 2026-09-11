/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { emptyDraftBudget, emptyDraftTask, parseList, toStartRunPayload, validateDraft, type DraftTask } from "./work-start-run-form"

const task = (overrides: Partial<DraftTask> = {}): DraftTask => ({ ...emptyDraftTask(), ...overrides })

describe("parseList — comma-separated form fields", () => {
  test("trims and drops empty entries", () => {
    expect(parseList(" a, b ,, c ")).toEqual(["a", "b", "c"])
  })
  test("an empty string is an empty list", () => {
    expect(parseList("")).toEqual([])
  })
})

describe("validateDraft — the four server-side rules, reimplemented client-side", () => {
  const valid = task({ id: "t1", description: "d", prompt: "p", agent: "build" })

  test("a well-formed single task is valid", () => {
    expect(validateDraft("objective", [valid])).toEqual([])
  })

  test("an empty description is rejected", () => {
    expect(validateDraft("", [valid])).toContainEqual({ kind: "descriptionRequired" })
  })

  test("no tasks at all is rejected", () => {
    expect(validateDraft("objective", [])).toContainEqual({ kind: "noTasks" })
  })

  test("a task missing a required field is rejected", () => {
    const errors = validateDraft("objective", [task({ id: "t1", description: "", prompt: "p", agent: "build" })])
    expect(errors).toContainEqual({ kind: "missingFields", id: "t1" })
  })

  test("a duplicate task id is rejected", () => {
    const errors = validateDraft("objective", [valid, valid])
    expect(errors).toContainEqual({ kind: "duplicateId", id: "t1" })
  })

  test("a task depending on itself is rejected", () => {
    const errors = validateDraft("objective", [task({ id: "t1", description: "d", prompt: "p", agent: "build", dependsOn: "t1" })])
    expect(errors).toContainEqual({ kind: "selfDependency", id: "t1" })
  })

  test("a dependency on an id that doesn't exist in the draft is rejected", () => {
    const errors = validateDraft("objective", [
      task({ id: "t1", description: "d", prompt: "p", agent: "build", dependsOn: "ghost" }),
    ])
    expect(errors).toContainEqual({ kind: "unknownDependency", id: "t1", dependsOn: "ghost" })
  })

  test("a real dependency cycle is rejected", () => {
    const errors = validateDraft("objective", [
      task({ id: "t1", description: "d", prompt: "p", agent: "build", dependsOn: "t2" }),
      task({ id: "t2", description: "d", prompt: "p", agent: "build", dependsOn: "t1" }),
    ])
    expect(errors).toContainEqual({ kind: "cycle" })
  })

  test("a real, valid dependency chain is not flagged as a cycle", () => {
    const errors = validateDraft("objective", [
      task({ id: "t1", description: "d", prompt: "p", agent: "build" }),
      task({ id: "t2", description: "d", prompt: "p", agent: "build", dependsOn: "t1" }),
    ])
    expect(errors).toEqual([])
  })
})

describe("toStartRunPayload — the exact shape StartRunSchema expects", () => {
  test("drops empty optional fields rather than sending empty arrays/undefined budget", () => {
    const payload = toStartRunPayload("objective", emptyDraftBudget(), [
      task({ id: "t1", description: "d", prompt: "p", agent: "build" }),
    ])
    expect(payload).toEqual({
      description: "objective",
      tasks: [{ id: "t1", description: "d", prompt: "p", agent: "build", mode: "read" }],
    })
  })

  test("includes budget only when at least one field is set, as real numbers", () => {
    const payload = toStartRunPayload("objective", { maxCostUsd: "5", maxTokens: "", maxParallel: "" }, [
      task({ id: "t1", description: "d", prompt: "p", agent: "build" }),
    ])
    expect(payload.budget).toEqual({ maxCostUsd: 5, maxTokens: undefined, maxParallel: undefined })
  })

  test("parses dependsOn/readSet/writeSet into real arrays and keeps risk/modelIndex when set", () => {
    const payload = toStartRunPayload("objective", emptyDraftBudget(), [
      task({
        id: "t2",
        description: "d",
        prompt: "p",
        agent: "build",
        mode: "write",
        risk: "high",
        dependsOn: "t1",
        readSet: "a.ts, b.ts",
        writeSet: "c.ts",
        modelIndex: 1,
      }),
    ])
    expect(payload.tasks[0]).toEqual({
      id: "t2",
      description: "d",
      prompt: "p",
      agent: "build",
      mode: "write",
      risk: "high",
      dependsOn: ["t1"],
      readSet: ["a.ts", "b.ts"],
      writeSet: ["c.ts"],
      modelIndex: 1,
    })
  })
})
