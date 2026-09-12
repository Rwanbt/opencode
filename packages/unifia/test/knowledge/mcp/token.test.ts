/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { McpTokenRegistry, McpTokenError } from "../../../src/knowledge/mcp/token.js"

describe("P9.2 MCP token registry", () => {
  it("issues a token with a non-empty id and the right workspace", () => {
    const reg = new McpTokenRegistry()
    const t = reg.issue({ workspace: "ws-1" })
    expect(t.id.length).toBeGreaterThan(0)
    expect(t.workspace).toBe("ws-1")
    expect(t.revokedAt).toBeNull()
  })

  it("isValid is true after issue and false after revoke", () => {
    const reg = new McpTokenRegistry()
    const t = reg.issue({ workspace: "ws-1" })
    expect(reg.isValid(t.id)).toBe(true)
    reg.revoke(t.id)
    expect(reg.isValid(t.id)).toBe(false)
  })

  it("isValid is false for an unknown token id", () => {
    const reg = new McpTokenRegistry()
    expect(reg.isValid("nope")).toBe(false)
  })

  it("refuses to issue a token for an empty workspace", () => {
    const reg = new McpTokenRegistry()
    expect(() => reg.issue({ workspace: "" })).toThrow(McpTokenError)
  })

  it("refuses to revoke an unknown token", () => {
    const reg = new McpTokenRegistry()
    expect(() => reg.revoke("nope")).toThrow(McpTokenError)
  })

  it("revoke is idempotent", () => {
    const reg = new McpTokenRegistry()
    const t = reg.issue({ workspace: "ws-1" })
    reg.revoke(t.id)
    reg.revoke(t.id) // must not throw
    expect(reg.isValid(t.id)).toBe(false)
  })

  it("isValid is false when the token is expired", () => {
    const reg = new McpTokenRegistry()
    const t = reg.issue({ workspace: "ws-1", ttlMs: 1_000 })
    // Move the clock forward by 2 seconds.
    expect(reg.isValid(t.id, Date.now() + 2_000)).toBe(false)
    // Within TTL: still valid.
    expect(reg.isValid(t.id, Date.now() + 500)).toBe(true)
  })

  it("countActive counts only non-revoked, non-expired tokens for a workspace", () => {
    const reg = new McpTokenRegistry()
    const t1 = reg.issue({ workspace: "ws-1" })
    const _t2 = reg.issue({ workspace: "ws-1" })
    const t3 = reg.issue({ workspace: "ws-2" })
    reg.revoke(t1.id)
    expect(reg.countActive("ws-1")).toBe(1)
    expect(reg.countActive("ws-2")).toBe(1)
    void _t2
    void t3
  })

  it("get returns the full token record", () => {
    const reg = new McpTokenRegistry()
    const t = reg.issue({ workspace: "ws-1", ttlMs: 60_000 })
    const got = reg.get(t.id)
    expect(got?.workspace).toBe("ws-1")
    expect(got?.expiresAt).not.toBeNull()
  })
})
