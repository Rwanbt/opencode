/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { PresentLinkSigner } from "../src/present-link.js"

describe("present link signer", () => {
  test("signs and verifies a token bound to one artifact and workspace", () => {
    const signer = new PresentLinkSigner("x".repeat(32), 1_000)
    const { token } = signer.sign("artifact-1", "workspace-1")
    const claims = signer.verify(token)
    expect(claims?.artifactId).toBe("artifact-1")
    expect(claims?.workspaceId).toBe("workspace-1")
  })

  test("expires after its ttl", () => {
    let now = 1_000
    const signer = new PresentLinkSigner("x".repeat(32), 100, () => now)
    const { token, expiresAt } = signer.sign("artifact-1", "workspace-1")
    expect(expiresAt).toBe(1_100)
    now = 1_099
    expect(signer.verify(token)).toBeDefined()
    now = 1_100
    expect(signer.verify(token)).toBeUndefined()
  })

  test("rejects a token signed with a different key", () => {
    const signerA = new PresentLinkSigner("a".repeat(32), 1_000)
    const signerB = new PresentLinkSigner("b".repeat(32), 1_000)
    const { token } = signerA.sign("artifact-1", "workspace-1")
    expect(signerB.verify(token)).toBeUndefined()
  })

  test("rejects a tampered payload (artifact id swapped)", () => {
    const signer = new PresentLinkSigner("x".repeat(32), 1_000)
    const { token } = signer.sign("artifact-1", "workspace-1")
    const [, signature] = token.split(".")
    const forgedPayload = Buffer.from(JSON.stringify({ artifactId: "artifact-2", workspaceId: "workspace-1", expiresAt: Date.now() + 10_000 })).toString("base64url")
    expect(signer.verify(`${forgedPayload}.${signature}`)).toBeUndefined()
  })

  test("rejects malformed tokens", () => {
    const signer = new PresentLinkSigner("x".repeat(32), 1_000)
    expect(signer.verify("not-a-token")).toBeUndefined()
    expect(signer.verify("a.b.c")).toBeUndefined()
    expect(signer.verify("")).toBeUndefined()
  })

  test("rejects a signing key shorter than 32 bytes", () => {
    expect(() => new PresentLinkSigner("short", 1_000)).toThrow("at least 32 bytes")
  })

  test("rejects a non-positive ttl", () => {
    expect(() => new PresentLinkSigner("x".repeat(32), 0)).toThrow("positive integer")
  })
})
