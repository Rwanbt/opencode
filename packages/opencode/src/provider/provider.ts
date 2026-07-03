import z from "zod"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type Provider as SDK } from "ai"
import { Log } from "../util/log"
import { Npm } from "../npm"
import { Hash } from "../util/hash"
import { Plugin } from "../plugin"
import { NamedError } from "@opencode-ai/util/error"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { ModelsDev } from "./models"
import { Auth } from "../auth"
import { Env } from "../env"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { Global } from "../global"
import path from "node:path"
import { Filesystem } from "../util/filesystem"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"

// Direct imports for bundled providers
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible as createGitHubCopilotOpenAICompatible } from "./sdk/copilot"
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createGateway } from "@ai-sdk/gateway"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createVercel } from "@ai-sdk/vercel"
import { createVenice } from "venice-ai-sdk-provider"
import { createGitLab } from "gitlab-ai-provider"
import { ProviderTransform } from "./transform"
import { ModelID, ProviderID } from "./schema"
import { wrapSSE, e2eURL } from "./helpers"
import {
  buildCustomLoaders,
  type CustomModelLoader,
  type CustomVarsLoader,
  type CustomDiscoverModels,
} from "./loaders"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  type BundledSDK = {
    languageModel(modelId: string): LanguageModelV3
  }

  const BUNDLED_PROVIDERS: Record<string, (options: any) => BundledSDK> = {
    "@ai-sdk/amazon-bedrock": createAmazonBedrock,
    "@ai-sdk/anthropic": createAnthropic,
    "@ai-sdk/azure": createAzure,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/google-vertex": createVertex,
    "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
    "@ai-sdk/openai": createOpenAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@openrouter/ai-sdk-provider": createOpenRouter,
    "@ai-sdk/xai": createXai,
    "@ai-sdk/mistral": createMistral,
    "@ai-sdk/groq": createGroq,
    "@ai-sdk/deepinfra": createDeepInfra,
    "@ai-sdk/cerebras": createCerebras,
    "@ai-sdk/cohere": createCohere,
    "@ai-sdk/gateway": createGateway,
    "@ai-sdk/togetherai": createTogetherAI,
    "@ai-sdk/perplexity": createPerplexity,
    "@ai-sdk/vercel": createVercel,
    "gitlab-ai-provider": createGitLab,
    "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
    "venice-ai-sdk-provider": createVenice,
  }

  export const Model = z
    .object({
      id: ModelID.zod,
      providerID: ProviderID.zod,
      api: z.object({
        id: z.string(),
        url: z.string(),
        npm: z.string(),
      }),
      name: z.string(),
      family: z.string().optional(),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
      release_date: z.string(),
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: ProviderID.zod,
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly list: () => Effect.Effect<Record<ProviderID, Info>>
    readonly getProvider: (providerID: ProviderID) => Effect.Effect<Info>
    readonly getModel: (providerID: ProviderID, modelID: ModelID) => Effect.Effect<Model>
    readonly getLanguage: (model: Model) => Effect.Effect<LanguageModelV3>
    readonly closest: (
      providerID: ProviderID,
      query: string[],
    ) => Effect.Effect<{ providerID: ProviderID; modelID: string } | undefined>
    readonly getSmallModel: (providerID: ProviderID) => Effect.Effect<Model | undefined>
    readonly defaultModel: () => Effect.Effect<{ providerID: ProviderID; modelID: ModelID }>
  }

  interface State {
    models: Map<string, LanguageModelV3>
    providers: Record<ProviderID, Info>
    sdk: Map<string, BundledSDK>
    modelLoaders: Record<string, CustomModelLoader>
    varsLoaders: Record<string, CustomVarsLoader>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Provider") {}

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: ModelID.make(model.id),
      providerID: ProviderID.make(provider.id),
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: model.provider?.api ?? provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
      release_date: model.release_date,
      variants: {},
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: ProviderID.make(provider.id),
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  const layer: Layer.Layer<Service, never, Config.Service | Auth.Service | Plugin.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const auth = yield* Auth.Service
      const plugin = yield* Plugin.Service

      const state = yield* InstanceState.make<State>(() =>
        Effect.gen(function* () {
          using _ = log.time("state")
          const cfg = yield* config.get()
          const modelsDev = yield* Effect.promise(() => ModelsDev.get())
          const database = mapValues(modelsDev, fromModelsDevProvider)

          const providers: Record<ProviderID, Info> = {} as Record<ProviderID, Info>
          const languages = new Map<string, LanguageModelV3>()
          const modelLoaders: {
            [providerID: string]: CustomModelLoader
          } = {}
          const varsLoaders: {
            [providerID: string]: CustomVarsLoader
          } = {}
          const sdk = new Map<string, BundledSDK>()
          const discoveryLoaders: {
            [providerID: string]: CustomDiscoverModels
          } = {}
          const dep = {
            auth: (id: string) => auth.get(id).pipe(Effect.orDie),
            config: () => config.get(),
          }

          log.info("init")

          function mergeProvider(providerID: ProviderID, provider: Partial<Info>) {
            const existing = providers[providerID]
            if (existing) {
              // @ts-expect-error
              providers[providerID] = mergeDeep(existing, provider)
              return
            }
            const match = database[providerID]
            if (!match) {
              log.warn("mergeProvider: provider not in database, skipping", { providerID })
              return
            }
            // @ts-expect-error
            providers[providerID] = mergeDeep(match, provider)
          }

          // load plugins first so config() hook runs before reading cfg.provider
          const plugins = yield* plugin.list()

          // now read config providers - includes any modifications from plugin config() hook
          const configProviders = Object.entries(cfg.provider ?? {})
          const disabled = new Set(cfg.disabled_providers ?? [])
          const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : null

          function isProviderAllowed(providerID: ProviderID): boolean {
            if (enabled && !enabled.has(providerID)) return false
            if (disabled.has(providerID)) return false
            return true
          }

          // extend database from config
          for (const [providerID, provider] of configProviders) {
            const existing = database[providerID]
            const parsed: Info = {
              id: ProviderID.make(providerID),
              name: provider.name ?? existing?.name ?? providerID,
              env: provider.env ?? existing?.env ?? [],
              options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
              source: "config",
              models: existing?.models ?? {},
            }

            for (const [modelID, model] of Object.entries(provider.models ?? {})) {
              const existingModel = parsed.models[model.id ?? modelID]
              const name = iife(() => {
                if (model.name) return model.name
                if (model.id && model.id !== modelID) return modelID
                return existingModel?.name ?? modelID
              })
              const parsedModel: Model = {
                id: ModelID.make(modelID),
                api: {
                  id: model.id ?? existingModel?.api.id ?? modelID,
                  npm:
                    model.provider?.npm ??
                    provider.npm ??
                    existingModel?.api.npm ??
                    modelsDev[providerID]?.npm ??
                    "@ai-sdk/openai-compatible",
                  url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
                },
                status: model.status ?? existingModel?.status ?? "active",
                name,
                providerID: ProviderID.make(providerID),
                capabilities: {
                  temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
                  reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
                  attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
                  toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
                  input: {
                    text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
                    audio:
                      model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
                    image:
                      model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
                    video:
                      model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
                    pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
                  },
                  output: {
                    text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
                    audio:
                      model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
                    image:
                      model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
                    video:
                      model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
                    pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
                  },
                  interleaved: model.interleaved ?? false,
                },
                cost: {
                  input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
                  output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
                  cache: {
                    read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
                    write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
                  },
                },
                options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
                limit: {
                  context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
                  input: model.limit?.input ?? existingModel?.limit?.input,
                  output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
                },
                headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
                family: model.family ?? existingModel?.family ?? "",
                release_date: model.release_date ?? existingModel?.release_date ?? "",
                variants: {},
              }
              const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
              parsedModel.variants = mapValues(
                pickBy(merged, (v) => !v.disabled),
                (v) => omit(v, ["disabled"]),
              )
              parsed.models[modelID] = parsedModel
            }
            database[providerID] = parsed
          }

          // load env
          const env = Env.all()
          for (const [id, provider] of Object.entries(database)) {
            const providerID = ProviderID.make(id)
            if (disabled.has(providerID)) continue
            const apiKey = provider.env.map((item) => env[item]).find(Boolean)
            if (!apiKey) {
              log.debug("provider skipped: no env key found", { providerID, envKeys: provider.env })
              continue
            }
            mergeProvider(providerID, {
              source: "env",
              key: provider.env.length === 1 ? apiKey : undefined,
            })
          }

          // load apikeys
          const auths = yield* auth.all().pipe(Effect.orDie)
          for (const [id, provider] of Object.entries(auths)) {
            const providerID = ProviderID.make(id)
            if (disabled.has(providerID)) continue
            if (provider.type === "api") {
              mergeProvider(providerID, {
                source: "api",
                key: provider.key,
              })
            }
          }

          // plugin auth loader - database now has entries for config providers
          for (const plugin of plugins) {
            if (!plugin.auth) continue
            const providerID = ProviderID.make(plugin.auth.provider)
            if (disabled.has(providerID)) continue

            const stored = yield* auth.get(providerID).pipe(Effect.orDie)
            if (!stored) continue
            if (!plugin.auth.loader) continue

            const options = yield* Effect.promise(() =>
              plugin.auth!.loader!(
                () => Effect.runPromise(auth.get(providerID).pipe(Effect.orDie)) as any,
                database[plugin.auth!.provider],
              ),
            )
            const opts = options ?? {}
            const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
            mergeProvider(providerID, patch)
          }

          for (const [id, fn] of Object.entries(buildCustomLoaders(dep, log))) {
            const providerID = ProviderID.make(id)
            if (disabled.has(providerID)) continue
            const data = database[providerID]
            if (!data) {
              log.error("Provider does not exist in model list " + providerID)
              continue
            }
            const result = yield* fn(data)
            if (result && (result.autoload || providers[providerID])) {
              if (result.getModel) modelLoaders[providerID] = result.getModel
              if (result.vars) varsLoaders[providerID] = result.vars
              if (result.discoverModels) discoveryLoaders[providerID] = result.discoverModels
              const opts = result.options ?? {}
              const patch: Partial<Info> = providers[providerID]
                ? { options: opts }
                : { source: "custom", options: opts }
              mergeProvider(providerID, patch)
            }
          }

          // load config - re-apply with updated data
          for (const [id, provider] of configProviders) {
            const providerID = ProviderID.make(id)
            const partial: Partial<Info> = { source: "config" }
            if (provider.env) partial.env = provider.env
            if (provider.name) partial.name = provider.name
            if (provider.options) partial.options = provider.options
            mergeProvider(providerID, partial)
          }

          const gitlab = ProviderID.make("gitlab")
          if (discoveryLoaders[gitlab] && providers[gitlab] && isProviderAllowed(gitlab)) {
            yield* Effect.promise(async () => {
              try {
                const discovered = await discoveryLoaders[gitlab]()
                for (const [modelID, model] of Object.entries(discovered)) {
                  if (!providers[gitlab].models[modelID]) {
                    providers[gitlab].models[modelID] = model
                  }
                }
              } catch (e) {
                log.warn("state discovery error", { id: "gitlab", error: e })
              }
            })
          }

          for (const hook of plugins) {
            const p = hook.provider
            const models = p?.models
            if (!p || !models) continue

            const providerID = ProviderID.make(p.id)
            if (disabled.has(providerID)) continue

            const provider = providers[providerID]
            if (!provider) continue
            const pluginAuth = yield* auth.get(providerID).pipe(Effect.orDie)

            provider.models = (yield* Effect.promise(async () => {
              const next = await models(provider, { auth: pluginAuth })
              return Object.fromEntries(
                Object.entries(next).map(([id, model]) => [
                  id,
                  {
                    ...model,
                    id: ModelID.make(id),
                    providerID,
                  },
                ]),
              )
            })) as never
          }

          for (const [id, provider] of Object.entries(providers)) {
            const providerID = ProviderID.make(id)
            if (!isProviderAllowed(providerID)) {
              delete providers[providerID]
              continue
            }

            const configProvider = cfg.provider?.[providerID]

            for (const [modelID, model] of Object.entries(provider.models)) {
              model.api.id = model.api.id ?? model.id ?? modelID
              if (
                modelID === "gpt-5-chat-latest" ||
                (providerID === ProviderID.openrouter && modelID === "openai/gpt-5-chat")
              )
                delete provider.models[modelID]
              if (model.status === "alpha" && !Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
              if (model.status === "deprecated") delete provider.models[modelID]
              if (
                (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
                (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
              )
                delete provider.models[modelID]

              model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

              const configVariants = configProvider?.models?.[modelID]?.variants
              if (configVariants && model.variants) {
                const merged = mergeDeep(model.variants, configVariants)
                model.variants = mapValues(
                  pickBy(merged, (v) => !v.disabled),
                  (v) => omit(v, ["disabled"]),
                )
              }
            }

            if (Object.keys(provider.models).length === 0) {
              log.warn("provider removed: zero models after filtering", { providerID })
              delete providers[providerID]
              continue
            }

            log.info("found", { providerID })
          }

          return {
            models: languages,
            providers,
            sdk,
            modelLoaders,
            varsLoaders,
          }
        }),
      )

      // When models.dev refreshes in the background (fire-and-forget timer,
      // no instance context), the provider state cached per-directory is stale.
      // Invalidate all entries so the next access rebuilds with fresh models —
      // this is what makes a provider that was missing at boot (empty fetch)
      // appear once the network fetch completes.
      ModelsDev.onRefresh(() => {
        Effect.runPromise(InstanceState.invalidateAll(state)).catch((e) => {
          log.error("Failed to invalidate provider state after models refresh", { error: e })
        })
      })

      const list = Effect.fn("Provider.list")(() => InstanceState.use(state, (s) => s.providers))

      async function resolveSDK(model: Model, s: State) {
        try {
          using _ = log.time("getSDK", {
            providerID: model.providerID,
          })
          const provider = s.providers[model.providerID]
          const options = { ...provider.options }

          if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
            delete options.fetch
          }

          if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
            options["includeUsage"] = true
          }

          const baseURL = iife(() => {
            let url =
              typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : model.api.url
            if (!url) return

            const loader = s.varsLoaders[model.providerID]
            if (loader) {
              const vars = loader(options)
              for (const [key, value] of Object.entries(vars)) {
                const field = "${" + key + "}"
                url = url.replaceAll(field, value)
              }
            }

            url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
              const val = Env.get(String(key))
              return val ?? item
            })
            return url
          })

          if (baseURL !== undefined) options["baseURL"] = baseURL
          if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
          if (model.headers)
            options["headers"] = {
              ...options["headers"],
              ...model.headers,
            }

          const key = Hash.fast(
            JSON.stringify({
              providerID: model.providerID,
              npm: model.api.npm,
              options,
            }),
          )
          const existing = s.sdk.get(key)
          if (existing) return existing

          const customFetch = options["fetch"]
          const chunkTimeout = options["chunkTimeout"]
          delete options["chunkTimeout"]

          options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
            const fetchFn = customFetch ?? fetch
            const opts = init ?? {}
            const chunkAbortCtl =
              typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
            const signals: AbortSignal[] = []

            if (opts.signal) signals.push(opts.signal)
            if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
            if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
              signals.push(AbortSignal.timeout(options["timeout"]))

            const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
            if (combined) opts.signal = combined

            // Strip openai itemId metadata following what codex does
            if (model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
              const body = JSON.parse(opts.body as string)
              const isAzure = model.providerID.includes("azure")
              const keepIds = isAzure && body.store === true
              if (!keepIds && Array.isArray(body.input)) {
                for (const item of body.input) {
                  if ("id" in item) {
                    delete item.id
                  }
                }
                opts.body = JSON.stringify(body)
              }
            }

            const res = await fetchFn(input, {
              ...opts,
              timeout: false,
            })

            if (!chunkAbortCtl) return res
            return wrapSSE(res, chunkTimeout, chunkAbortCtl)
          }

          const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
          if (bundledFn) {
            log.info("using bundled provider", {
              providerID: model.providerID,
              pkg: model.api.npm,
            })
            const loaded = bundledFn({
              name: model.providerID,
              ...options,
            })
            s.sdk.set(key, loaded)
            return loaded as SDK
          }

          let installedPath: string
          if (!model.api.npm.startsWith("file://")) {
            const item = await Npm.add(model.api.npm)
            if (!item.entrypoint) throw new Error(`Package ${model.api.npm} has no import entrypoint`)
            installedPath = item.entrypoint
          } else {
            log.info("loading local provider", { pkg: model.api.npm })
            installedPath = model.api.npm
          }

          const mod = await import(installedPath)

          const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
          const loaded = fn({
            name: model.providerID,
            ...options,
          })
          s.sdk.set(key, loaded)
          return loaded as SDK
        } catch (e) {
          throw new InitError({ providerID: model.providerID }, { cause: e })
        }
      }

      const getProvider = Effect.fn("Provider.getProvider")((providerID: ProviderID) =>
        InstanceState.use(state, (s) => s.providers[providerID]),
      )

      const getModel = Effect.fn("Provider.getModel")(function* (providerID: ProviderID, modelID: ModelID) {
        const s = yield* InstanceState.get(state)
        const provider = s.providers[providerID]
        if (!provider) {
          const available = Object.keys(s.providers)
          const matches = fuzzysort.go(providerID, available, { limit: 3, threshold: -10000 })
          throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
        }

        const info = provider.models[modelID]
        if (!info) {
          const available = Object.keys(provider.models)
          const matches = fuzzysort.go(modelID, available, { limit: 3, threshold: -10000 })
          throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
        }
        return info
      })

      const getLanguage = Effect.fn("Provider.getLanguage")(function* (model: Model) {
        const s = yield* InstanceState.get(state)
        const key = `${model.providerID}/${model.id}`
        if (s.models.has(key)) return s.models.get(key)!

        return yield* Effect.promise(async () => {
          const url = e2eURL()
          if (url) {
            const language = createOpenAICompatible({
              name: model.providerID,
              apiKey: "test-key",
              baseURL: url,
            }).chatModel(model.api.id)
            s.models.set(key, language)
            return language
          }

          const provider = s.providers[model.providerID]
          const sdk = await resolveSDK(model, s)

          try {
            const language = s.modelLoaders[model.providerID]
              ? await s.modelLoaders[model.providerID](sdk, model.api.id, {
                  ...provider.options,
                  ...model.options,
                })
              : sdk.languageModel(model.api.id)
            s.models.set(key, language)
            return language
          } catch (e) {
            if (e instanceof NoSuchModelError)
              throw new ModelNotFoundError(
                {
                  modelID: model.id,
                  providerID: model.providerID,
                },
                { cause: e },
              )
            throw e
          }
        })
      })

      const closest = Effect.fn("Provider.closest")(function* (providerID: ProviderID, query: string[]) {
        const s = yield* InstanceState.get(state)
        const provider = s.providers[providerID]
        if (!provider) return undefined
        for (const item of query) {
          for (const modelID of Object.keys(provider.models)) {
            if (modelID.includes(item)) return { providerID, modelID }
          }
        }
        return undefined
      })

      const getSmallModel = Effect.fn("Provider.getSmallModel")(function* (providerID: ProviderID) {
        const cfg = yield* config.get()

        if (cfg.small_model) {
          const parsed = parseModel(cfg.small_model)
          return yield* getModel(parsed.providerID, parsed.modelID)
        }

        const s = yield* InstanceState.get(state)
        const provider = s.providers[providerID]
        if (!provider) return undefined

        let priority = [
          "claude-haiku-4-5",
          "claude-haiku-4.5",
          "3-5-haiku",
          "3.5-haiku",
          "gemini-3-flash",
          "gemini-2.5-flash",
          "gpt-5-nano",
        ]
        if (providerID.startsWith("opencode")) {
          priority = ["gpt-5-nano"]
        }
        if (providerID.startsWith("github-copilot")) {
          priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
        }
        for (const item of priority) {
          if (providerID === ProviderID.amazonBedrock) {
            const crossRegionPrefixes = ["global.", "us.", "eu."]
            const candidates = Object.keys(provider.models).filter((m) => m.includes(item))

            const globalMatch = candidates.find((m) => m.startsWith("global."))
            if (globalMatch) return yield* getModel(providerID, ModelID.make(globalMatch))

            const region = provider.options?.region
            if (region) {
              const regionPrefix = region.split("-")[0]
              if (regionPrefix === "us" || regionPrefix === "eu") {
                const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
                if (regionalMatch) return yield* getModel(providerID, ModelID.make(regionalMatch))
              }
            }

            const unprefixed = candidates.find((m) => !crossRegionPrefixes.some((p) => m.startsWith(p)))
            if (unprefixed) return yield* getModel(providerID, ModelID.make(unprefixed))
          } else {
            for (const model of Object.keys(provider.models)) {
              if (model.includes(item)) return yield* getModel(providerID, ModelID.make(model))
            }
          }
        }

        return undefined
      })

      const defaultModel = Effect.fn("Provider.defaultModel")(function* () {
        const cfg = yield* config.get()
        if (cfg.model) return parseModel(cfg.model)

        const s = yield* InstanceState.get(state)
        const recent = yield* Effect.promise(() =>
          Filesystem.readJson<{
            recent?: { providerID: ProviderID; modelID: ModelID }[]
          }>(path.join(Global.Path.state, "model.json"))
            .then((x): { providerID: ProviderID; modelID: ModelID }[] => (Array.isArray(x.recent) ? x.recent : []))
            .catch((): { providerID: ProviderID; modelID: ModelID }[] => []),
        )
        for (const entry of recent) {
          const provider = s.providers[entry.providerID]
          if (!provider) continue
          if (!provider.models[entry.modelID]) continue
          return { providerID: entry.providerID, modelID: entry.modelID }
        }

        const provider = Object.values(s.providers).find(
          (p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id),
        )
        if (!provider) throw new Error("no providers found")
        const [model] = sort(Object.values(provider.models))
        if (!model) throw new Error("no models found")
        return {
          providerID: provider.id,
          modelID: model.id,
        }
      })

      return Service.of({ list, getProvider, getModel, getLanguage, closest, getSmallModel, defaultModel })
    }),
  )

  export const defaultLayer = Layer.suspend(() =>
    layer.pipe(
      Layer.provide(Config.defaultLayer),
      Layer.provide(Auth.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function list() {
    return runPromise((svc) => svc.list())
  }

  export async function getProvider(providerID: ProviderID) {
    return runPromise((svc) => svc.getProvider(providerID))
  }

  export async function getModel(providerID: ProviderID, modelID: ModelID) {
    return runPromise((svc) => svc.getModel(providerID, modelID))
  }

  export async function getLanguage(model: Model) {
    return runPromise((svc) => svc.getLanguage(model))
  }

  export async function closest(providerID: ProviderID, query: string[]) {
    return runPromise((svc) => svc.closest(providerID, query))
  }

  export async function getSmallModel(providerID: ProviderID) {
    return runPromise((svc) => svc.getSmallModel(providerID))
  }

  export async function defaultModel() {
    return runPromise((svc) => svc.defaultModel())
  }

  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
  export function sort<T extends { id: string }>(models: T[]) {
    return sortBy(
      models,
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: ProviderID.make(providerID),
      modelID: ModelID.make(rest.join("/")),
    }
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: ProviderID.zod,
    }),
  )
}
