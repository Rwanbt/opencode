import { describe, expect, test } from "bun:test"
import path from "node:path"
import { ObservabilityService } from "../../src/observability/service"
import { ObservabilityRepository } from "../../src/observability/repository"
import { ObservabilityEventTable } from "../../src/observability/event.sql"
import { EventTypeSchema, MetadataSchema } from "../../src/observability/event-schema"
import { createTraceContext } from "../../src/observability/trace-context"
import { ObservabilityId } from "../../src/observability/id"
import { Database, eq, inArray } from "../../src/storage/db"

// P0 resilience/privacy tests that don't fit the per-caller test files
// (llm-observability.test.ts, processor-observability.test.ts). See
// PLAN-Native-Observability-V3-2026-07-10.md P0 test matrix.

describe("observability concurrency: 100 sessions x 100 events, no cross-contamination", () => {
  test("every event lands under its own session, none swapped/lost/duplicated", async () => {
    const service = new ObservabilityService(ObservabilityRepository)
    const SESSIONS = 100
    const EVENTS_PER_SESSION = 100
    const prefix = "concurrency-test-" + ObservabilityId.create()
    const sessionIds = Array.from({ length: SESSIONS }, (_, i) => `${prefix}-s${i}`)

    // Round-robin across sessions (not grouped session-by-session) to
    // maximize the chance any shared/leaking mutable state would
    // misattribute an event to the wrong session. record() is synchronous
    // (service.ts: no I/O, just BoundedEventQueue.enqueue) so "concurrent"
    // here means densely interleaved calls, not parallel threads — Bun/JS
    // has no real thread parallelism to race against.
    for (let e = 0; e < EVENTS_PER_SESSION; e++) {
      for (let s = 0; s < SESSIONS; s++) {
        const result = service.record(createTraceContext({ sessionId: sessionIds[s] }), {
          type: "llm.call.started",
          status: "started",
          tsMs: Date.now(),
          metadata: { modelId: `sess:${s}:evt:${e}` },
        })
        expect(result.ok).toBe(true)
      }
      // Drain every round to stay well under the 500-event/64MiB queue cap
      // (queue.ts) — this test asserts exact per-session counts, so queue
      // overflow drops (expected priority-aware behavior under real
      // pressure) would be noise here, not signal.
      await service.flush(SESSIONS * 2)
    }
    await service.flush(SESSIONS * EVENTS_PER_SESSION)

    const rows = Database.use((db) =>
      db.select().from(ObservabilityEventTable).where(inArray(ObservabilityEventTable.session_id, sessionIds)).all(),
    )
    expect(rows).toHaveLength(SESSIONS * EVENTS_PER_SESSION)

    const countBySession = new Map<string, number>()
    for (const row of rows) {
      const meta = row.metadata_json as { modelId?: string }
      const match = /^sess:(\d+):evt:(\d+)$/.exec(meta.modelId ?? "")
      expect(match).not.toBeNull()
      const sessionIndex = Number(match![1])
      // The core contamination check: the embedded marker (written at
      // enqueue time) must match the DB column the row actually landed in.
      expect(row.session_id).toBe(sessionIds[sessionIndex])
      countBySession.set(row.session_id!, (countBySession.get(row.session_id!) ?? 0) + 1)
    }
    expect(countBySession.size).toBe(SESSIONS)
    for (const count of countBySession.values()) expect(count).toBe(EVENTS_PER_SESSION)
  })
})

describe("observability no-network", () => {
  test("record()+flush() never calls fetch", async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalled = true
      throw new Error("network access attempted during observability pipeline: " + JSON.stringify(args))
    }) as unknown as typeof fetch
    try {
      const rows: unknown[] = []
      const service = new ObservabilityService({ insert: async (events) => void rows.push(...events) })
      const result = service.record(createTraceContext({ sessionId: "no-network-test" }), {
        type: "llm.call.started",
        status: "started",
        tsMs: Date.now(),
      })
      expect(result.ok).toBe(true)
      await service.flush()
      expect(rows).toHaveLength(1)
      expect(fetchCalled).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("no observability pipeline module imports a network client", async () => {
    // crash-reporter.ts is excluded on purpose: it does call fetch(), but
    // it is strictly opt-in (only fires if experimental.crash.upload_endpoint
    // is explicitly configured) and outside the record()/flush()/repository
    // pipeline this test suite covers — see crash-reporter.ts's own guard.
    const dir = path.join(import.meta.dir, "../../src/observability")
    const glob = new Bun.Glob("*.ts")
    const forbidden = /\bfetch\(|from\s+["'](?:http|https|net|undici|node-fetch)["']/
    for await (const file of glob.scan({ cwd: dir })) {
      if (file === "crash-reporter.ts" || file.endsWith(".test.ts")) continue
      const content = await Bun.file(path.join(dir, file)).text()
      expect(content).not.toMatch(forbidden)
    }
  })
})

describe("observability privacy boundary: metadata allow-list", () => {
  test("record() rejects any metadata field outside the schema's allow-list", () => {
    const service = new ObservabilityService({ insert: async () => {} })
    const hostileFields = ["rawPrompt", "rawResponse", "content", "text", "message", "stackTrace", "url", "filePath"]
    for (const field of hostileFields) {
      const result = service.record(createTraceContext({ sessionId: "hostile-metadata-test" }), {
        type: "llm.call.started",
        status: "started",
        tsMs: Date.now(),
        metadata: { [field]: "definitely-secret-content-that-must-never-be-stored" } as any,
      })
      expect(result).toEqual({ ok: false, reason: "invalid_event" })
    }
  })

  test("every event type round-trips with metadata keys limited to the schema's allow-list", async () => {
    const allowedKeys = new Set(Object.keys(MetadataSchema.shape))
    const service = new ObservabilityService(ObservabilityRepository)
    const sessionId = "schema-roundtrip-test-" + ObservabilityId.create()

    for (const type of EventTypeSchema.options) {
      if (type === "observability.write.dropped") continue // no started/terminal status pairing to build generically
      const status = type.endsWith(".started")
        ? "started"
        : type.endsWith(".finished")
          ? "finished"
          : type.endsWith(".failed")
            ? "failed"
            : "aborted"
      const result = service.record(createTraceContext({ sessionId }), {
        type,
        status,
        tsMs: Date.now(),
        durationMs: status === "started" ? undefined : 1,
      })
      expect(result.ok).toBe(true)
    }
    await service.flush(20)

    const rows = Database.use((db) =>
      db.select().from(ObservabilityEventTable).where(eq(ObservabilityEventTable.session_id, sessionId)).all(),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const keys = Object.keys(row.metadata_json as Record<string, unknown>)
      for (const key of keys) expect(allowedKeys.has(key)).toBe(true)
    }
  })
})
