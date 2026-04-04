import { describe, expect, test } from "bun:test"

// Test the MCP agent filtering logic extracted from mcp/index.ts
// Pure function test - no side effects needed

interface McpScope {
  allow?: string[]
  deny?: string[]
}

type Tool = { name: string }

// Simulate the sanitize function from mcp/index.ts
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

// Extracted filtering logic from MCP.toolsForAgent
function filterToolsForAgent(
  allTools: Record<string, Tool>,
  connectedNames: string[],
  scope?: McpScope,
): Record<string, Tool> {
  if (!scope) return allTools
  if (!scope.allow && !scope.deny) return allTools

  let allowedServers: Set<string>
  if (scope.allow) {
    allowedServers = new Set(scope.allow)
  } else {
    allowedServers = new Set(connectedNames)
  }
  if (scope.deny) {
    for (const denied of scope.deny) {
      allowedServers.delete(denied)
    }
  }

  const filtered: Record<string, Tool> = {}
  for (const [key, tool] of Object.entries(allTools)) {
    const isAllowed = connectedNames.some(
      (serverName) => allowedServers.has(serverName) && key.startsWith(sanitize(serverName) + "_"),
    )
    if (isAllowed) {
      filtered[key] = tool
    }
  }
  return filtered
}

describe("MCP agent tool filtering", () => {
  const connectedNames = ["github", "slack", "linear"]
  const allTools: Record<string, Tool> = {
    github_list_prs: { name: "list_prs" },
    github_create_issue: { name: "create_issue" },
    slack_send_message: { name: "send_message" },
    slack_list_channels: { name: "list_channels" },
    linear_create_ticket: { name: "create_ticket" },
  }

  describe("no scope", () => {
    test("returns all tools when scope is undefined", () => {
      const result = filterToolsForAgent(allTools, connectedNames, undefined)
      expect(Object.keys(result).length).toBe(5)
    })

    test("returns all tools when scope has no allow/deny", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {})
      expect(Object.keys(result).length).toBe(5)
    })
  })

  describe("allow list", () => {
    test("only allows specified servers", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        allow: ["github"],
      })
      expect(Object.keys(result)).toEqual(["github_list_prs", "github_create_issue"])
    })

    test("allows multiple servers", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        allow: ["github", "linear"],
      })
      expect(Object.keys(result).length).toBe(3)
      expect(result).toHaveProperty("github_list_prs")
      expect(result).toHaveProperty("linear_create_ticket")
      expect(result).not.toHaveProperty("slack_send_message")
    })

    test("empty allow list blocks all tools", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        allow: [],
      })
      expect(Object.keys(result).length).toBe(0)
    })

    test("allow list with non-existent server returns nothing for that server", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        allow: ["nonexistent"],
      })
      expect(Object.keys(result).length).toBe(0)
    })
  })

  describe("deny list", () => {
    test("blocks specified servers, allows rest", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        deny: ["slack"],
      })
      expect(Object.keys(result).length).toBe(3)
      expect(result).toHaveProperty("github_list_prs")
      expect(result).toHaveProperty("linear_create_ticket")
      expect(result).not.toHaveProperty("slack_send_message")
    })

    test("blocks multiple servers", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        deny: ["slack", "linear"],
      })
      expect(Object.keys(result).length).toBe(2)
      expect(Object.keys(result)).toEqual(["github_list_prs", "github_create_issue"])
    })

    test("deny all blocks everything", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        deny: ["github", "slack", "linear"],
      })
      expect(Object.keys(result).length).toBe(0)
    })
  })

  describe("allow + deny combined", () => {
    test("deny overrides allow", () => {
      const result = filterToolsForAgent(allTools, connectedNames, {
        allow: ["github", "slack"],
        deny: ["slack"],
      })
      expect(Object.keys(result).length).toBe(2)
      expect(result).toHaveProperty("github_list_prs")
      expect(result).not.toHaveProperty("slack_send_message")
    })
  })

  describe("special characters in server names", () => {
    test("handles server names with special characters", () => {
      const specialTools: Record<string, Tool> = {
        "my-server_tool_one": { name: "tool_one" },
        "my-server_tool_two": { name: "tool_two" },
      }
      const result = filterToolsForAgent(specialTools, ["my-server"], {
        allow: ["my-server"],
      })
      expect(Object.keys(result).length).toBe(2)
    })
  })
})
