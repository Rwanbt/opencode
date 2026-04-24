import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { LocalLLMServer } from "@/local-llm-server"
import { Cause, Effect, Layer, Record, ServiceMap } from "effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool, tool, jsonSchema } from "ai"
import { mergeDeep, pipe } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { resolveFallbackDirection, withStreamingFallback } from "@/provider/fallback"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import * as DLP from "../security/dlp"
import { Flag } from "@/flag/flag"
import { Permission } from "@/permission"
import { Auth } from "@/auth"
import { Installation } from "@/installation"
import { Token } from "@/util/token"

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v) },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e) },
    )
  })
}

export namespace LLM {
  const log = Log.create({ service: "llm" })
  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

  /** Max reasoning/thinking tokens by model family.
   *  Qwen-Thinking and DeepSeek-R1 can emit very long reasoning chains
   *  on complex problems — capping too low silently truncates them.
   *
   *  Keep this list short and conservative. Add families here as we
   *  observe truncation in production. */
  function getThinkingCap(modelID: string): number {
    const id = modelID.toLowerCase()
    if (id.includes("qwen") && id.includes("thinking")) return 8192
    if (id.includes("deepseek") && (id.includes("r1") || id.includes("thinking"))) return 8192
    if (id.includes("gemma") && id.includes("thinking")) return 6144
    if (id.includes("qwen") || id.includes("qwq")) return 4096
    return 2048 // safe default — doubled from previous 1024
  }

