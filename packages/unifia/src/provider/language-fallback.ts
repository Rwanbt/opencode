import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Config } from "@/config/config"
import { ModelID, ProviderID } from "@/provider/schema"
import { SessionID } from "@/session/schema"
import { TeamSelectionStore, orderTeamModels } from "@/team/selection"
import { Log } from "@/util/log"
import { Provider } from "./provider"
import {
  isTeamFallbackEligible,
  resolveFallbackDirection,
  withStreamingFallback,
  withStreamingFallbackChain,
} from "./fallback"

const log = Log.create({ service: "provider.language-fallback" })

interface LanguageFallbackInput {
  readonly primary: LanguageModelV3
  readonly providerID: ProviderID
  readonly modelID: ModelID
  readonly sessionID: string
  readonly agent: string
}

export async function resolveLanguageFallback(input: LanguageFallbackInput): Promise<LanguageModelV3> {
  const sessionID = SessionID.make(input.sessionID)
  const selection =
    input.agent === "team"
      ? await TeamSelectionStore.snapshot(sessionID)
      : await TeamSelectionStore.getSession(sessionID)

  if (selection) {
    const refs = orderTeamModels(selection, { providerID: input.providerID, modelID: input.modelID }).filter(
      (model) => model.providerID !== input.providerID || model.modelID !== input.modelID,
    )
    const fallbacks = await Promise.all(
      refs.map(async (model) => {
        try {
          return await Provider.getLanguageByID(ProviderID.make(model.providerID), ModelID.make(model.modelID))
        } catch (error) {
          log.warn("selected Team model could not be loaded", {
            providerID: model.providerID,
            modelID: model.modelID,
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        }
      }),
    )
    const models = [input.primary, ...fallbacks.filter((model): model is LanguageModelV3 => model !== undefined)]
    if (models.length > 1) {
      log.info("Team fallback chain armed", {
        sessionID: input.sessionID,
        models: models.map((model) => `${model.provider}/${model.modelId}`),
      })
      return withStreamingFallbackChain(models, {
        label: `Team session ${input.sessionID}`,
        shouldFallback: isTeamFallbackEligible,
      })
    }
    return input.primary
  }

  const direction = await resolveFallbackDirection()
  if (!direction) return input.primary
  const primaryIsLocal = input.providerID === "local-llm"
  const wanted = (direction === "local" && !primaryIsLocal) || (direction === "cloud" && primaryIsLocal)
  if (!wanted) return input.primary
  const secondary = await resolveSecondary(direction, input.providerID)
  if (!secondary) return input.primary
  log.info("provider fallback armed", { direction, providerID: input.providerID })
  return withStreamingFallback(input.primary, secondary, { label: `${input.providerID} -> ${direction}` })
}

async function resolveSecondary(
  direction: "local" | "cloud",
  primaryProviderID: string,
): Promise<LanguageModelV3 | undefined> {
  if (direction === "local") {
    const provider = await Provider.getProvider(ProviderID.make("local-llm")).catch(() => undefined)
    const modelID = Object.keys(provider?.models ?? {})[0]
    if (!modelID) return undefined
    return Provider.getLanguageByID(ProviderID.make("local-llm"), ModelID.make(modelID)).catch(() => undefined)
  }

  const providers = await Provider.list().catch(() => undefined)
  if (!providers) return undefined
  const cfg = await Config.get().catch(() => undefined)
  const overrideRaw = cfg?.experimental?.provider?.fallback_cloud_providerID
  const override = overrideRaw ? ProviderID.make(overrideRaw) : undefined
  if (override && override !== primaryProviderID) {
    const provider = providers[override]
    const modelID = Object.keys(provider?.models ?? {})[0]
    if (modelID) {
      const language = await Provider.getLanguageByID(override, ModelID.make(modelID)).catch(
        () => undefined,
      )
      if (language) return language
    }
    log.warn("configured cloud fallback is unavailable", { providerID: override })
  }

  for (const [providerID, provider] of Object.entries(providers)) {
    if (providerID === primaryProviderID || providerID === "local-llm") continue
    const modelID = Object.keys(provider.models ?? {})[0]
    if (!modelID) continue
    const language = await Provider.getLanguageByID(ProviderID.make(providerID), ModelID.make(modelID)).catch(
      () => undefined,
    )
    if (language) return language
  }
  return undefined
}
