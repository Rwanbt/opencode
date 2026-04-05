import { AnythingLLMClient } from "./client"
import { Log } from "../util/log"

const log = Log.create({ service: "anythingllm-mcp" })

/**
 * MCP server adapter that exposes AnythingLLM capabilities as MCP tools.
 * Can be registered as a local MCP server in OpenCode's MCP configuration.
 *
 * Tools:
 * - anythingllm_search: Semantic search across workspaces
 * - anythingllm_list_workspaces: List available workspaces
 * - anythingllm_get_document: Retrieve document content
 * - anythingllm_chat: Chat with a workspace
 */
export namespace AnythingLLMMcp {
  export interface ToolDefinition {
    name: string
    description: string
    inputSchema: Record<string, any>
    execute: (args: Record<string, any>) => Promise<string>
  }

  export function tools(): ToolDefinition[] {
    return [
      {
        name: "anythingllm_search",
        description: "Search for relevant documents across AnythingLLM workspaces using semantic search.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            workspace: { type: "string", description: "Workspace slug (optional, searches all if omitted)" },
            topK: { type: "number", description: "Number of results (default: 5)" },
          },
          required: ["query"],
        },
        async execute(args) {
          if (!AnythingLLMClient.isConfigured()) return "AnythingLLM is not configured."
          const results = args.workspace
            ? await AnythingLLMClient.search(args.workspace, args.query, args.topK ?? 5)
            : (await AnythingLLMClient.searchAll(args.query, undefined, args.topK ?? 5)).flatMap((r) => r.results)

          if (results.length === 0) return "No results found."
          return results.map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(2)}) ${r.text.slice(0, 500)}`).join("\n\n")
        },
      },
      {
        name: "anythingllm_list_workspaces",
        description: "List all available AnythingLLM workspaces.",
        inputSchema: { type: "object", properties: {} },
        async execute() {
          if (!AnythingLLMClient.isConfigured()) return "AnythingLLM is not configured."
          const workspaces = await AnythingLLMClient.listWorkspaces()
          return workspaces.map((w) => `- ${w.name} (slug: ${w.slug})`).join("\n")
        },
      },
      {
        name: "anythingllm_get_document",
        description: "List documents in an AnythingLLM workspace.",
        inputSchema: {
          type: "object",
          properties: {
            workspace: { type: "string", description: "Workspace slug" },
          },
          required: ["workspace"],
        },
        async execute(args) {
          if (!AnythingLLMClient.isConfigured()) return "AnythingLLM is not configured."
          const docs = await AnythingLLMClient.getDocuments(args.workspace)
          if (docs.length === 0) return "No documents in this workspace."
          return docs.map((d) => `- ${d.name} (${d.wordCount ?? "?"} words) ${d.description ?? ""}`).join("\n")
        },
      },
      {
        name: "anythingllm_chat",
        description: "Ask a question to an AnythingLLM workspace. The workspace will search its documents and answer.",
        inputSchema: {
          type: "object",
          properties: {
            workspace: { type: "string", description: "Workspace slug" },
            message: { type: "string", description: "Question to ask" },
          },
          required: ["workspace", "message"],
        },
        async execute(args) {
          if (!AnythingLLMClient.isConfigured()) return "AnythingLLM is not configured."
          const response = await AnythingLLMClient.chat(args.workspace, args.message)
          if (response.error) return `Error: ${response.error}`
          return response.textResponse
        },
      },
    ]
  }

  /** Get tool definitions formatted for MCP server registration */
  export function toolDefinitions() {
    return tools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
  }

  /** Execute an MCP tool by name */
  export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
    const tool = tools().find((t) => t.name === name)
    if (!tool) throw new Error(`Unknown AnythingLLM MCP tool: ${name}`)
    return tool.execute(args)
  }
}
