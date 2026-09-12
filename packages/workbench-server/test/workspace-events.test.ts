/* SPDX-License-Identifier: MIT */
import { test, expect, describe } from "bun:test"
import { sseFrame, workspaceEventFrame, createPollingFallback } from "../src/workspace-events.js"
import { parseWorkspaceEvent, type WorkspaceEvent } from "@unifia/contracts/workbench-wire"
import type { RuntimeAdapter, Session } from "@unifia/contracts"

describe("sseFrame (E10)", () => {
  test("event with sequence includes id line", () => {
    const out = sseFrame({ sequence: 42, type: "ping" } as { sequence?: number })
    expect(out).toBe('id: 42\ndata: {"sequence":42,"type":"ping"}\n\n')
  })

  test("event without sequence omits id line (preserves Last-Event-ID cursor)", () => {
    const out = sseFrame({ type: "ping" } as { sequence?: number })
    expect(out).toBe('data: {"type":"ping"}\n\n')
  })

  test("event with sequence=0 still emits the id line (explicit zero)", () => {
    const out = sseFrame({ sequence: 0, type: "ping" } as { sequence?: number })
    expect(out).toBe('id: 0\ndata: {"sequence":0,"type":"ping"}\n\n')
  })

  test("frame ends with a blank line (SSE record separator)", () => {
    const out = sseFrame({ type: "ping" } as { sequence?: number })
    expect(out.endsWith("\n\n")).toBe(true)
  })

  test("nested event payloads are JSON-serialised", () => {
    const out = sseFrame({ sequence: 1, payload: { a: [1, 2, { b: "x" }] } } as { sequence?: number })
    expect(out).toBe('id: 1\ndata: {"sequence":1,"payload":{"a":[1,2,{"b":"x"}]}}\n\n')
  })
})

describe("workspaceEventFrame (E11)", () => {
  test("preserves a mutation event's resource field through SSE framing", () => {
    // WHY: E11's contract is Â« chaque mutation produit une ressource/ID Â».
    // The frame helper must serialise the resource byte-for-byte so the
    // client's eventâ†’query key map (E12) can scope the refetch to
    // `event.resource.id`. Dropping the field here would silently break
    // the invalidation map.
    const event = parseWorkspaceEvent({
      eventId: "ev-1",
      workspaceId: "ws-1",
      sequenceId: 7,
      cursor: "opaque-7",
      type: "operation.updated",
      payload: { state: "running" },
      resource: { type: "operation", id: "op-42" },
    })
    const out = workspaceEventFrame(event)
    expect(out).toContain('"sequenceId":7')
    expect(out).toContain('"resource":{"type":"operation","id":"op-42"}')
    expect(out.startsWith("id: 7\n")).toBe(true)
  })

  test("emits id: line for every WorkspaceEvent (sequenceId is required)", () => {
    // WHY: the SSE Last-Event-ID cursor relies on a non-empty id line.
    // A parser that swallowed sequenceId would break reconnect replay
    // and the client's gap detection (sequenceId > lastSequence + 1).
    const event = parseWorkspaceEvent({
      eventId: "ev-2",
      workspaceId: "ws-1",
      sequenceId: 0,
      cursor: "opaque-0",
      type: "trace.appended",
      payload: { line: "x" },
    }) satisfies WorkspaceEvent
    const out = workspaceEventFrame(event)
    expect(out.startsWith("id: 0\n")).toBe(true)
    expect(out.endsWith("\n\n")).toBe(true)
  })
})

/**
 * E13i polling-fallback test harness. We inject a stub runtime that
 * returns the next batch on each listSessions call, and we drive the
 * fallback synchronously by replacing setTimeout with a manual stepper
 * that fires each scheduled tick in order. This removes real wall-clock
 * dependence and keeps the tests deterministic.
 */
type StubRuntime = {
  listSessionsCalls: number
  nextBatch: () => readonly Session[] | Promise<readonly Session[]>
} & Pick<RuntimeAdapter, "listSessions">

function makeRuntime(firstBatch: readonly Session[][], errors: Error[] = []): StubRuntime {
  let i = 0
  let errIdx = 0
  return {
    listSessionsCalls: 0,
    nextBatch: () => firstBatch[i++] ?? [],
    async listSessions(_scope) {
      this.listSessionsCalls += 1
      if (errIdx < errors.length) throw errors[errIdx++]
      return [...(await this.nextBatch())]
    },
  } as StubRuntime
}

function session(id: string, workspaceId = "ws-1"): Session {
  return { id, workspaceId, runtimeId: "fake", createdAt: 0, messageCount: 0 }
}

describe("createPollingFallback (E13i bounded fallback)", () => {
  test("fires onSession for every new session, then stops emitting once known", async () => {
    const runtime = makeRuntime([
      [session("s-1")],
      [session("s-1"), session("s-2")],  // s-1 already known, s-2 new
      [session("s-1"), session("s-2")],  // both known, empty tick
    ])
    const seen: string[] = []
    let handle: ReturnType<typeof setTimeout> | undefined
    const scheduled: Array<() => void> = []
    const fallback = createPollingFallback(runtime as unknown as RuntimeAdapter, { workspaceId: "ws-1" }, (s) => seen.push(s.id), {
      setTimeoutFn: (cb) => { handle = setTimeout(cb, 0); scheduled.push(() => handle !== undefined && clearTimeout(handle)); return handle },
      clearTimeoutFn: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      logger: { warn: () => undefined },
    })
    // Drain three ticks manually.
    await new Promise<void>((r) => setTimeout(r, 5))
    for (let i = 0; i < 3; i += 1) {
      // The handle is the latest scheduled tick; trigger it.
      await new Promise<void>((r) => setTimeout(r, 5))
    }
    fallback.stop()
    expect(seen).toEqual(["s-1", "s-2"])
    const s = fallback.stats()
    expect(s.ticks).toBeGreaterThanOrEqual(1)
    expect(s.productive).toBeGreaterThanOrEqual(2)
    expect(runtime.listSessionsCalls).toBeGreaterThanOrEqual(1)
  })

  test("stop() is idempotent and releases the timer", () => {
    const runtime = makeRuntime([[]])
    const fallback = createPollingFallback(runtime as unknown as RuntimeAdapter, { workspaceId: "ws-1" }, () => undefined, {
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
      logger: { warn: () => undefined },
    })
    fallback.stop()
    expect(() => fallback.stop()).not.toThrow()
  })

  test("a listSessions error is logged (NOT swallowed) and counted in stats.errors", async () => {
    const err = new Error("runtime offline")
    const runtime = makeRuntime([[]], [err])
    const warnings: Array<{ msg: string; reason: unknown }> = []
    const fallback = createPollingFallback(runtime as unknown as RuntimeAdapter, { workspaceId: "ws-1" }, () => undefined, {
      setTimeoutFn: (cb) => setTimeout(cb, 0),
      clearTimeoutFn: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      logger: { warn: (msg, reason) => warnings.push({ msg, reason }) },
    })
    // Wait for the first tick to complete and the error to be logged.
    await new Promise<void>((r) => setTimeout(r, 20))
    fallback.stop()
    const stats = fallback.stats()
    expect(stats.errors).toBe(1)
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0].msg).toMatch(/listSessions failed/)
  })
})
