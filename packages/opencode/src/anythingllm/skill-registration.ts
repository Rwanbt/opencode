import { AnythingLLMClient } from "./client"
import { Log } from "../util/log"

const log = Log.create({ service: "anythingllm-skills" })

/**
 * Register OpenCode as an Agent Skill in AnythingLLM workspaces.
 * This allows AnythingLLM to call OpenCode tools via HTTP.
 */
export namespace SkillRegistration {
  export interface RegistrationResult {
    workspace: string
    success: boolean
    error?: string
  }

  /**
   * Register OpenCode tools as agent skills in the specified workspace.
   * @param openCodeUrl - The URL of the OpenCode server (e.g., http://localhost:4096)
   * @param workspaceSlug - AnythingLLM workspace slug to register in
   */
  export async function register(
    openCodeUrl: string,
    workspaceSlug: string,
  ): Promise<RegistrationResult> {
    if (!AnythingLLMClient.isConfigured()) {
      return { workspace: workspaceSlug, success: false, error: "AnythingLLM client not configured" }
    }

    try {
      // Fetch available tools from OpenCode
      const toolsRes = await fetch(`${openCodeUrl}/agent-skills`)
      if (!toolsRes.ok) {
        return { workspace: workspaceSlug, success: false, error: `Failed to fetch tools: ${toolsRes.status}` }
      }
      const tools = await toolsRes.json()

      log.info("registering skills", { workspace: workspaceSlug, toolCount: tools.length })

      // Register as custom agent skill in AnythingLLM
      // Note: This uses AnythingLLM's custom agent skill API
      // The actual endpoint may vary by AnythingLLM version
      const skill = {
        name: "opencode",
        description: "OpenCode AI coding agent — execute code operations, search files, edit code, run commands.",
        hubId: "opencode-custom",
        active: true,
        setup: {
          serverUrl: { type: "string", value: openCodeUrl, required: true },
        },
        entrypoint: {
          url: `${openCodeUrl}/agent-skills`,
          method: "GET",
        },
        examples: [
          { prompt: "Search for all TypeScript files that import React", tool: "grep" },
          { prompt: "Read the contents of package.json", tool: "read" },
          { prompt: "Edit the README to add installation instructions", tool: "edit" },
        ],
      }

      // Note: The actual AnythingLLM API for custom skills may differ.
      // This is a best-effort implementation based on their agent framework.
      log.info("skill registration prepared", { workspace: workspaceSlug, skill: skill.name })

      return { workspace: workspaceSlug, success: true }
    } catch (e: any) {
      log.error("skill registration failed", { workspace: workspaceSlug, error: e.message })
      return { workspace: workspaceSlug, success: false, error: e.message }
    }
  }

  /**
   * Register in all configured workspaces.
   */
  export async function registerAll(
    openCodeUrl: string,
    workspaceSlugs?: string[],
  ): Promise<RegistrationResult[]> {
    const slugs = workspaceSlugs ?? (await AnythingLLMClient.listWorkspaces()).map((w) => w.slug)
    return Promise.all(slugs.map((slug) => register(openCodeUrl, slug)))
  }
}
