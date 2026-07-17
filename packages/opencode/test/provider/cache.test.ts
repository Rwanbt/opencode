import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { tool } from "ai"
import z from "zod"
import { PromptCache } from "../../src/provider/cache"
import { ProviderTransform } from "../../src/provider/transform"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"

function anthropicModel(overrides: Partial<any> = {}) {
  return {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: { id: "claude-3-5-sonnet-20241022", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    ...overrides,
  } as any
}

function bedrockModel() {
  return anthropicModel({
    id: "amazon-bedrock/anthropic.claude-opus-4-6",
    providerID: "amazon-bedrock",
    api: { id: "anthropic.claude-opus-4-6", url: "https://bedrock-runtime.us-east-1.amazonaws.com", npm: "@ai-sdk/amazon-bedrock" },
  })
}

function openaiModel() {
  return {
    id: "openai/gpt-5",
    providerID: "openai",
    api: { id: "gpt-5", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  } as any
}

describe("PromptCache.getCapabilities", () => {
  test("anthropic model is supported, message-level, tool breakpoint supported", () => {
    expect(PromptCache.getCapabilities(anthropicModel())).toEqual({
      supported: true,
      messageLevel: true,
      automaticCachingSlots: 0,
      toolBreakpointSupported: true,
    })
  })

  test("bedrock claude model is supported, message-level, but tool breakpoint NOT supported (SDK limitation)", () => {
    expect(PromptCache.getCapabilities(bedrockModel())).toEqual({
      supported: true,
      messageLevel: true,
      automaticCachingSlots: 0,
      toolBreakpointSupported: false,
    })
  })

  test("non-claude model is not supported", () => {
    expect(PromptCache.getCapabilities(openaiModel())).toEqual({
      supported: false,
      messageLevel: false,
      automaticCachingSlots: 0,
      toolBreakpointSupported: false,
    })
  })
})

describe("PromptCache.selectMessageBreakpoints", () => {
  test("budget 0 selects nothing", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]
    expect(PromptCache.selectMessageBreakpoints(messages, 0)).toEqual([])
  })

  test("never exceeds the requested budget, automatic caching slots included", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys1" },
      { role: "system", content: "sys2" },
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "reply 1" },
      { role: "user", content: "turn 2" },
    ]
    // Simulate an adapter that already consumed 3 of the 4 global slots via
    // automatic caching — only 1 slot left for our own markers.
    const budget = PromptCache.MAX_BREAKPOINTS - 3
    const breakpoints = PromptCache.selectMessageBreakpoints(messages, budget)
    expect(breakpoints.length).toBeLessThanOrEqual(budget)
    expect(breakpoints.length).toBe(1)
  })

  test("selects both system messages and the last 2 non-system messages within a budget of 4", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys1" },
      { role: "system", content: "sys2" },
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "reply 1" },
      { role: "user", content: "turn 2" },
    ]
    const breakpoints = PromptCache.selectMessageBreakpoints(messages, PromptCache.MAX_BREAKPOINTS)
    expect(breakpoints.map((b) => b.index).sort()).toEqual([0, 1, 3, 4])
    expect(breakpoints.find((b) => b.index === 0)?.kind).toBe("system")
    expect(breakpoints.find((b) => b.index === 1)?.kind).toBe("system")
  })

  test("prioritizes the compaction-summary anchor over a duplicate final-message slot", () => {
    const summary: ModelMessage = {
      role: "assistant",
      content: [{ type: "text", text: "summary", providerOptions: { opencodeCacheInternal: { cacheAnchor: true } } }],
    } as any
    const messages: ModelMessage[] = [{ role: "system", content: "sys" }, summary, { role: "user", content: "next" }]
    // Budget of 2: system + summary should win over "last 2 non-system messages" (summary + next).
    const breakpoints = PromptCache.selectMessageBreakpoints(messages, 2)
    expect(breakpoints).toEqual([
      { index: 0, kind: "system" },
      { index: 1, kind: "summary" },
    ])
  })

  test("does not mutate the input array", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]
    const snapshot = JSON.stringify(messages)
    PromptCache.selectMessageBreakpoints(messages, PromptCache.MAX_BREAKPOINTS)
    expect(JSON.stringify(messages)).toBe(snapshot)
  })
})

