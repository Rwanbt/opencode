import { describe, expect, test } from "bun:test"
import { publishedDraftPath, summarizeWorkflowSteps } from "./automate-workflow-model"

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

test("publishes a draft under a new immutable workflow file path", () => {
  expect(publishedDraftPath(".unifia/workflows/release.json", new Date("2026-09-12T08:30:45.123Z"))).toBe(".unifia/workflows/release.draft-20260912083045123.json")
})
