import { describe, it, expect } from "bun:test"
import {
  AnythingLLMWorkspace,
  AnythingLLMDocument,
  AnythingLLMSearchResult,
  AnythingLLMChatMessage,
} from "../../src/anythingllm/types"

describe("AnythingLLM types", () => {
  it("validates workspace schema", () => {
    const valid = AnythingLLMWorkspace.safeParse({
      id: 1,
      name: "Test Workspace",
      slug: "test-workspace",
      vectorTag: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      lastUpdatedAt: "2025-01-01T00:00:00.000Z",
    })
    expect(valid.success).toBe(true)
  })

  it("validates document schema", () => {
    const valid = AnythingLLMDocument.safeParse({
      name: "readme.md",
      docpath: "/docs/readme.md",
      description: "Project readme",
      wordCount: 500,
    })
    expect(valid.success).toBe(true)
  })

  it("validates search result schema", () => {
    const valid = AnythingLLMSearchResult.safeParse({
      text: "This is a relevant section...",
      score: 0.85,
      document: "readme.md",
      metadata: { page: 1 },
    })
    expect(valid.success).toBe(true)
  })

  it("validates chat message schema", () => {
    const valid = AnythingLLMChatMessage.safeParse({
      id: "msg_123",
      type: "assistant",
      textResponse: "Here is the answer...",
      sources: [],
      close: true,
      error: null,
    })
    expect(valid.success).toBe(true)
  })

  it("rejects invalid workspace", () => {
    const invalid = AnythingLLMWorkspace.safeParse({
      id: "not-a-number",
      name: 123,
    })
    expect(invalid.success).toBe(false)
  })
})
