import { Bus } from "../bus"
import { Config } from "../config/config"
import { ShadowDaemon } from "./shadow-daemon"
import { Effect } from "effect"
import { Log } from "../util/log"

const log = Log.create({ service: "shadow-integration" })

let initialized = false

export function initShadowDaemon() {
  if (initialized) return
  initialized = true

  try {
    return initSubscription()
  } catch (e) {
    log.debug("shadow daemon skipped (no instance context)", { error: String(e) })
  }
}

function initSubscription() {
  Bus.subscribe(
    {
      type: "session.status.idle" as any,
      properties: {} as any,
    },
    async (event: any) => {
      try {
        const config = await Config.get()
        const shadowCfg = config.experimental?.collective?.shadow_daemon
        if (!shadowCfg?.enabled) return

        const sessionID = event.properties?.sessionID
        const lastUserMessage = event.properties?.lastUserMessage
        const lastAssistantMessage = event.properties?.lastAssistantMessage

        if (!lastUserMessage || !lastAssistantMessage) return

        await Effect.runPromise(
          ShadowDaemon.analyzeInBackground({
            sessionID: sessionID ?? "unknown",
            question: lastUserMessage,
            primaryResponse: lastAssistantMessage,
            config: {
              enabled: true,
              ollamaHost: shadowCfg.ollama_host,
              modelID: shadowCfg.model,
              divergenceThreshold: shadowCfg.divergence_threshold,
            },
          }),
        )
      } catch (e) {
        log.error("shadow daemon error", { error: String(e) })
      }
    },
  )

  log.info("shadow daemon integration initialized")
}

