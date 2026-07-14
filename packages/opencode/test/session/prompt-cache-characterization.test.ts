// Phase 0 characterization tests for the deferred prompt-cache-after-compaction
// chantier. NO functional change — these tests only observe and lock in the
// CURRENT behavior of ProviderTransform.applyCaching(), MessageV2.toModelMessagesEffect()
// and LLM.stream()'s tool/system serialization, so that Phase 1+ has a verified
// baseline to diff against.
//
// See: D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Plan-Differe-Prompt-Cache-Apres-Compaction-et-Changement-Agent-Post-Observability-2026-07-13.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { tool, type ModelMessage } from "ai"
import z from "zod"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderTransform } from "../../src/provider/transform"
import { LLM } from "../../src/session/llm"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelsDev } from "../../src/provider/models"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import { SessionID, MessageID, PartID } from "../../src/session/schema"

type Capture = {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

const state = {
  server: null as ReturnType<typeof Bun.serve> | null,
  queue: [] as Array<{
    path: string
    response: Response | ((req: Request, capture: Capture) => Response)
    resolve: (value: Capture) => void
  }>,
}

function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise((resolve) => {
    result.resolve = resolve
  })
  return result
}

function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

beforeAll(() => {
  state.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const next = state.queue.shift()
      if (!next) return new Response("unexpected request", { status: 500 })
      const url = new URL(req.url)
      const body = (await req.json()) as Record<string, unknown>
      next.resolve({ url, headers: req.headers, body })
      if (!url.pathname.endsWith(next.path)) return new Response("not found", { status: 404 })
      return typeof next.response === "function" ? next.response(req, { url, headers: req.headers, body }) : next.response
    },
  })
})

beforeEach(() => {
  state.queue.length = 0
})

afterAll(() => {
  state.server?.stop()
})

