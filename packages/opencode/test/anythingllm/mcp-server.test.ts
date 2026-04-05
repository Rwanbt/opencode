import { describe, it, expect } from "bun:test"
import { AnythingLLMMcp } from "../../src/anythingllm/mcp-server"

describe("AnythingLLM MCP server", () => {
  it("exposes 4 tools", () => {
    const tools = AnythingLLMMcp.tools()
    expect(tools).toHaveLength(4)
    const names = tools.map((t) => t.name)
    expect(names).toContain("anythingllm_search")
    expect(names).toContain("anythingllm_list_workspaces")
    expect(names).toContain("anythingllm_get_document")
    expect(names).toContain("anythingllm_chat")
  })

  it("tool definitions have required schema fields", () => {
    const defs = AnythingLLMMcp.toolDefinitions()
    for (const def of defs) {
      expect(def.name).toBeTruthy()
      expect(def.description).toBeTruthy()
      expect(def.inputSchema).toBeTruthy()
      expect(def.inputSchema.type).toBe("object")
    }
  })

  it("search tool requires query parameter", () => {
    const search = AnythingLLMMcp.tools().find((t) => t.name === "anythingllm_search")!
    expect(search.inputSchema.required).toContain("query")
  })

  it("chat tool requires workspace and message", () => {
    const chat = AnythingLLMMcp.tools().find((t) => t.name === "anythingllm_chat")!
    expect(chat.inputSchema.required).toContain("workspace")
    expect(chat.inputSchema.required).toContain("message")
  })

  it("tools return 'not configured' when client not set up", async () => {
    const search = AnythingLLMMcp.tools().find((t) => t.name === "anythingllm_search")!
    const result = await search.execute({ query: "test" })
    expect(result).toContain("not configured")
  })

  it("executeTool throws for unknown tool", async () => {
    try {
      await AnythingLLMMcp.executeTool("nonexistent", {})
      expect(true).toBe(false) // Should not reach here
    } catch (e: any) {
      expect(e.message).toContain("Unknown")
    }
  })
})
