/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { ScopedTokenIssuer } from "../src/auth.js"

describe("scoped native token issuer", () => {
  test("issues a token bound to workspace and instance", () => {
    let now = 1_000
    const issuer = new ScopedTokenIssuer("x".repeat(32), 100, 30, () => now)
    const issued = issuer.issue({ principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: ["workspace.read"] })
    expect(issuer.verify(issued.token)?.workspaceId).toBe("workspace")
    expect(issuer.verify(issued.token)?.instanceId).toBe("instance")
    expect(issuer.verify(issued.token)?.capabilities).toEqual(["workspace.read"])
    now = 1_100
    expect(issuer.verify(issued.token)).toBeUndefined()
  })

  test("accepts the previous token only during rotation grace", () => {
    let now = 1_000
    const issuer = new ScopedTokenIssuer("x".repeat(32), 1_000, 30, () => now)
    const first = issuer.issue({ principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: [] })
    const rotated = issuer.rotate({ principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: ["workspace.read"] })
    expect(rotated.previousToken).toBe(first.token)
    expect(issuer.verify(first.token)?.tokenId).toBe(first.tokenId)
    now += 31
    expect(issuer.verify(first.token)).toBeUndefined()
    expect(issuer.verify(rotated.token.token)).toBeDefined()
  })

  test("revokes current and previous tokens when a scope closes", () => {
    const issuer = new ScopedTokenIssuer("x".repeat(32), 1_000, 30)
    const request = { principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: [] as const }
    const first = issuer.issue(request)
    const rotated = issuer.rotate(request)
    issuer.revoke(request)
    expect(issuer.verify(first.token)).toBeUndefined()
    expect(issuer.verify(rotated.token.token)).toBeUndefined()
  })
})