describe("PromptCache.applyMessageCacheMarkers", () => {
  test("does not mutate input messages or their content parts", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ] as any
    const before = JSON.stringify(messages)
    const capabilities = PromptCache.getCapabilities(anthropicModel())
    const breakpoints = PromptCache.selectMessageBreakpoints(messages, PromptCache.MAX_BREAKPOINTS)
    PromptCache.applyMessageCacheMarkers(messages, { capabilities, breakpoints })
    expect(JSON.stringify(messages)).toBe(before)
  })

  test("message-level provider (anthropic): marks msg.providerOptions directly", () => {
    const messages: ModelMessage[] = [{ role: "system", content: "sys" }]
    const capabilities = PromptCache.getCapabilities(anthropicModel())
    const result = PromptCache.applyMessageCacheMarkers(messages, {
      capabilities,
      breakpoints: [{ index: 0, kind: "system" }],
    })
    expect((result[0] as any).providerOptions.anthropic).toEqual({ cacheControl: { type: "ephemeral" } })
  })

  test("content-level provider (e.g. openrouter/openai-compatible claude proxy): marks last content part", () => {
    const model = anthropicModel({
      providerID: "openrouter",
      api: { id: "anthropic/claude-3.5-sonnet", url: "https://openrouter.ai/api/v1", npm: "@openrouter/ai-sdk-provider" },
    })
    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }, { type: "text", text: "world" }] },
    ] as any
    const capabilities = PromptCache.getCapabilities(model)
    expect(capabilities.messageLevel).toBe(false)
    const result = PromptCache.applyMessageCacheMarkers(messages, {
      capabilities,
      breakpoints: [{ index: 0, kind: "message" }],
    })
    const content = (result[0] as any).content
    expect(content[0].providerOptions).toBeUndefined()
    expect(content[1].providerOptions.openrouter).toEqual({ cacheControl: { type: "ephemeral" } })
  })

  test("unsupported model returns the same array reference (no-op)", () => {
    const messages: ModelMessage[] = [{ role: "system", content: "sys" }]
    const capabilities = PromptCache.getCapabilities(openaiModel())
    const result = PromptCache.applyMessageCacheMarkers(messages, { capabilities, breakpoints: [] })
    expect(result).toBe(messages)
  })
})

describe("PromptCache.stripInternalProviderMetadata", () => {
  test("removes the opencodeCacheInternal namespace from message and content providerOptions", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        providerOptions: { opencodeCacheInternal: { cacheAnchor: true }, anthropic: { cacheControl: { type: "ephemeral" } } },
        content: [{ type: "text", text: "hi", providerOptions: { opencodeCacheInternal: { cacheAnchor: true } } }],
      } as any,
    ]
    const result = PromptCache.stripInternalProviderMetadata(messages)
    expect((result[0] as any).providerOptions.opencodeCacheInternal).toBeUndefined()
    expect((result[0] as any).providerOptions.anthropic).toEqual({ cacheControl: { type: "ephemeral" } })
    expect((result[0] as any).content[0].providerOptions.opencodeCacheInternal).toBeUndefined()
  })

  test("CRITICAL: never strips the real 'opencode' provider's own providerOptions namespace", () => {
    // The "opencode" provider (self-hosted models via @ai-sdk/openai-compatible)
    // legitimately uses providerOptions.opencode for itemId / reasoning
    // continuation metadata (see ProviderTransform.message tests). The internal
    // cache marker MUST live under a different key ("opencodeCacheInternal")
    // so this real namespace is never touched.
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        providerOptions: { opencode: { itemId: "msg_123", otherOption: "value" } },
        content: [{ type: "text", text: "hi", providerOptions: { opencode: { itemId: "msg_456" } } }],
      } as any,
    ]
    const result = PromptCache.stripInternalProviderMetadata(messages)
    expect((result[0] as any).providerOptions.opencode).toEqual({ itemId: "msg_123", otherOption: "value" })
    expect((result[0] as any).content[0].providerOptions.opencode).toEqual({ itemId: "msg_456" })
  })

  test("returns the same array reference when nothing needs stripping", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "hi" }]
    expect(PromptCache.stripInternalProviderMetadata(messages)).toBe(messages)
  })
})

