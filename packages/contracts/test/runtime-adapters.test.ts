/* SPDX-License-Identifier: MIT */

import { describe, expect, it, vi } from "vitest"
import { FakeRuntimeAdapter, OpenCodeRuntimeAdapter, UnifiaRuntimeAdapter, type OpenCodeRuntimeBackend } from "../src/runtime-adapters"

describe("FakeRuntimeAdapter.onSessionCreated (E13)", () => {
  it("fires the callback for every createSession in the workspace", async () => {
    const runtime = new FakeRuntimeAdapter(() => 1)
    const seen: string[] = []
    runtime.onSessionCreated({ workspaceId: "ws-1" }, (session) => seen.push(session.id))
    await runtime.createSession({ workspaceId: "ws-1" })
    await runtime.createSession({ workspaceId: "ws-1" })
    expect(seen).toEqual(["fake-session-1", "fake-session-2"])
  })

  it("does NOT fire the callback for sessions created in another workspace", async () => {
    const runtime = new FakeRuntimeAdapter(() => 1)
    const seen: string[] = []
    runtime.onSessionCreated({ workspaceId: "ws-1" }, (session) => seen.push(session.id))
    await runtime.createSession({ workspaceId: "ws-2" })
    await runtime.createSession({ workspaceId: "ws-1" })
    expect(seen).toEqual(["fake-session-2"])
  })

  it("unsubscribe() stops future emissions", async () => {
    const runtime = new FakeRuntimeAdapter(() => 1)
    const seen: string[] = []
    const unsubscribe = runtime.onSessionCreated({ workspaceId: "ws-1" }, (session) => seen.push(session.id))
    await runtime.createSession({ workspaceId: "ws-1" })
    unsubscribe()
    await runtime.createSession({ workspaceId: "ws-1" })
    expect(seen).toEqual(["fake-session-1"])
  })

  it("supports multiple subscribers per workspace (all called per createSession)", async () => {
    const runtime = new FakeRuntimeAdapter(() => 1)
    const a: string[] = []
    const b: string[] = []
    runtime.onSessionCreated({ workspaceId: "ws-1" }, (session) => a.push(session.id))
    runtime.onSessionCreated({ workspaceId: "ws-1" }, (session) => b.push(session.id))
    await runtime.createSession({ workspaceId: "ws-1" })
    expect(a).toEqual(["fake-session-1"])
    expect(b).toEqual(["fake-session-1"])
  })

  it("does not abort createSession when a listener throws", async () => {
    // WHY: a faulty listener must not break session creation — the
    // push hook is best-effort, the create path is not. A real
    // adapter would log structured; the fake uses console.warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const runtime = new FakeRuntimeAdapter(() => 1)
      runtime.onSessionCreated({ workspaceId: "ws-1" }, () => { throw new Error("boom") })
      const session = await runtime.createSession({ workspaceId: "ws-1" })
      expect(session.workspaceId).toBe("ws-1")
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("OpenCodeRuntimeAdapter.onSessionCreated (E13)", () => {
  it("delegates to backend.onSessionCreated when the backend implements it", () => {
    const unsubscribe = vi.fn()
    const callback = vi.fn()
    const backend: OpenCodeRuntimeBackend = {
      listSessions: async () => [],
      createSession: async () => ({ id: "x", workspaceId: "ws-1", runtimeId: "opencode" as const, createdAt: 0, messageCount: 0 }),
      sendPrompt: async () => {},
      subscribeEvents: () => ({ [Symbol.asyncIterator]: async function* () {} }),
      cancelSession: async () => {},
      onSessionCreated: vi.fn(() => unsubscribe),
    }
    const runtime = new OpenCodeRuntimeAdapter(backend)
    const result = runtime.onSessionCreated({ workspaceId: "ws-1" }, callback)
    expect(backend.onSessionCreated).toHaveBeenCalledWith("ws-1", callback)
    expect(result).toBe(unsubscribe)
  })

  it("returns a no-op unsubscribe when the backend has no onSessionCreated (pre-E13i backends)", () => {
    const backend: OpenCodeRuntimeBackend = {
      listSessions: async () => [],
      createSession: async () => ({ id: "x", workspaceId: "ws-1", runtimeId: "opencode" as const, createdAt: 0, messageCount: 0 }),
      sendPrompt: async () => {},
      subscribeEvents: () => ({ [Symbol.asyncIterator]: async function* () {} }),
      cancelSession: async () => {},
    }
    const runtime = new OpenCodeRuntimeAdapter(backend)
    let called = false
    const result = runtime.onSessionCreated({ workspaceId: "ws-1" }, () => { called = true })
    // Calling the returned unsubscribe must be a no-op (no throw).
    result()
    expect(called).toBe(false)  // backend had no hook, callback never registered
  })
})

describe("UnifiaRuntimeAdapter.onSessionCreated (E13)", () => {
  it("delegates to backend.onSessionCreated when implemented", () => {
    const unsubscribe = vi.fn()
    const callback = vi.fn()
    const backend = {
      listSessions: async () => [],
      createSession: async () => ({ id: "x", workspaceId: "ws-1", runtimeId: "unifia" as const, createdAt: 0, messageCount: 0 }),
      sendPrompt: async () => {},
      subscribeEvents: () => ({ [Symbol.asyncIterator]: async function* () {} }),
      cancelSession: async () => {},
      onSessionCreated: vi.fn(() => unsubscribe),
    }
    const runtime = new UnifiaRuntimeAdapter(backend)
    const result = runtime.onSessionCreated({ workspaceId: "ws-1" }, callback)
    expect(backend.onSessionCreated).toHaveBeenCalledWith("ws-1", callback)
    expect(result).toBe(unsubscribe)
  })
})
