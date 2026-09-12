/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  DESIGN_TOOLS,
  TOOL_CAPABILITY,
  inputComplete,
  requiredCapability,
  validateMcpInput,
  type McpToolName,
} from "../src/design-tools"

const validWorkspace = { workspaceId: "design-app" }

describe("MCP design tools", () => {
  test("the four tools are listed in canonical order", () => {
    expect(DESIGN_TOOLS).toEqual(["search_files", "get_file", "get_artifact", "apply_plugin"])
  })

  test("every tool has a capability assigned", () => {
    for (const tool of DESIGN_TOOLS) {
      expect(requiredCapability(tool)).toBe(TOOL_CAPABILITY[tool])
    }
  })

  test("the three read tools require workspace.read; apply_plugin requires plugin.apply", () => {
    expect(requiredCapability("search_files")).toBe("workspace.read")
    expect(requiredCapability("get_file")).toBe("workspace.read")
    expect(requiredCapability("get_artifact")).toBe("workspace.read")
    expect(requiredCapability("apply_plugin")).toBe("plugin.apply")
  })

  test("validateMcpInput refuses an invalid workspaceId", () => {
    expect(() => validateMcpInput("search_files", { workspaceId: "DesignApp" })).toThrow(/workspaceId is invalid/)
  })

  test("validateMcpInput refuses a tool that is missing its required field", () => {
    expect(() => validateMcpInput("get_file", validWorkspace)).toThrow(/path is required/)
    expect(() => validateMcpInput("get_artifact", validWorkspace)).toThrow(/artifactId is required/)
    expect(() => validateMcpInput("apply_plugin", validWorkspace)).toThrow(/pluginId is required/)
  })

  test("validateMcpInput accepts complete inputs", () => {
    expect(() => validateMcpInput("search_files", validWorkspace)).not.toThrow()
    expect(() => validateMcpInput("get_file", { ...validWorkspace, path: "design/index.html" })).not.toThrow()
    expect(() => validateMcpInput("get_artifact", { ...validWorkspace, artifactId: "art-1" })).not.toThrow()
    expect(() => validateMcpInput("apply_plugin", { ...validWorkspace, pluginId: "linear-export" })).not.toThrow()
  })

  test("inputComplete is the non-throwing sibling of validateMcpInput", () => {
    expect(inputComplete("get_file", validWorkspace)).toBe(false)
    expect(inputComplete("get_file", { ...validWorkspace, path: "x" })).toBe(true)
  })

  test("the workspace id pattern matches the contracts id regex", () => {
    expect(inputComplete("search_files", { workspaceId: "design-app" })).toBe(true)
    expect(inputComplete("search_files", { workspaceId: "ab" })).toBe(false)
    expect(inputComplete("search_files", { workspaceId: "DesignApp" })).toBe(false)
  })
})

describe("DESIGN_TOOLS iteration", () => {
  test("each tool is reachable in the canonical list", () => {
    const names = new Set<McpToolName>(DESIGN_TOOLS)
    expect(names.size).toBe(4)
    expect(names.has("search_files")).toBe(true)
    expect(names.has("get_file")).toBe(true)
    expect(names.has("get_artifact")).toBe(true)
    expect(names.has("apply_plugin")).toBe(true)
  })
})
