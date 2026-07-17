import type { ModelMessage, Tool } from "ai"
import { mergeDeep } from "remeda"
import type { Provider } from "./provider"

// Pure prompt-cache breakpoint policy for the deferred "prompt cache after
// compaction and agent switch" chantier (plan v3.1). Gated behind
// Flag.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING — see provider/transform.ts.
//
// IMPORTANT: the transient marker namespace is "opencodeCacheInternal", NOT
// "opencode". "opencode" is a REAL provider id (self-hosted models routed via
// @ai-sdk/openai-compatible, where ProviderTransform's sdkKey() falls back to
// model.providerID) whose providerOptions.opencode carries real per-part
// metadata (itemId, reasoning continuation, etc — see
// ProviderTransform.message's "strip openai metadata when store=false" tests).
// Stripping providerOptions.opencode unconditionally, as an earlier draft of
// the plan assumed, would silently corrupt real requests to that provider.
export namespace PromptCache {
  export const MAX_BREAKPOINTS = 4
  const MARKER_NAMESPACE = "opencodeCacheInternal"

  const PROVIDER_OPTIONS_PATCH = {
    anthropic: { cacheControl: { type: "ephemeral" } },
    openrouter: { cacheControl: { type: "ephemeral" } },
    bedrock: { cachePoint: { type: "default" } },
    openaiCompatible: { cache_control: { type: "ephemeral" } },
    copilot: { copilot_cache_control: { type: "ephemeral" } },
  }

  export function isClaudeFamily(model: Provider.Model): boolean {
    return (
      (model.providerID === "anthropic" ||
        model.providerID === "google-vertex-anthropic" ||
        model.api.id.includes("anthropic") ||
        model.api.id.includes("claude") ||
        model.id.includes("anthropic") ||
        model.id.includes("claude") ||
        model.api.npm === "@ai-sdk/anthropic") &&
      model.api.npm !== "@ai-sdk/gateway"
    )
  }

  export type Capabilities = {
    supported: boolean
    /** true = cache marker goes on the message's own providerOptions; false = on the last content part's providerOptions. */
    messageLevel: boolean
    /** Breakpoint slots already consumed by a provider's top-level automatic caching (e.g. AI SDK Gateway `caching: "auto"`). Always 0 today: gateway models are excluded from isClaudeFamily(), so no known consumer exists yet. */
    automaticCachingSlots: number
    /**
     * Whether it's safe to annotate the last tool definition with a cache
     * breakpoint (Tool.providerOptions -> LanguageModelV3FunctionTool.providerOptions).
     * Restricted to the native Anthropic/Vertex-Anthropic AI SDK adapters —
     * Bedrock's installed SDK version does not serialize tool.providerOptions
     * (plan v3.1 §5.1), and other Claude-shaped proxies (OpenRouter, etc.)
     * haven't been verified against a real provider payload yet (§5.3).
     */
    toolBreakpointSupported: boolean
  }

  export function getCapabilities(model: Provider.Model): Capabilities {
    const supported = isClaudeFamily(model)
    if (!supported) return { supported: false, messageLevel: false, automaticCachingSlots: 0, toolBreakpointSupported: false }
    const messageLevel =
      model.providerID === "anthropic" || model.providerID.includes("bedrock") || model.api.npm === "@ai-sdk/amazon-bedrock"
    const toolBreakpointSupported = model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/google-vertex/anthropic"
    return { supported: true, messageLevel, automaticCachingSlots: 0, toolBreakpointSupported }
  }

  /**
   * Canonicalizes a resolved toolset by name so that the same effective
   * toolset always serializes in the same order to the provider, regardless
   * of the insertion order the caller built it in (e.g. two agents with
   * identical permissions building their tool registry differently). Returns
   * a new object; never mutates `tools`.
   */
  export function canonicalizeToolOrder<T>(tools: Record<string, T>): Record<string, T> {
    const names = Object.keys(tools).sort((a, b) => a.localeCompare(b))
    const result: Record<string, T> = {}
    for (const name of names) result[name] = tools[name]
    return result
  }

  /**
   * Annotates the last tool (by canonical name order) with a cache
   * breakpoint, reserving exactly one of the shared MAX_BREAKPOINTS budget —
   * callers must subtract 1 from the message budget passed to
   * selectMessageBreakpoints() whenever capabilities.toolBreakpointSupported
   * is true. No-op (same reference) when unsupported or `tools` is empty.
   * Never mutates `tools` or its entries.
   */
  export function annotateLastToolForCache(tools: Record<string, Tool>, capabilities: Capabilities): Record<string, Tool> {
    const names = Object.keys(tools)
    if (!capabilities.toolBreakpointSupported || names.length === 0) return tools
    const lastName = names[names.length - 1]
    const last = tools[lastName]
    return {
      ...tools,
      [lastName]: { ...last, providerOptions: mergeDeep((last as any).providerOptions ?? {}, { anthropic: PROVIDER_OPTIONS_PATCH.anthropic }) } as Tool,
    }
  }