function anthropicEventResponse(text: string) {
  const chunks = [
    {
      type: "message_start",
      message: {
        id: "msg-1",
        model: "claude-3-5-sonnet-20241022",
        usage: { input_tokens: 3, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null, container: null },
      usage: { input_tokens: 3, output_tokens: 2, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    },
    { type: "message_stop" },
  ]
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}`)
  const payload = lines.join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload))
        controller.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )
}

async function loadFixture(providerID: string, modelID: string) {
  const fixturePath = path.join(import.meta.dir, "../tool/fixtures/models-api.json")
  const data = await Filesystem.readJson<Record<string, ModelsDev.Provider>>(fixturePath)
  const provider = data[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  const model = provider.models[modelID]
  if (!model) throw new Error(`Missing model in fixture: ${modelID}`)
  return { provider, model }
}

function makeTool(name: string) {
  return tool({
    description: `${name} tool`,
    inputSchema: z.object({ x: z.string().optional() }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })
}

async function runAnthropicStream(opts: {
  serverOrigin: string
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, ReturnType<typeof makeTool>>
  permission?: Agent.Info["permission"]
  sessionSuffix: string
}) {
  const providerID = "anthropic"
  const modelID = "claude-3-5-sonnet-20241022"
  const fixture = await loadFixture(providerID, modelID)

  const request = waitRequest("/messages", anthropicEventResponse("ok"))

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          enabled_providers: [providerID],
          provider: {
            [providerID]: {
              options: { apiKey: "test-anthropic-key", baseURL: `${opts.serverOrigin}/v1` },
            },
          },
        }),
      )
    },
  })

  let capture: Capture | undefined
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
      const sessionID = SessionID.make(`session-cache-${opts.sessionSuffix}`)
      const agent = {
        name: "test",
        mode: "primary",
        options: {},
        permission: opts.permission ?? [{ permission: "*", pattern: "*", action: "allow" }],
      } satisfies Agent.Info

      const user = {
        id: MessageID.make(`user-${opts.sessionSuffix}`),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: agent.name,
        model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
      } satisfies MessageV2.User

      const stream = await LLM.stream({
        user,
        sessionID,
        model: resolved,
        agent,
        system: opts.system,
        abort: new AbortController().signal,
        messages: opts.messages,
        tools: opts.tools,
      })

      for await (const _ of stream.fullStream) {
      }
      capture = await request
    },
  })
  if (!capture) throw new Error("no capture recorded")
  return capture
}

describe("Phase 2 — MessageV2.toModelMessagesEffect compaction marker", () => {
  // NOTE: this test originally locked in the Phase 0 baseline ("no marker
  // propagates at all"). Phase 2 of the deferred prompt-cache-after-compaction
  // plan (v3.1) deliberately changes this — the assertions below now reflect
  // the new, intentional behavior instead.
  test("a compaction summary message (mode=compaction, summary=true) carries the opencodeCacheInternal.cacheAnchor marker", async () => {
    const sessionID = SessionID.make("session-marker")
    const providerID = ProviderID.make("anthropic")
    const messageID = MessageID.make("m-summary")

    const summaryInfo: MessageV2.Assistant = {
      id: messageID,
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

    const input: MessageV2.WithParts[] = [
      {
        info: summaryInfo,
        parts: [
          {
            id: PartID.make("p-summary"),
            sessionID,
            messageID,
            type: "text",
            text: "## Goal\nContinue refactoring the widget.",
          } as unknown as MessageV2.Part,
        ],
      },
    ]

    // Minimal model shape sufficient for toModelMessagesEffect (does not need a live provider).
    const fakeModel = {
      id: ModelID.make("claude-3-5-sonnet-20241022"),
      providerID,
      api: { id: "claude-3-5-sonnet-20241022", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
      name: "Claude",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 200000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    } as any

    const result = await MessageV2.toModelMessages(input, fakeModel)

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("assistant")
    expect(JSON.stringify(result[0].content)).toContain("Continue refactoring the widget")
    // The marker lives on the content part (this is a UIMessage part-level
    // providerMetadata → ModelMessage content-part providerOptions round trip),
    // not on the message itself.
    const content = result[0].content as any[]
    expect(content[0].providerOptions?.opencodeCacheInternal?.cacheAnchor).toBe(true)
  })

  test("an ordinary assistant message (no mode=compaction/summary=true) is never tagged as a cache anchor", async () => {
    const sessionID = SessionID.make("session-marker-2")
    const providerID = ProviderID.make("anthropic")
    const messageID = MessageID.make("m-ordinary")

    const ordinaryInfo: MessageV2.Assistant = {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: 0 },
      parentID: MessageID.make("m-parent"),
      modelID: ModelID.make("claude-3-5-sonnet-20241022"),
      providerID,
      mode: "primary",
      agent: "build",
      summary: false,
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    } as unknown as MessageV2.Assistant

    const input: MessageV2.WithParts[] = [
      {
        info: ordinaryInfo,
        parts: [
          {
            id: PartID.make("p-ordinary"),
            sessionID,
            messageID,
            type: "text",
            text: "Sure, I'll do that.",
          } as unknown as MessageV2.Part,
        ],
      },
    ]

    const fakeModel = {
      id: ModelID.make("claude-3-5-sonnet-20241022"),
      providerID,
      api: { id: "claude-3-5-sonnet-20241022", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
      name: "Claude",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 200000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    } as any

    const result = await MessageV2.toModelMessages(input, fakeModel)
    expect(result).toHaveLength(1)
    const content = result[0].content as any
    if (Array.isArray(content)) {
      expect(JSON.stringify(content)).not.toContain("cacheAnchor")
    } else {
      expect((result[0] as any).providerOptions).toBeUndefined()
    }
  })
})

describe("Phase 0 characterization — ProviderTransform.message cache scope", () => {
  test("OpenAI models never receive an Anthropic-style cache_control marker", () => {
    const openaiModel = {
      id: ModelID.make("gpt-5"),
      providerID: ProviderID.make("openai"),
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

    const msgs = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {})
    expect(JSON.stringify(result)).not.toContain("cache_control")
    expect(JSON.stringify(result)).not.toContain("cacheControl")
  })
})

describe("Phase 0 characterization — LLM.stream wire payload (Anthropic)", () => {
  test("system prompt gets cache_control; tools currently get NONE", async () => {
    const server = state.server!
    const capture = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { bash: makeTool("bash"), read: makeTool("read") },
      sessionSuffix: "baseline",
    })

    const bodyStr = JSON.stringify(capture.body)
    expect(bodyStr).toContain("cache_control")

    const tools = (capture.body as any).tools as any[]
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBe(2)
    // None of the tool entries carry a cache_control today — Phase 3 of the
    // deferred plan is what would add this.
    for (const t of tools) {
      expect(JSON.stringify(t)).not.toContain("cache_control")
    }
  })

  test("tool insertion order is mirrored as-is in the outgoing payload (no canonical sort yet)", async () => {
    const server = state.server!

    const captureA = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { alpha: makeTool("alpha"), bravo: makeTool("bravo"), charlie: makeTool("charlie") },
      sessionSuffix: "order-a",
    })
    const captureB = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { charlie: makeTool("charlie"), alpha: makeTool("alpha"), bravo: makeTool("bravo") },
      sessionSuffix: "order-b",
    })

    const namesA = ((captureA.body as any).tools as any[]).map((t) => t.name)
    const namesB = ((captureB.body as any).tools as any[]).map((t) => t.name)

    expect(namesA).toEqual(["alpha", "bravo", "charlie"])
    expect(namesB).toEqual(["charlie", "alpha", "bravo"])
    // Same effective toolset, different insertion order → different serialized
    // order today. This is exactly the gap Phase 3 (tool canonicalization) targets.
    expect(namesA).not.toEqual(namesB)
  })

  test("a permission-denied tool never reaches the outgoing payload", async () => {
    const server = state.server!
    const capture = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { bash: makeTool("bash"), dangerous: makeTool("dangerous") },
      // Permission.disabled() uses ruleset.findLast(...) — the LAST matching
      // rule wins, so the general allow must come before the specific deny.
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "dangerous", pattern: "*", action: "deny" },
      ],
      sessionSuffix: "perm",
    })

    const names = ((capture.body as any).tools as any[]).map((t) => t.name)
    expect(names).toContain("bash")
    expect(names).not.toContain("dangerous")
  })

  test("identical system+messages+tools across two calls serialize to an identical prefix (determinism baseline)", async () => {
    const server = state.server!
    const shared = {
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }] as ModelMessage[],
      tools: { bash: makeTool("bash"), read: makeTool("read") },
    }

    const capture1 = await runAnthropicStream({ ...shared, sessionSuffix: "det-1" })
    const capture2 = await runAnthropicStream({ ...shared, sessionSuffix: "det-2" })

    expect(JSON.stringify((capture1.body as any).system)).toBe(JSON.stringify((capture2.body as any).system))
    expect(JSON.stringify((capture1.body as any).messages)).toBe(JSON.stringify((capture2.body as any).messages))
    expect(JSON.stringify((capture1.body as any).tools)).toBe(JSON.stringify((capture2.body as any).tools))
    // NOTE: this proves payload determinism only. It does NOT prove a real
    // provider-side cache hit — only a live Anthropic call (Phase 4, manual,
    // gated) can prove cache_read_input_tokens > 0.
  })
})
