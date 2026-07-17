import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadOrCreateSecret, secretPath } from "../../src/observability/hmac-secret"
import { hmacSha256 } from "../../src/observability/hmac"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("observability local HMAC secret", () => {
  test("is stable and produces a SHA-256 HMAC", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-observability-"))
    roots.push(root)
    const first = await loadOrCreateSecret(root)
    const second = await loadOrCreateSecret(root)
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
    expect(hmacSha256(first, "session-1")).toMatch(/^[0-9a-f]{64}$/)
    expect(secretPath(root)).toContain("observability_hmac.key")
  })
})