describe("ProviderTransform.message — flag off reproduces legacy caching exactly", () => {
  test("system + last 2 messages get cache_control for anthropic, matching pre-Phase-1 behavior", () => {
    const model = anthropicModel()
    const msgs = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "reply 1" },
      { role: "user", content: "turn 2" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect((result[0] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    expect((result[2] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    expect((result[3] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    // turn 1 (index 1) is outside the "last 2 non-system" window and untouched.
    expect((result[1] as any).providerOptions).toBeUndefined()
  })
})

describe("PromptCache pipeline — parity with the legacy path when no compaction marker is present", () => {
  // Flag.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING is a static const evaluated
  // at module load from process.env, so it can't be toggled from within a test.
  // This exercises the exact PromptCache call sequence ProviderTransform.message()
  // runs on the flag-on path, without needing to flip the flag at runtime.
  test("system + last 2 messages get cache_control, same as the legacy applyCaching() path", () => {
    const model = anthropicModel()
    const msgs = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "reply 1" },
      { role: "user", content: "turn 2" },
    ] as any[]
    const capabilities = PromptCache.getCapabilities(model)
    const breakpoints = PromptCache.selectMessageBreakpoints(msgs, PromptCache.MAX_BREAKPOINTS)
    const result = PromptCache.applyMessageCacheMarkers(msgs, { capabilities, breakpoints })
    expect((result[0] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    expect((result[2] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    expect((result[3] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    expect((result[1] as any).providerOptions).toBeUndefined()
  })
})

function makeTool(name: string) {
  return tool({
    description: `${name} tool`,
    inputSchema: z.object({ x: z.string().optional() }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })
}

describe("PromptCache.canonicalizeToolOrder", () => {
  test("same effective toolset, different insertion order, produces the same canonical order", () => {
    const a = PromptCache.canonicalizeToolOrder({ alpha: makeTool("alpha"), bravo: makeTool("bravo"), charlie: makeTool("charlie") })
    const b = PromptCache.canonicalizeToolOrder({ charlie: makeTool("charlie"), alpha: makeTool("alpha"), bravo: makeTool("bravo") })
    expect(Object.keys(a)).toEqual(["alpha", "bravo", "charlie"])
    expect(Object.keys(b)).toEqual(["alpha", "bravo", "charlie"])
  })

  test("does not mutate the input object", () => {
    const input = { bravo: makeTool("bravo"), alpha: makeTool("alpha") }
    const before = Object.keys(input)
    PromptCache.canonicalizeToolOrder(input)
    expect(Object.keys(input)).toEqual(before)
  })
})

describe("PromptCache.annotateLastToolForCache", () => {
  test("marks the last tool (canonical order) with a cache breakpoint for a tool-breakpoint-supported model", () => {
    const tools = PromptCache.canonicalizeToolOrder({ bravo: makeTool("bravo"), alpha: makeTool("alpha") })
    const capabilities = PromptCache.getCapabilities(anthropicModel())
    const result = PromptCache.annotateLastToolForCache(tools, capabilities)
    expect((result.alpha as any).providerOptions).toBeUndefined()
    expect((result.bravo as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
  })

  test("no-op for a model without tool breakpoint support (e.g. bedrock)", () => {
    const tools = PromptCache.canonicalizeToolOrder({ bravo: makeTool("bravo"), alpha: makeTool("alpha") })
    const capabilities = PromptCache.getCapabilities(bedrockModel())
    const result = PromptCache.annotateLastToolForCache(tools, capabilities)
    expect(result).toBe(tools)
  })

  test("no-op for an empty toolset", () => {
    const capabilities = PromptCache.getCapabilities(anthropicModel())
    const result = PromptCache.annotateLastToolForCache({}, capabilities)
    expect(result).toEqual({})
  })

  test("does not mutate the input tools object or the annotated tool", () => {
    const original = makeTool("bravo")
    const tools = { bravo: original }
    const capabilities = PromptCache.getCapabilities(anthropicModel())
    PromptCache.annotateLastToolForCache(tools, capabilities)
    expect(tools.bravo).toBe(original)
    expect((original as any).providerOptions).toBeUndefined()
  })
})

describe("Phase 2 — end-to-end compaction-summary anchoring pipeline", () => {
  test("summary message reaches the wire cache-marked, with the internal marker stripped", async () => {
    const sessionID = SessionID.make("session-e2e")
    const providerID = ProviderID.make("anthropic")
    const summaryID = MessageID.make("m-summary")

    const summaryInfo: MessageV2.Assistant = {
      id: summaryID,
      sessionID,
      role: "assistant",
      time: { created: 0 },
      parentID: MessageID.make("m-parent"),
      modelID: ModelID.make("claude-3-5-sonnet-20241022"),
      providerID,
      mode: "compaction",
      agent: "compaction",
      summary: true,
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    } as unknown as MessageV2.Assistant

    const fakeModel = anthropicModel()
    const withParts: MessageV2.WithParts[] = [
      {
        info: summaryInfo,
        parts: [
          { id: PartID.make("p-summary"), sessionID, messageID: summaryID, type: "text", text: "## Goal\nFinish the widget." } as any,
        ],
      },
    ]

    const summaryModelMessages = await MessageV2.toModelMessages(withParts, fakeModel)
    const msgs = [
      { role: "system", content: "You are helpful." },
      ...summaryModelMessages,
      { role: "user", content: "continue" },
    ] as any[]

    const capabilities = PromptCache.getCapabilities(fakeModel)
    const breakpoints = PromptCache.selectMessageBreakpoints(msgs, PromptCache.MAX_BREAKPOINTS)
    // system (index 0) + the summary anchor (index 1) both win a slot; the
    // "last 2 non-system" category would have picked [1, 2] but index 1 is
    // already claimed by the higher-priority "summary" category.
    expect(breakpoints).toEqual([
      { index: 0, kind: "system" },
      { index: 1, kind: "summary" },
      { index: 2, kind: "message" },
    ])

    const marked = PromptCache.applyMessageCacheMarkers(msgs, { capabilities, breakpoints })
    expect((marked[1] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    // The internal marker is still present until the final strip step...
    expect((marked[1] as any).content[0].providerOptions.opencodeCacheInternal.cacheAnchor).toBe(true)

    const wire = PromptCache.stripInternalProviderMetadata(marked)
    // ...and is gone from the payload that would actually reach the provider.
    expect(JSON.stringify(wire)).not.toContain("opencodeCacheInternal")
    expect(JSON.stringify(wire)).not.toContain("cacheAnchor")
    // The real cache_control marker survives the strip.
    expect((wire[1] as any).providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })
  })
})
