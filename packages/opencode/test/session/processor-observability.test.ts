import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import { tool } from "ai"
import z from "zod"
import { Agent as AgentSvc } from "../../src/agent/agent"
import type { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Snapshot } from "../../src/snapshot"
import { Log } from "../../src/util/log"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { ObservabilityRuntime } from "../../src/observability/runtime"
import { Database, eq } from "../../src/storage/db"
import { ObservabilityEventTable } from "../../src/observability/event.sql"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
  experimental: { observability: { enabled: true, captureMode: "local_redacted" as const } },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  LLM.defaultLayer,
  Provider.defaultLayer,
  status,
).pipe(Layer.provideMerge(infra))
const env = Layer.mergeAll(TestLLMServer.layer, SessionProcessor.layer.pipe(Layer.provideMerge(deps)))

const it = testEffect(env)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

function rowsForSession(sessionID: string) {
  return Database.use((db) =>
    db.select().from(ObservabilityEventTable).where(eq(ObservabilityEventTable.session_id, sessionID)).all(),
  )
}

const bashTool = (execute: () => Promise<{ output: string; title: string; metadata: Record<string, unknown> }>) =>
  tool({
    description: "run a shell command",
    inputSchema: z.object({ cmd: z.string() }),
    execute,
  })

it.live("session.processor observability records tool.call.started then finished, same span", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.tool("bash", { cmd: "pwd" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "run pwd")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "run pwd" }],
          tools: {
            bash: bashTool(async () => ({ output: "/home", title: "pwd", metadata: {} })),
          },
        })

        yield* Effect.promise(() => ObservabilityRuntime.service().flush())
        const rows = yield* Effect.sync(() => rowsForSession(chat.id))

        const started = rows.find((r) => r.event_type === "tool.call.started")
        const finished = rows.find((r) => r.event_type === "tool.call.finished")

        expect(value).toBe("continue")
        expect(started).toBeDefined()
        expect(finished).toBeDefined()
        expect(started!.span_id).toBe(finished!.span_id)
        expect(finished!.status).toBe("finished")
        expect((finished!.metadata_json as any).toolKind).toBe("bash")
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor observability records tool.call.failed when execute throws", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.tool("bash", { cmd: "rm -rf /" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "dangerous")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "dangerous" }],
          tools: {
            bash: bashTool(async () => {
              throw new Error("permission denied")
            }),
          },
        })

        yield* Effect.promise(() => ObservabilityRuntime.service().flush())
        const rows = yield* Effect.sync(() => rowsForSession(chat.id))

        const failed = rows.find((r) => r.event_type === "tool.call.failed")
        expect(failed).toBeDefined()
        expect((failed!.metadata_json as any).errorKind).toBeDefined()
        expect((failed!.metadata_json as any).toolKind).toBe("bash")

        const serialized = JSON.stringify(rows)
        expect(serialized).not.toContain("permission denied")
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor observability records tool.call.aborted for tools still open at cleanup", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.tool("bash", { cmd: "sleep 999" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hang")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        // Captured now, while the Instance ALS context is still valid — a
        // late child_process exit callback (git fixture teardown) can drop
        // ALS after Fiber.interrupt, so re-resolving the service afterwards
        // would throw "No context found for instance".
        const observabilityService = ObservabilityRuntime.service()

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "hang" }],
            tools: {
              bash: bashTool(() => new Promise(() => {})),
            },
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Effect.promise(async () => {
          const end = Date.now() + 500
          while (Date.now() < end) {
            const parts = await MessageV2.parts(msg.id)
            if (parts.some((part) => part.type === "tool" && part.state.status === "running")) return
            await Bun.sleep(10)
          }
        })
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
          yield* handle.abort()
        }

        yield* Effect.promise(() => observabilityService.flush())
        const rows = yield* Effect.sync(() => rowsForSession(chat.id))

        const started = rows.find((r) => r.event_type === "tool.call.started")
        const aborted = rows.find((r) => r.event_type === "tool.call.aborted")

        expect(started).toBeDefined()
        expect(aborted).toBeDefined()
        expect(aborted!.span_id).toBe(started!.span_id)
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)
