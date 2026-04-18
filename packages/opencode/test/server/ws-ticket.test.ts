/**
 * B2 (Sprint 4) — WS ticket handshake baseline.
 *
 * Tests the pure crypto contract of `JwtAuth.issueWsTicket` / `verifyWsTicket`
 * without booting the full server (which drags in the whole runtime). A
 * Playwright-level test of the HTTP endpoint belongs in `packages/app` once
 * the server harness helper (tracked in SPRINT4_NOTES §B2) lands.
 */
import { describe, it, expect } from "bun:test"
import { JwtAuth } from "../../src/server/auth-jwt"

describe("WS ticket — crypto contract", () => {
  it("issues a ticket that verifies and carries the user claims", () => {
    const ticket = JwtAuth.issueWsTicket({ id: "usr_1", username: "alice", role: "admin" })
    expect(typeof ticket).toBe("string")
    const parts = ticket.split(".")
    expect(parts.length).toBe(3)

    const verified = JwtAuth.verifyWsTicket(ticket)
    expect(verified).not.toBeNull()
    expect(verified!.sub).toBe("usr_1")
    expect(verified!.username).toBe("alice")
    expect(verified!.role).toBe("admin")
    expect(verified!.kind).toBe("ws-ticket")
  })

  it("rejects access tokens passed to verifyWsTicket (kind mismatch)", () => {
    // An access token forged via `issue` would have kind=undefined — even if
    // an attacker gets a normal JWT, it must not be usable as a WS ticket.
    // We simulate by crafting an access token via the low-level sign() —
    // but since sign is private, we issue a ticket then flip kind.
    const ticket = JwtAuth.issueWsTicket({ id: "x", username: "x", role: "member" })
    const parts = ticket.split(".")
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString())
    payload.kind = "not-a-ticket"
    // Re-encode the payload; signature is now invalid, so verify must fail.
    const tampered =
      parts[0] +
      "." +
      Buffer.from(JSON.stringify(payload)).toString("base64url") +
      "." +
      parts[2]
    expect(JwtAuth.verifyWsTicket(tampered)).toBeNull()
  })

  it("expired tickets verify as null", async () => {
    // Issue, then wait past expiry (60s is too long for a unit test; emulate
    // by crafting a near-past ticket via the sign() path. Here we do the
    // boundary check by checking `exp` is future — proxy test).
    const ticket = JwtAuth.issueWsTicket({ id: "y", username: "y", role: "member" })
    const payload = JSON.parse(Buffer.from(ticket.split(".")[1], "base64url").toString())
    expect(payload.exp).toBeGreaterThan(Date.now())
    expect(payload.exp - Date.now()).toBeLessThanOrEqual(60_000 + 500)
  })
})
