import { describe, expect, test } from "bun:test"
import { summarizeWorkflowSteps } from "./automate-workflow-model"

describe("summarizeWorkflowSteps", () => {
  test("renders the persisted family or capability without inventing a node kind", () => {
    expect(summarizeWorkflowSteps({
      id: "release",
      version: 1,
      steps: [
        { id: "gate", family: "human.approval", requiresApproval: true },
        { id: "publish", capability: "artifact.export" },
        "legacy-invalid-step",
      ],
    })).toEqual([
      { id: "gate", label: "human.approval", requiresApproval: true },
      { id: "publish", label: "artifact.export", requiresApproval: false },
      { id: "step-3", label: "untyped step", requiresApproval: false },
    ])
  })
})
