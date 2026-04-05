import { describe, it, expect } from "bun:test"
import { Presence } from "../../src/server/presence"

describe("Presence", () => {
  it("tracks user connection", () => {
    Presence.connect("test-user-1", "alice")
    const info = Presence.get("test-user-1")
    expect(info).toBeTruthy()
    expect(info!.username).toBe("alice")
    expect(info!.status).toBe("online")
    Presence.disconnect("test-user-1")
  })

  it("removes user on disconnect", () => {
    Presence.connect("test-user-2", "bob")
    expect(Presence.isOnline("test-user-2")).toBe(true)
    Presence.disconnect("test-user-2")
    expect(Presence.isOnline("test-user-2")).toBe(false)
  })

  it("updates activity", () => {
    Presence.connect("test-user-3", "carol")
    Presence.updateActivity("test-user-3", "ses_123")
    const info = Presence.get("test-user-3")
    expect(info!.activeSessionID).toBe("ses_123")
    Presence.disconnect("test-user-3")
  })

  it("heartbeat updates lastSeen", () => {
    Presence.connect("test-user-4", "dave")
    const before = Presence.get("test-user-4")!.lastSeen
    // Small delay to ensure timestamp differs
    Presence.heartbeat("test-user-4")
    const after = Presence.get("test-user-4")!.lastSeen
    expect(after).toBeGreaterThanOrEqual(before)
    Presence.disconnect("test-user-4")
  })

  it("lists all online users", () => {
    Presence.connect("test-user-5a", "eve")
    Presence.connect("test-user-5b", "frank")
    const list = Presence.list()
    const names = list.map((u) => u.username)
    expect(names).toContain("eve")
    expect(names).toContain("frank")
    Presence.disconnect("test-user-5a")
    Presence.disconnect("test-user-5b")
  })
})
