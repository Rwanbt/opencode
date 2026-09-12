import { expect, test } from "bun:test"
import { workflowDraftKey } from "../src/workflow-draft.js"

test("workflow drafts are isolated by workspace and definition path", () => {
  expect(workflowDraftKey("workspace-a", ".unifia/workflows/release.json")).toBe("workspace-a:workflow-draft:.unifia/workflows/release.json")
  expect(() => workflowDraftKey("", "workflow.json")).toThrow("workspace id")
})
