import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { LLM } from "../../src/session/llm"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelsDev } from "../../src/provider/models"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"
import { ObservabilityRuntime } from "../../src/observability/runtime"
import { Database, eq } from "../../src/storage/db"
import { ObservabilityEventTable } from "../../src/observability/event.sql"

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

function createChatStream(text: string) {
  const payload =
    [
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" } }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { content: text } }] })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

function waitStreamingRequest(pathname: string) {
  const request = deferred<Capture>()
  const encoder = new TextEncoder()
  state.queue.push({
    path: pathname,
    resolve: request.resolve,
    response() {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "chatcmpl-abort",
                  object: "chat.completion.chunk",
                  choices: [{ delta: { role: "assistant" } }],
                })}\n\n`,
              ),
            )
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )
    },
  })
  return { request: request.promise }
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

function configWithObservability(providerID: string, serverOrigin: string, captureMode: "local_metadata" | "local_redacted") {
  return {
    $schema: "https://opencode.ai/config.json",
    enabled_providers: [providerID],
    provider: {
      [providerID]: {
        options: { apiKey: "test-key", baseURL: `${serverOrigin}/v1` },
      },
    },
    experimental: { observability: { enabled: true, captureMode } },
  }
}

function rowsForSession(sessionID: string) {
  return Database.use((db) =>
    db.select().from(ObservabilityEventTable).where(eq(ObservabilityEventTable.session_id, sessionID)).all(),
  )
}

describe("session.llm observability wiring", () => {
  test("records started then finished sharing the same span, with tokens and no raw text", async () => {
    const server = state.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model

    waitRequest(
      "/chat/completions",
      new Response(createChatStream("the secret answer is 42"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(configWithObservability(providerID, server.url.origin, "local_metadata")))
      },
    })

    const sessionID = SessionID.make("session-observability-finished")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-observability-finished"),
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
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        await ObservabilityRuntime.service().flush()

        const rows = rowsForSession(sessionID)
        expect(rows).toHaveLength(2)

        const started = rows.find((r) => r.event_type === "llm.call.started")
        const finished = rows.find((r) => r.event_type === "llm.call.finished")
        expect(started).toBeDefined()
        expect(finished).toBeDefined()
        expect(started!.span_id).toBe(finished!.span_id)
        expect(started!.trace_id).toBe(finished!.trace_id)
        expect(finished!.status).toBe("finished")
        expect((finished!.metadata_json as any).outputTokens).toBeGreaterThan(0)
        expect(finished!.cost_nano_usd === null || finished!.cost_nano_usd! >= 0).toBe(true)

        const serialized = JSON.stringify(rows)
        expect(serialized).not.toContain("the secret answer is 42")
      },
    })
  })

  test("records failed with errorKind and HMAC gated to local_redacted, never raw error text", async () => {
    const server = state.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model
    const secretMarker = "unique-marker-leak-check-failed-9f2c"

    waitRequest(
      "/chat/completions",
      new Response(JSON.stringify({ error: { message: secretMarker, type: "invalid_request_error" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(configWithObservability(providerID, server.url.origin, "local_redacted")))
      },
    })

    const sessionID = SessionID.make("session-observability-failed")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-observability-failed"),
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
          system: ["You are a helpful assistant."],
          abort: new AbortController().signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        for await (const _ of stream.fullStream) {
        }

        await ObservabilityRuntime.service().flush()

        const rows = rowsForSession(sessionID)
        const failed = rows.find((r) => r.event_type === "llm.call.failed")
        expect(failed).toBeDefined()
        expect((failed!.metadata_json as any).errorKind).toBeDefined()
        expect((failed!.local_redacted_json as any).errorMessageHmac).toMatch(/^[0-9a-f]{64}$/)

        const serialized = JSON.stringify(rows)
        expect(serialized).not.toContain(secretMarker)
      },
    })
  })

  test("records aborted when the abort signal fires mid-stream", async () => {
    const server = state.server!
    const providerID = "alibaba"
    const modelID = "qwen-plus"
    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model
    const pending = waitStreamingRequest("/chat/completions")

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(configWithObservability(providerID, server.url.origin, "local_metadata")))
      },
    })

    const sessionID = SessionID.make("session-observability-aborted")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(model.id))
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info
        const user = {
          id: MessageID.make("user-observability-aborted"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
        } satisfies MessageV2.User

        const ctrl = new AbortController()
        const result = await LLM.stream({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          abort: ctrl.signal,
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        const iter = result.fullStream[Symbol.asyncIterator]()
        await pending.request
        await iter.next()
        ctrl.abort()
        // Keep pulling (rather than iter.return()) so the SDK's internal
        // pull() callback observes the abort and invokes onAbort before the
        // stream closes — matches how streamText's abort detection works.
        let step = await iter.next()
        while (!step.done) step = await iter.next()

        await ObservabilityRuntime.service().flush()

        const rows = rowsForSession(sessionID)
        const started = rows.find((r) => r.event_type === "llm.call.started")
        const aborted = rows.find((r) => r.event_type === "llm.call.aborted")
        expect(started).toBeDefined()
        expect(aborted).toBeDefined()
        expect(aborted!.span_id).toBe(started!.span_id)
        expect(aborted!.status).toBe("aborted")
      },
    })
  })
})
