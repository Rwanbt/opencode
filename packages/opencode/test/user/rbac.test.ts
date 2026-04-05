import { describe, it, expect } from "bun:test"
import { RBAC } from "../../src/user/rbac"

describe("RBAC", () => {
  const admin = { id: "usr_admin", role: "admin" as const }
  const member = { id: "usr_member", role: "member" as const }
  const viewer = { id: "usr_viewer", role: "viewer" as const }
  const basicAuth = { id: "basic-auth", role: "member" as const }

  it("admin can do everything", () => {
    expect(RBAC.can(admin, "session.create")).toBe(true)
    expect(RBAC.can(admin, "session.read")).toBe(true)
    expect(RBAC.can(admin, "session.write")).toBe(true)
    expect(RBAC.can(admin, "session.delete")).toBe(true)
    expect(RBAC.can(admin, "config.write")).toBe(true)
    expect(RBAC.can(admin, "user.manage")).toBe(true)
  })

  it("member can CRUD sessions", () => {
    expect(RBAC.can(member, "session.create")).toBe(true)
    expect(RBAC.can(member, "session.read")).toBe(true)
    expect(RBAC.can(member, "session.write")).toBe(true)
    expect(RBAC.can(member, "session.delete")).toBe(true)
  })

  it("member cannot manage config or users", () => {
    expect(RBAC.can(member, "config.write", { type: "config" })).toBe(false)
    expect(RBAC.can(member, "user.manage", { type: "user" })).toBe(false)
  })

  it("member cannot modify another user's session", () => {
    const resource = { type: "session" as const, ownerID: "usr_other" }
    expect(RBAC.can(member, "session.write", resource)).toBe(false)
    expect(RBAC.can(member, "session.delete", resource)).toBe(false)
  })

  it("member can read other user's sessions", () => {
    const resource = { type: "session" as const, ownerID: "usr_other" }
    expect(RBAC.can(member, "session.read", resource)).toBe(true)
  })

  it("viewer can only read and observe", () => {
    expect(RBAC.can(viewer, "session.read")).toBe(true)
    expect(RBAC.can(viewer, "session.observe")).toBe(true)
    expect(RBAC.can(viewer, "session.create")).toBe(false)
    expect(RBAC.can(viewer, "session.write")).toBe(false)
    expect(RBAC.can(viewer, "session.delete")).toBe(false)
  })

  it("viewer cannot read non-shared sessions from others", () => {
    const resource = { type: "session" as const, ownerID: "usr_other", shared: false }
    expect(RBAC.can(viewer, "session.read", resource)).toBe(false)
  })

  it("basic-auth acts as admin", () => {
    expect(RBAC.can(basicAuth, "session.create")).toBe(true)
    expect(RBAC.can(basicAuth, "config.write")).toBe(true)
    expect(RBAC.can(basicAuth, "user.manage")).toBe(true)
  })
})
