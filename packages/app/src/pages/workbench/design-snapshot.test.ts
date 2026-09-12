/* SPDX-License-Identifier: MIT */

import { expect, test, describe } from "bun:test"
import { createDesignSnapshot } from "./design-snapshot"

function makeController() {
  return createDesignSnapshot({
    blobFromDataUrl: async () => new Blob(["x"], { type: "image/png" }),
    writeClipboard: async () => undefined,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => undefined,
  })
}

describe("F11 — createDesignSnapshot (extracted Design responsibility)", () => {
  test("starts in idle state", () => {
    const c = makeController()
    expect(c.snapshot().kind).toBe("idle")
  })

  test("requestSnapshot() with no capture mounted transitions to error", () => {
    // WHY: the toolbar may fire before the iframe mounts (cold start).
    // The state machine must report a NAMED error so the UI can show
    // «Preview not ready» instead of a silent "capturing…" spinner.
    const c = makeController()
    c.requestSnapshot()
    expect(c.snapshot()).toEqual({ kind: "error", error: "preview-not-mounted" })
  })

  test("setCapture() + requestSnapshot() drives the idle→capturing→ready transition", async () => {
    const c = makeController()
    c.setCapture(async () => ({ dataUrl: "data:image/png;base64,AAA", w: 100, h: 50 }))
    c.requestSnapshot()
    expect(c.snapshot().kind).toBe("capturing")
    // Let the microtask resolve
    await Promise.resolve()
    await Promise.resolve()
    const snap = c.snapshot()
    expect(snap.kind).toBe("ready")
    if (snap.kind === "ready") {
      expect(snap.dataUrl).toBe("data:image/png;base64,AAA")
      expect(snap.w).toBe(100)
      expect(snap.h).toBe(50)
    }
  })

  test("a capture that throws surfaces the error message verbatim", async () => {
    const c = makeController()
    c.setCapture(async () => { throw new Error("render-timeout") })
    c.requestSnapshot()
    await Promise.resolve()
    await Promise.resolve()
    expect(c.snapshot()).toEqual({ kind: "error", error: "render-timeout" })
  })

  test("a second requestSnapshot() while capturing is a no-op (no double-fire)", () => {
    let calls = 0
    const c = createDesignSnapshot({
      blobFromDataUrl: async () => new Blob(["x"]),
      writeClipboard: async () => undefined,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    })
    c.setCapture(() => { calls += 1; return new Promise(() => { /* never resolves */ }) })
    c.requestSnapshot()
    c.requestSnapshot()
    expect(calls).toBe(1)
  })

  test("copySnapshot() refuses unless the snapshot is ready", async () => {
    const c = makeController()
    await c.copySnapshot()
    expect(c.copyState()).toBe("idle")  // nothing to copy yet
  })

  test("copySnapshot() drives idle→copying→copied then schedules a reset to idle", async () => {
    const writes: Blob[] = []
    let scheduledReset: (() => void) | undefined
    const c = createDesignSnapshot({
      blobFromDataUrl: async () => new Blob(["hello"], { type: "image/png" }),
      writeClipboard: async (blob) => { writes.push(blob) },
      setTimeoutFn: (cb) => { scheduledReset = cb; return 0 },
      clearTimeoutFn: () => undefined,
    })
    c.setCapture(async () => ({ dataUrl: "data:image/png;base64,AAA", w: 10, h: 10 }))
    c.requestSnapshot()
    await Promise.resolve()
    await Promise.resolve()
    await c.copySnapshot()
    expect(c.copyState()).toBe("copied")
    expect(writes.length).toBe(1)
    expect(scheduledReset).toBeDefined()
    scheduledReset!()
    expect(c.copyState()).toBe("idle")
  })
})
