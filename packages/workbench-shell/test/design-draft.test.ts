/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "vitest"
import { createDesignDraftRecord, designDraftKey } from "../src/design-draft.js"

describe("versioned design drafts", () => {
  it("uses a workspace-scoped key and explicit schema version", () => {
    const record = createDesignDraftRecord("workspace-1", "{\"id\":\"draft\"}", 3, 100)
    expect(record).toEqual({ key: "workspace-1:design-draft", workspaceId: "workspace-1", schemaVersion: 1, revision: 3, source: "{\"id\":\"draft\"}", updatedAt: 100 })
    expect(designDraftKey("workspace-1")).toBe("workspace-1:design-draft")
  })

  it("rejects an empty workspace key", () => {
    expect(() => designDraftKey(" ")).toThrow("workspace id is required")
  })
})
