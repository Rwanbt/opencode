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
    const [language, cfg, provider, auth] = await raceAbort(
      Promise.all([
        Provider.getLanguage(input.model),
        Config.get(),
        Provider.getProvider(input.model.providerID),
        Auth.get(input.model.providerID),
      ]),
      input.abort,
    )
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
      maxRetries: input.retries ?? 0,
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
