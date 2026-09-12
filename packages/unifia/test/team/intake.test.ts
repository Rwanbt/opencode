import { describe, expect, it } from "bun:test"
import { buildTaskRequirements } from "../../src/team/intake"

describe("buildTaskRequirements", () => {
  it("extracts explicit requirements and preserves known constraints", () => {
    const result = buildTaskRequirements({ objective: "Add a bounded task intake. Persist the requirements.", knownConstraints: ["No network access"] })

    expect(result.requirements.map((item) => item.statement)).toEqual(["Add a bounded task intake", "Persist the requirements"])
    expect(result.ambiguities).toHaveLength(0)
    expect(result.externalActions).toHaveLength(0)
    expect(result.frozenConstraints).toEqual([{ id: "CON-1", statement: "No network access", source: "input" }])
  })

  it("turns vague language into questions instead of assumptions", () => {
    const result = buildTaskRequirements({ objective: "Maybe make the planner faster as soon as possible." })

    expect(result.ambiguities).toHaveLength(2)
    expect(result.ambiguities.every((item) => item.resolution === "QUESTION")).toBe(true)
  })

  it("creates human gates for irreversible and external actions", () => {
    const result = buildTaskRequirements({ objective: "Deploy the change and publish the release." })

    expect(result.externalActions.map((action) => action.kind)).toEqual(["publish", "deploy"])
    expect(result.externalActions.every((action) => action.requiresHumanApproval)).toBe(true)
    expect(result.ambiguities.at(-1)?.resolution).toBe("GATE")
    expect(result.frozenConstraints.at(-1)?.source).toBe("safety")
  })

  it("detects actions provided separately from the objective", () => {
    const result = buildTaskRequirements({ objective: "Prepare the report.", irreversibleActions: ["Send an email to the customer"] })

    expect(result.externalActions).toMatchObject([{ kind: "message", requiresHumanApproval: true }])
  })

  it("gates an irreversible action that has no known category", () => {
    const result = buildTaskRequirements({ objective: "Prepare the report.", irreversibleActions: ["Rotate internal token"] })

    expect(result.externalActions).toMatchObject([{ kind: "unknown", requiresHumanApproval: true }])
    expect(result.ambiguities.at(-1)?.resolution).toBe("GATE")
  })

  it("fails closed for an empty objective", () => {
    expect(() => buildTaskRequirements({ objective: "   " })).toThrow(TypeError)
  })
})
