/* SPDX-License-Identifier: MIT */

/**
 * P32 — Design-related MCP tools.
 *
 * Four tools expose a slice of the workbench to an MCP client:
 * - `search_files` and `get_file` are read-only and use
 *   `workspace.read`.
 * - `get_artifact` returns the last rendered artifact, with its
 *   manifest, and uses `workspace.read`.
 * - `apply_plugin` is the only mutating tool; it uses
 *   `plugin.apply` and is the same route the workbench app uses.
 *
 * The tool is **loopback only**. LAN exposure requires an
 * environment variable and a separate origins policy, applied by
 * the existing infra — this module does not change that.
 *
 * The tool is **workspace-scoped**. Every call carries the
 * workspace it is allowed to touch; a request outside the
 * workspace is refused and audited.
 */

export type McpToolName = "search_files" | "get_file" | "get_artifact" | "apply_plugin"

export type McpToolInput = {
  workspaceId: string
  /** Optional: pin a sub-path to search or read. */
  prefix?: string
  /** `search_files`: free-form query. */
  query?: string
  /** `get_file`: relative file path. */
  path?: string
  /** `get_artifact`: optional artifact id. */
  artifactId?: string
  /** `apply_plugin`: plugin id. */
  pluginId?: string
}

export type McpToolOutput =
  | { kind: "search"; entries: readonly { path: string; size: number }[] }
  | { kind: "file"; path: string; content: Uint8Array }
  | { kind: "artifact"; id: string; manifest: unknown; content: Uint8Array }
  | { kind: "plugin-applied"; id: string }
  | { kind: "refused"; reason: string }

/** A capability the caller needs to use a given tool. */
export const TOOL_CAPABILITY: Readonly<Record<McpToolName, string>> = {
  search_files: "workspace.read",
  get_file: "workspace.read",
  get_artifact: "workspace.read",
  apply_plugin: "plugin.apply",
}

const WORKSPACE_PATTERN = /^[a-z][a-z0-9-]{2,63}$/

/**
 * Validates the call's input. Throws on:
 * - missing or invalid `workspaceId`
 * - the tool is `get_file` but `path` is missing
 * - the tool is `get_artifact` but `artifactId` is missing
 * - the tool is `apply_plugin` but `pluginId` is missing
 *
 * The function is pure: same input, same output, same error.
 */
export function validateMcpInput(tool: McpToolName, input: McpToolInput): void {
  if (typeof input.workspaceId !== "string" || !WORKSPACE_PATTERN.test(input.workspaceId)) {
    throw new Error(`mcp.${tool}: workspaceId is invalid`)
  }
  if (tool === "get_file" && (typeof input.path !== "string" || input.path.length === 0)) {
    throw new Error(`mcp.${tool}: path is required`)
  }
  if (tool === "get_artifact" && (typeof input.artifactId !== "string" || input.artifactId.length === 0)) {
    throw new Error(`mcp.${tool}: artifactId is required`)
  }
  if (tool === "apply_plugin" && (typeof input.pluginId !== "string" || input.pluginId.length === 0)) {
    throw new Error(`mcp.${tool}: pluginId is required`)
  }
}

/**
 * The list of tools the design module exposes. The order is the
 * canonical order in which an MCP client should list them.
 */
export const DESIGN_TOOLS: readonly McpToolName[] = ["search_files", "get_file", "get_artifact", "apply_plugin"]

/** The capability required to use the tool. Pure. */
export function requiredCapability(tool: McpToolName): string {
  return TOOL_CAPABILITY[tool]
}

/** True when the input carries every field the tool needs. */
export function inputComplete(tool: McpToolName, input: McpToolInput): boolean {
  if (!WORKSPACE_PATTERN.test(input.workspaceId ?? "")) return false
  if (tool === "get_file" && !input.path) return false
  if (tool === "get_artifact" && !input.artifactId) return false
  if (tool === "apply_plugin" && !input.pluginId) return false
  return true
}
