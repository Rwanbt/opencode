// Integration tests for the deferred prompt-cache-after-compaction chantier
// (plan v3.1), flag ON: MessageV2 -> ProviderTransform middleware -> mock
// Anthropic provider. Exercises the real LLM.stream() pipeline end-to-end so
// these assertions prove the actual wire payload, not just the PromptCache
// unit contract (see test/provider/cache.test.ts for that).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { tool, type ModelMessage } from "ai"
import z from "zod"
import { MessageV2 } from "../../src/session/message-v2"
import { LLM } from "../../src/session/llm"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelsDev } from "../../src/provider/models"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import { SessionID, MessageID, PartID } from "../../src/session/schema"

type Capture = { url: URL; headers: Headers; body: Record<string, unknown> }

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

const ORIGINAL_FLAG = process.env.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING
  else process.env.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING = ORIGINAL_FLAG
})

function anthropicEventResponse(text: string) {
  const chunks = [
    {
      type: "message_start",
      message: { id: "msg-1", model: "claude-3-5-sonnet-20241022", usage: { input_tokens: 3, cache_creation_input_tokens: null, cache_read_input_tokens: null } },
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
  const payload = chunks.map((c) => `data: ${JSON.stringify(c)}`).join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(payload)); c.close() } }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
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
          provider: { [providerID]: { options: { apiKey: "test-anthropic-key", baseURL: `${opts.serverOrigin}/v1` } } },
        }),
      )
    },
  })

  let capture: Capture | undefined
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
      const sessionID = SessionID.make(`session-p3-${opts.sessionSuffix}`)
      const agent = {
        name: "test",
        mode: "primary",
        options: {},
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      } satisfies Agent.Info
      const user = {
        id: MessageID.make(`user-p3-${opts.sessionSuffix}`),
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

describe("Phase 3 — tool canonicalization + tool breakpoint (flag ON)", () => {
  test("same effective toolset, different insertion order, serializes identically on the wire", async () => {
    process.env.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING = "true"
    const server = state.server!

    const captureA = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { charlie: makeTool("charlie"), alpha: makeTool("alpha"), bravo: makeTool("bravo") },
      sessionSuffix: "canon-a",
    })
    const captureB = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { bravo: makeTool("bravo"), alpha: makeTool("alpha"), charlie: makeTool("charlie") },
      sessionSuffix: "canon-b",
    })

    const namesA = ((captureA.body as any).tools as any[]).map((t) => t.name)
    const namesB = ((captureB.body as any).tools as any[]).map((t) => t.name)
    expect(namesA).toEqual(["alpha", "bravo", "charlie"])
    expect(namesB).toEqual(["alpha", "bravo", "charlie"])
  })

  test("the last tool (canonical order) carries a cache_control breakpoint on the wire", async () => {
    process.env.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING = "true"
    const server = state.server!
    const capture = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { zeta: makeTool("zeta"), alpha: makeTool("alpha") },
      sessionSuffix: "toolcache",
    })
    const tools = (capture.body as any).tools as any[]
    expect(tools.map((t) => t.name)).toEqual(["alpha", "zeta"])
    expect(tools[0].cache_control).toBeUndefined()
    expect(tools[1].cache_control).toEqual({ type: "ephemeral" })
  })

  test("flag OFF (default): tool order mirrors caller insertion order, no cache_control on any tool", async () => {
    delete process.env.OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING
    const server = state.server!
    const capture = await runAnthropicStream({
      serverOrigin: server.url.origin,
      system: ["You are a helpful assistant."],
      messages: [{ role: "user", content: "Hello" }],
      tools: { zeta: makeTool("zeta"), alpha: makeTool("alpha") },
      sessionSuffix: "flagoff",
    })
    const tools = (capture.body as any).tools as any[]
    expect(tools.map((t) => t.name)).toEqual(["zeta", "alpha"])
    for (const t of tools) expect(t.cache_control).toBeUndefined()
  })
})