  export type BreakpointKind = "system" | "summary" | "message"
  export type Breakpoint = { index: number; kind: BreakpointKind }

  function isCacheAnchor(msg: ModelMessage): boolean {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return false
    return msg.content.some((part) => {
      const opts = (part as { providerOptions?: Record<string, unknown> }).providerOptions
      const marker = opts?.[MARKER_NAMESPACE] as { cacheAnchor?: boolean } | undefined
      return marker?.cacheAnchor === true
    })
  }

  /**
   * Selects up to `budget` message breakpoints, in priority order:
   * system messages, then the last compaction-summary anchor (if any, see
   * message-v2.ts), then the last 2 non-system messages. Never mutates
   * `messages`. A message already selected under a higher-priority category
   * consumes only one slot even if it would also match a lower one.
   */
  export function selectMessageBreakpoints(messages: ModelMessage[], budget: number): Breakpoint[] {
    if (budget <= 0) return []

    const candidates: Breakpoint[] = []
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "system") candidates.push({ index: i, kind: "system" })
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isCacheAnchor(messages[i])) {
        candidates.push({ index: i, kind: "summary" })
        break
      }
    }
    const nonSystemIndices: number[] = []
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "system") nonSystemIndices.push(i)
    }
    for (const index of nonSystemIndices.slice(-2)) candidates.push({ index, kind: "message" })

    const seen = new Set<number>()
    const result: Breakpoint[] = []
    for (const candidate of candidates) {
      if (seen.has(candidate.index)) continue
      seen.add(candidate.index)
      result.push(candidate)
      if (result.length >= budget) break
    }
    return result
  }

  /** Applies the provider's cache-control patch at the selected breakpoints. Returns a new array; never mutates `messages` or its elements. */
  export function applyMessageCacheMarkers(
    messages: ModelMessage[],
    input: { capabilities: Capabilities; breakpoints: Breakpoint[] },
  ): ModelMessage[] {
    if (!input.capabilities.supported || input.breakpoints.length === 0) return messages
    const targetIndices = new Set(input.breakpoints.map((b) => b.index))

    return messages.map((msg, i) => {
      if (!targetIndices.has(i)) return msg

      if (!input.capabilities.messageLevel && Array.isArray(msg.content) && msg.content.length > 0) {
        const lastIndex = msg.content.length - 1
        const last = msg.content[lastIndex] as { type?: string; providerOptions?: Record<string, unknown> }
        if (last && typeof last === "object" && last.type !== "tool-approval-request" && last.type !== "tool-approval-response") {
          const content = [...msg.content]
          content[lastIndex] = { ...last, providerOptions: mergeDeep(last.providerOptions ?? {}, PROVIDER_OPTIONS_PATCH) } as any
          return { ...msg, content } as ModelMessage
        }
      }

      return { ...msg, providerOptions: mergeDeep((msg as any).providerOptions ?? {}, PROVIDER_OPTIONS_PATCH) } as ModelMessage
    })
  }

  function stripNamespace<T extends Record<string, unknown> | undefined>(opts: T): T {
    if (!opts || !(MARKER_NAMESPACE in opts)) return opts
    const clone = { ...opts }
    delete clone[MARKER_NAMESPACE]
    return clone as T
  }

  /** Removes the transient `opencodeCacheInternal` marker from message- and part-level providerOptions. Unconditional — runs whether the feature flag is on or off. Never mutates; returns the same reference when nothing changes. */
  export function stripInternalProviderMetadata(messages: ModelMessage[]): ModelMessage[] {
    let changedAny = false
    const result = messages.map((msg) => {
      const providerOptions = stripNamespace((msg as any).providerOptions)
      let changed = providerOptions !== (msg as any).providerOptions

      let content = (msg as any).content
      if (Array.isArray(content)) {
        let contentChanged = false
        const nextContent = content.map((part: any) => {
          const partOptions = stripNamespace(part?.providerOptions)
          if (partOptions === part?.providerOptions) return part
          contentChanged = true
          return { ...part, providerOptions: partOptions }
        })
        if (contentChanged) {
          content = nextContent
          changed = true
        }
      }

      if (!changed) return msg
      changedAny = true
      return { ...msg, providerOptions, content }
    })
    return changedAny ? result : messages
  }
}
