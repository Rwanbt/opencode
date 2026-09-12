import { describe, expect, test } from "bun:test"
import { TeamRunRegistry } from "../../src/team/run-registry"

describe("TeamRunRegistry", () => {
  test("pauses at a cooperative boundary and resumes", async () => {
    const registry = new TeamRunRegistry()
    const control = registry.register("run-pause")
    expect(registry.pause("run-pause")).toBe(true)
    let released = false
    const waiting = control.waitUntilRunnable().then(() => { released = true })
    await Promise.resolve()
    expect(released).toBe(false)
    expect(registry.resume("run-pause")).toBe(true)
    await waiting
    expect(released).toBe(true)
    registry.finish("run-pause")
  })

  test("propagates parent cancellation", () => {
    const registry = new TeamRunRegistry()
    const parent = new AbortController()
    const control = registry.register("run-cancel", parent.signal)
    parent.abort()
    expect(control.signal.aborted).toBe(true)
    expect(registry.status("run-cancel")).toBe("cancelled")
    registry.finish("run-cancel", parent.signal)
  })

  test("refuses duplicate active run IDs", () => {
    const registry = new TeamRunRegistry()
    registry.register("run-duplicate")
    expect(() => registry.register("run-duplicate")).toThrow("already active")
    registry.finish("run-duplicate")
  })
})