  /**
   * Queries the running llama-server /props endpoint to compute adaptive token limits.
   *
   * All values are derived from the ACTUAL n_ctx reported by llama-server after it
   * applied --fit (VRAM-aware auto-adjustment). No model-specific or device-specific
   * constants — everything scales with the real context window.
   *
   *   n_ctx          = real context after VRAM fit (e.g. 16 384, 32 768, 131 072…)
   *   max_tokens     = 40 % of n_ctx  → total tokens allowed for output (thinking + reply)
   *                    capped by model.limit.output so user config is always respected
   *   reasoning_budget = 15 % of max_tokens, clamped to [128, getThinkingCap(model)]
   *
   * Falls back to (null) on any error — callers use model defaults in that case.
   */
  async function getLocalLLMAdaptiveLimits(
    baseURL: string,
    model: Provider.Model,
  ): Promise<{ maxTokens: number; reasoningBudget: number } | null> {
    try {
      // Derive props URL from baseURL (strip trailing /v1 or /v1/)
      const propsUrl = baseURL.replace(/\/v1\/?$/, "") + "/props"
      const resp = await fetch(propsUrl, { signal: AbortSignal.timeout(1500) })
      if (!resp.ok) return null
      const data = await resp.json() as { default_generation_settings?: { n_ctx?: number } }
      const nCtx = data.default_generation_settings?.n_ctx ?? 0
      if (!nCtx) return null

      // 40 % of context for output, bounded by model's declared output limit
      const modelOutputMax = ProviderTransform.maxOutputTokens(model)
      const maxTokens = Math.min(Math.floor(nCtx * 0.4), modelOutputMax)

      // 10 % of output budget for thinking, clamped to [128, 1024]
      // — enough for meaningful reasoning without starving the response
      const cap = getThinkingCap(model.id)
      const reasoningBudget = Math.min(Math.max(128, Math.floor(maxTokens * 0.15)), cap)

      log.info("local-llm adaptive limits", { nCtx, maxTokens, reasoningBudget })
      return { maxTokens, reasoningBudget }
    } catch (e) {
      log.error("getLocalLLMAdaptiveLimits failed", { error: String(e) })
      return null
    }
  }

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    parentSessionID?: string
    model: Provider.Model
    agent: Agent.Info
    permission?: Permission.Ruleset
    system: string[]
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
  }

  export type StreamRequest = StreamInput & {
    abort: AbortSignal
  }

  export type Event = Awaited<ReturnType<typeof stream>>["fullStream"] extends AsyncIterable<infer T> ? T : never

  export interface Interface {
    readonly stream: (input: StreamInput) => Stream.Stream<Event, unknown>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/LLM") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      return Service.of({
        stream(input) {
          return Stream.scoped(
            Stream.unwrap(
              Effect.gen(function* () {
                const ctrl = yield* Effect.acquireRelease(
                  Effect.sync(() => new AbortController()),
                  (ctrl) => Effect.sync(() => ctrl.abort()),
                )

                const result = yield* Effect.promise(() => LLM.stream({ ...input, abort: ctrl.signal }))

                return Stream.fromAsyncIterable(result.fullStream, (e) =>
                  e instanceof Error ? e : new Error(String(e)),
                )
              }),
            ),
          )
        },
      })
    }),
  )

  export const defaultLayer = layer

  export async function stream(input: StreamRequest) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [languageRaw, cfg, provider, auth] = await raceAbort(
      Promise.all([
        Provider.getLanguage(input.model),
        Config.get(),
        Provider.getProvider(input.model.providerID),
        Auth.get(input.model.providerID),
      ]),
      input.abort,
    )

    // ── Provider fallback (Sprint 5 item 2) ─────────────────────────────────
    // Opt-in: experimental.provider.fallback = "local" | "cloud" | null.
    // null => no wrap, byte-identical behaviour. Secondary resolution is best
    // effort: if no secondary can be built (no local-llm configured, no other
    // cloud provider), we log once and proceed without wrapping. Retry is
    // handshake-only; mid-stream errors propagate (see fallback.ts).
    let language = languageRaw
    try {
      const direction = await resolveFallbackDirection()
      if (direction) {
        const primaryIsLocal = input.model.providerID === "local-llm"
        const wantSecondary =
          (direction === "local" && !primaryIsLocal) || (direction === "cloud" && primaryIsLocal)
        if (wantSecondary) {
          const secondary = await resolveSecondaryLanguageModel(direction, input.model.providerID).catch(
            () => undefined,
          )
          if (secondary) {
            language = withStreamingFallback(languageRaw, secondary, {
              label: `${input.model.providerID} -> ${direction}`,
            })
            l.info("provider fallback armed", { direction })
          }
        }
      }
    } catch (err) {
      l.warn("provider fallback setup failed, using primary only", {
        error: (err as Error)?.message ?? String(err),
      })
    }
    // TODO: move this to a proper hook
    const isOpenaiOauth = provider.id === "openai" && auth?.type === "oauth"

    const system: string[] = []
    system.push(
      [
        // use agent prompt otherwise provider prompt
        ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    // Prompt profiler for local models. Log both identifiers because the
    // tokenizer keys on model.id (internal routing id) while humans diagnose
    // via model.api.id (wire id sent to the provider) — having both means the
    // log line is actionable when they diverge.
    if (input.model.providerID === "local-llm") {
      const systemTokens = Token.count(system.join("\n"), input.model.id)
      log.info("prompt profile", {
        systemTokens,
        modelID: input.model.id,
        apiModelID: input.model.api.id,
      })
      // Mobile is bandwidth/perf-constrained — large system prompts cause
      // linear-growth prefill each turn. Flag when exceeds 500 tok so
      // future sessions can investigate systematic bloat.
      if (process.env.OPENCODE_CLIENT === "mobile-embedded" && systemTokens > 500) {
        log.warn("[mobile-embedded] large system prompt may cause multi-turn slowdown", {
          systemTokens,
          threshold: 500,
        })
      }
    }

    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isOpenaiOauth) {
      options.instructions = system.join("\n")
    }

    const isWorkflow = language instanceof GitLabWorkflowLanguageModel
    const messages = isOpenaiOauth
      ? input.messages
      : isWorkflow
        ? input.messages
        : [
            ...system.map(
              (x): ModelMessage => ({
                role: "system",
                content: x,
              }),
            ),
            ...input.messages,
          ]

    // DLP: scan and redact sensitive content before sending to LLM
    const dlpResult = DLP.scanMessages(messages as any)
    const safeMessages = dlpResult.messages as typeof messages

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent.name,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent.name,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    // Démarrer llama-server si absent. DOIT être avant getLocalLLMAdaptiveLimits
    // pour que les adaptive limits soient calculées sur un serveur déjà démarré.
    if (input.model.providerID === "local-llm") {
      await LocalLLMServer.ensureRunning(input.model.api.id, input.abort)
    }

    // Adaptive limits for local-llm: derived from actual n_ctx reported by llama-server.
    // For all other providers: standard model output limit.
    const localLLMLimits =
      input.model.providerID === "local-llm"
        ? await getLocalLLMAdaptiveLimits(provider.options?.baseURL ?? "http://127.0.0.1:14097/v1", input.model)
        : null

    const maxOutputTokens =
      isOpenaiOauth || provider.id.includes("github-copilot")
        ? undefined
        : localLLMLimits?.maxTokens ?? ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    // LiteLLM/Bedrock rejects requests where the message history contains tool
    // calls but no tools param is present. When there are no active tools (e.g.
    // during compaction), inject a stub tool to satisfy the validation requirement.
    // The stub description explicitly tells the model not to call it.
    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            reason: { type: "string", description: "Unused" },
          },
        }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    // Wire up toolExecutor for DWS workflow models so that tool calls
    // from the workflow service are executed via opencode's tool system
    // and results sent back over the WebSocket.
    if (language instanceof GitLabWorkflowLanguageModel) {
      const workflowModel = language
      workflowModel.systemPrompt = system.join("\n")
      workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
        const t = tools[toolName]
        if (!t || !t.execute) {
          return { result: "", error: `Unknown tool: ${toolName}` }
        }
        try {
          const result = await t.execute!(JSON.parse(argsJson), {
            toolCallId: _requestID,
            messages: input.messages,
            abortSignal: input.abort,
          })
          const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
          return {
            result: output,
            metadata: typeof result === "object" ? result?.metadata : undefined,
            title: typeof result === "object" ? result?.title : undefined,
          }
        } catch (e: any) {
          return { result: "", error: e.message ?? String(e) }
        }
      }
    }

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: (() => {
        const base = ProviderTransform.providerOptions(input.model, params.options)
        // For local-llm: inject the adaptive reasoning_budget per-request so llama-server
        // limits thinking tokens proportionally to available context (nothing hardcoded).
        //
        // IMPORTANT: The openai-compatible AI SDK provider uses `name` (= model.providerID)
        // as providerOptionsName. Unknown keys in providerOptions[providerOptionsName] are
        // forwarded as-is to the request body. So reasoning_budget must go under
        // model.providerID ("local-llm"), NOT under "openaiCompatible".
        // ProviderTransform.providerOptions() already returns { [model.providerID]: options }
        // for local-llm (sdkKey intentionally returns undefined for @ai-sdk/openai-compatible).
        // Only inject reasoning_budget when thinking is active — it's meaningless
        // (and potentially confusing to llama-server) for Qwen models in /no_think mode.
        const thinkingActive = !ProviderTransform.shouldSuppressThinking(input.model)
        if (localLLMLimits && input.model.providerID === "local-llm" && thinkingActive) {
          const key = input.model.providerID
          return {
            ...base,
            [key]: {
              ...(base[key] ?? {}),
              reasoning_budget: localLLMLimits.reasoningBudget,
            },
          }
        }
        return base
      })(),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode")
          ? {
              "x-opencode-project": Instance.project.id,
              "x-opencode-session": input.sessionID,
              "x-opencode-request": input.user.id,
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : {
              "x-session-affinity": input.sessionID,
              ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
              "User-Agent": `opencode/${Installation.VERSION}`,
            }),
        ...input.model.headers,
        ...headers,
      },
      // Retry transient provider errors (rate limits, 5xx, connection reset)
      // by default — 0 retries meant every flaky Anthropic/OpenAI 503 became
      // a visible failure in the agent loop, even though the SDK itself can
      // recover in a few hundred ms. Callers that genuinely want "no retry"
      // (tests, dry-runs) still pass retries: 0 explicitly.
      maxRetries: input.retries ?? 2,
      messages: safeMessages,
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            specificationVersion: "v3" as const,
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
        ],
      }),
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
          sessionId: input.sessionID,
        },
      },
    })
  }

  function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
    const disabled = Permission.disabled(
      Object.keys(input.tools),
      Permission.merge(input.agent.permission, input.permission ?? []),
    )
    return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
  }

  /**
   * Resolve the secondary language model for provider fallback (item 2).
   *
   * Strategy:
   *   - direction = "local" : secondary is local-llm provider's first listed
   *     model. If local-llm is not configured, returns undefined.
   *   - direction = "cloud" : secondary is the first non-local, non-primary
   *     provider that has at least one model. This keeps the picker stable
   *     (user order in config) without inventing heuristics.
   *
   * Returns undefined on any lookup failure — the caller treats that as
   * "no fallback available" and streams with primary only.
   */
  async function resolveSecondaryLanguageModel(
    direction: "local" | "cloud",
    primaryProviderID: string,
  ): Promise<import("@ai-sdk/provider").LanguageModelV3 | undefined> {
    if (direction === "local") {
      const localProvider = await Provider.getProvider("local-llm" as any).catch(() => undefined as any)
      if (!localProvider) return undefined
      const modelID = Object.keys(localProvider.models ?? {})[0]
      if (!modelID) return undefined
      const model = await Provider.getModel("local-llm" as any, modelID as any).catch(() => undefined as any)
      if (!model) return undefined
      return await Provider.getLanguage(model).catch(() => undefined as any)
    }
    // direction === "cloud"
    const all = await Provider.list().catch(() => undefined as any)
    if (!all) return undefined

    // Customisable cloud fallback (Sprint 6 item 5).
    // If `experimental.provider.fallback_cloud_providerID` is set and matches a
    // configured provider, prefer it. Otherwise fall back to the historic
    // "first non-local non-primary provider" heuristic. Invalid overrides log
    // a one-shot warn and degrade to default behaviour.
    const cfg = await Config.get().catch(() => undefined as any)
    const override: string | null | undefined = (cfg as any)?.experimental?.provider?.fallback_cloud_providerID
    if (override && typeof override === "string") {
      const prov = (all as Record<string, any>)[override]
      if (!prov) {
        log.warn("fallback_cloud_providerID not found in configured providers, falling back to default selection", {
          requested: override,
        })
      } else if (override === primaryProviderID) {
        log.warn("fallback_cloud_providerID matches primary provider, ignoring (would be a no-op)", {
          providerID: override,
        })
      } else {
        const modelID = Object.keys(prov?.models ?? {})[0]
        if (modelID) {
          const model = await Provider.getModel(override as any, modelID as any).catch(() => undefined as any)
          if (model) {
            const lm = await Provider.getLanguage(model).catch(() => undefined as any)
            if (lm) return lm
          }
        }
        log.warn("fallback_cloud_providerID resolved but has no usable model, falling back to default selection", {
          requested: override,
        })
      }
    }

    for (const [providerID, prov] of Object.entries<any>(all as Record<string, any>)) {
      if (providerID === primaryProviderID || providerID === "local-llm") continue
      const modelID = Object.keys(prov?.models ?? {})[0]
      if (!modelID) continue
      const model = await Provider.getModel(providerID as any, modelID as any).catch(() => undefined as any)
      if (!model) continue
      const lm = await Provider.getLanguage(model).catch(() => undefined as any)
      if (lm) return lm
    }
    return undefined
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
