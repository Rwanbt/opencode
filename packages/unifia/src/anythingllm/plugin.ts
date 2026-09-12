import { AnythingLLMClient } from "./client"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create({ service: "anythingllm-plugin" })

/**
 * AnythingLLM integration plugin.
 * Hooks into the system prompt to inject relevant documents from AnythingLLM
 * workspaces as additional context for the LLM.
 */
export const AnythingLLMPlugin = {
  name: "anythingllm",

  async init() {
    try {
      const cfg = await Config.get()
      const allm = cfg?.experimental?.anythingllm
      if (!allm?.enabled) return false

      AnythingLLMClient.configure({
        url: allm.url,
        apiKey: allm.api_key,
      })

      const ok = await AnythingLLMClient.healthCheck()
      if (ok) {
        log.info("connected to AnythingLLM", { url: allm.url })
      } else {
        log.warn("AnythingLLM health check failed", { url: allm.url })
      }
      return ok
    } catch (e) {
      log.warn("AnythingLLM init failed", { error: String(e) })
      return false
    }
  },

  hooks: {
    /**
     * Inject AnythingLLM document context into the system prompt.
     * Queries configured workspaces for documents relevant to the
     * current conversation and appends results to the system prompt.
     */
    async "experimental.chat.system.transform"(
      input: { sessionID: string; model: any },
      output: { system: string[] },
    ) {
      if (!AnythingLLMClient.isConfigured()) return

      try {
        const cfg = await Config.get()
        const allm = cfg?.experimental?.anythingllm
        if (!allm?.inject_context) return

        // Extract the last system message for context
        const context = output.system.join("\n").slice(-500)
        if (!context.trim()) return

        const results = await AnythingLLMClient.searchAll(
          context,
          allm.workspaces,
          3, // Limit to 3 results to avoid prompt bloat
        )

        if (results.length === 0) return

        const formatted = results
          .flatMap((r) =>
            r.results.map(
              (result) =>
                `[${r.workspace}] (score: ${result.score.toFixed(2)}) ${result.text.slice(0, 500)}`,
            ),
          )
          .join("\n\n")

        output.system.push(
          `<anythingllm-context>\nRelevant documents from AnythingLLM:\n${formatted}\n</anythingllm-context>`,
        )

        log.info("injected AnythingLLM context", {
          sessionID: input.sessionID,
          resultCount: results.reduce((sum, r) => sum + r.results.length, 0),
        })
      } catch (e) {
        log.warn("AnythingLLM context injection failed", { error: String(e) })
      }
    },
  },
}
