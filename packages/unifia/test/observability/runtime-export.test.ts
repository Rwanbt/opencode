import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ObservabilityRuntime } from "../../src/observability/runtime"
import { ObservabilityRepository } from "../../src/observability/repository"
import { parseObservabilityEvent } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"
import { tmpdir } from "../fixture/fixture"

// Phase 4 (ADR-1026) integration coverage: the export tick's cursor/backfill
// semantics and its interaction with a real (mocked) exporter — as opposed
// to export-runner.test.ts, which covers exportWithRetry's pure retry logic
// in isolation, and observability-exporters-routes.test.ts, which covers the
// HTTP surface.

function makeTerminalEvent(sessionId: string) {
  const parsed = parseObservabilityEvent({
    eventId: ObservabilityId.create(),
    context: createTraceContext({ sessionId }),
    type: "llm.call.finished",
    status: "finished",
    tsMs: Date.now(),
    durationMs: 42,
    enqueueSeq: 1,
  })
  if (!parsed.success) throw new Error("invalid fixture event: " + JSON.stringify(parsed.error))
  return parsed.data
}

function mockLangfuseServer(status = 200) {
  let calls = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      calls++
      return new Response("{}", { status })
    },
  })
  return { host: `http://127.0.0.1:${server.port}`, calls: () => calls, stop: () => server.stop(true) }
}

describe("observability export tick — cursor/backfill (Phase 4)", () => {
  test("default (backfillOnStart unset): events inserted before the first export tick are never exported, only later ones", async () => {
    const mock = mockLangfuseServer(200)
    try {
      await using tmp = await tmpdir({
        config: {
          experimental: {
            observability: {
              enabled: true,
              exporters: [{ type: "langfuse", host: mock.host, publicKey: "pk", secretKey: "sk" }],
            },
          },
        } as any,
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { Session } = await import("../../src/session")
          const session = await Session.create({})

          // Pre-existing event, inserted before any export tick has ever run.
          await ObservabilityRepository.insert([makeTerminalEvent(session.id)])

          await ObservabilityRuntime.runExportOnce()
          // First tick seeds the cursor at maxId() (no backfill) — the
          // pre-existing row above is older than or equal to that cursor,
          // so it must never be exported.
          expect(ObservabilityRuntime.exportStats()).toBeUndefined()
          expect(mock.calls()).toBe(0)

          // A NEW event inserted after the cursor was seeded must be exported.
          await ObservabilityRepository.insert([makeTerminalEvent(session.id)])
          await ObservabilityRuntime.runExportOnce()

          const stats = ObservabilityRuntime.exportStats()
          expect(stats).toBeDefined()
          expect(stats!.results).toEqual([{ exporter: "langfuse", ok: true, attempts: 1 }])
          expect(mock.calls()).toBe(1)
        },
      })
      await Instance.disposeDirectory(tmp.path)
    } finally {
      mock.stop()
    }
  })

  test("backfillOnStart: true exports the full pre-existing history on the first tick", async () => {
    const mock = mockLangfuseServer(200)
    try {
      await using tmp = await tmpdir({
        config: {
          experimental: {
            observability: {
              enabled: true,
              backfillOnStart: true,
              exporters: [{ type: "langfuse", host: mock.host, publicKey: "pk", secretKey: "sk" }],
            },
          },
        } as any,
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { Session } = await import("../../src/session")
          const session = await Session.create({})

          await ObservabilityRepository.insert([makeTerminalEvent(session.id), makeTerminalEvent(session.id)])

          await ObservabilityRuntime.runExportOnce()

          const stats = ObservabilityRuntime.exportStats()
          expect(stats).toBeDefined()
          expect(stats!.results).toEqual([{ exporter: "langfuse", ok: true, attempts: 1 }])
          expect(mock.calls()).toBe(1) // one batched call carrying both pre-existing events
        },
      })
      await Instance.disposeDirectory(tmp.path)
    } finally {
      mock.stop()
    }
  })

  test("no exporters configured: runExportOnce never calls fetch", async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      throw new Error("network access attempted with zero exporters configured")
    }) as unknown as typeof fetch
    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { Session } = await import("../../src/session")
          const session = await Session.create({})
          await ObservabilityRepository.insert([makeTerminalEvent(session.id)])

          await ObservabilityRuntime.runExportOnce()
          expect(ObservabilityRuntime.exportStats()).toBeUndefined()
          expect(fetchCalled).toBe(false)
        },
      })
      await Instance.disposeDirectory(tmp.path)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
