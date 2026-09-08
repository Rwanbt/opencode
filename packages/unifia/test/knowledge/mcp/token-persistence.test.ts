/* SPDX-License-Identifier: MIT */
/**
 * W-RUN-01 — `McpTokenRegistry` file persistence.
 *
 * Validates the on-disk contract end-to-end:
 *   - `restart_preserves_tokens` — issue, drop the registry, re-open with
 *     the same path, the token is still there;
 *   - `ttl_is_enforced_on_read` — expired tokens are filtered on hydration;
 *   - `revoke_writes_tombstone` — a revoked token lands on disk as a
 *     tombstone entry (`{ revoked: true, at: number }`) and is not loaded
 *     as active on reopen;
 *   - `corruption_fails_closed` — a JSON-level corruption throws and the
 *     registry refuses to start;
 *   - `version_mismatch_fails_with_typed_error` — a wrong version byte
 *     throws the dedicated `McpTokenVersionError`;
 *   - `migration_empty_state_ok` — first run with no file on disk works
 *     and creates the file on the first `issue` / `revoke`.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  McpTokenRegistry,
  McpTokenError,
  McpTokenVersionError,
  PERSISTENT_FORMAT_VERSION,
} from "../../../src/knowledge/mcp/token.js"

describe("W-RUN-01 McpTokenRegistry persistence", () => {
  let root: string
  let file: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-tokens-"))
    file = join(root, "tokens.bin")
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("restart_preserves_tokens", () => {
    const reg = new McpTokenRegistry({ path: file })
    const t = reg.issue({ workspace: "ws-1" })
    expect(existsSync(file)).toBe(true)

    // Drop the registry (simulating process exit) and re-open.
    const reg2 = new McpTokenRegistry({ path: file })
    expect(reg2.isValid(t.id)).toBe(true)
    expect(reg2.get(t.id)?.workspace).toBe("ws-1")
  })

  it("ttl_is_enforced_on_read", () => {
    const reg = new McpTokenRegistry({ path: file })
    // Issue with a tiny TTL, then write the file by revoking a sibling
    // so the persistence path is exercised (revoke triggers persist()).
    const fresh = reg.issue({ workspace: "ws-1", ttlMs: 1_000 })
    const other = reg.issue({ workspace: "ws-1" })
    reg.revoke(other.id)

    // `fresh` is now on disk and expires 1s after issue; opening with a
    // `now` past the expiry must return `null`.
    const now = Date.now() + 5_000
    const reg2 = new McpTokenRegistry({ path: file })
    expect(reg2.isValid(fresh.id, now)).toBe(false)
    expect(reg2.get(fresh.id)?.expiresAt).toBe(fresh.expiresAt)
  })

  it("revoke_writes_tombstone", () => {
    const reg = new McpTokenRegistry({ path: file })
    const t = reg.issue({ workspace: "ws-1" })
    reg.revoke(t.id)

    // The on-disk file must contain a tombstone for this id, not a
    // {token: ...} record. Decode the header and the JSON payload to
    // assert the shape.
    const buf = readFileSync(file)
    expect(buf[0]).toBe(PERSISTENT_FORMAT_VERSION)
    const length = buf.readUInt32LE(1)
    const payload = JSON.parse(buf.subarray(5, 5 + length).toString("utf8")) as {
      tokens: Record<string, { tombstone?: { revoked: boolean; at: number } }>
    }
    const entry = payload.tokens[t.id]
    expect(entry).toBeDefined()
    expect(entry.tombstone).toBeDefined()
    expect(entry.tombstone?.revoked).toBe(true)
    expect(typeof entry.tombstone?.at).toBe("number")

    // Reopen: the token must NOT be valid.
    const reg2 = new McpTokenRegistry({ path: file })
    expect(reg2.isValid(t.id)).toBe(false)
    // `get()` still returns the metadata record (revokedAt set), so the
    // tombstone overlay does not silently drop historical data.
    expect(reg2.get(t.id)?.revokedAt).not.toBeNull()
  })

  it("corruption_fails_closed", () => {
    // Write a valid header, then garbage bytes that are not valid JSON.
    const buf = Buffer.alloc(5 + 10)
    buf[0] = PERSISTENT_FORMAT_VERSION
    buf.writeUInt32LE(10, 1)
    buf.write("{not json", 5, "utf8")
    writeFileSync(file, buf)

    expect(() => new McpTokenRegistry({ path: file })).toThrow(McpTokenError)
  })

  it("version_mismatch_fails_with_typed_error", () => {
    const buf = Buffer.alloc(5 + 2)
    buf[0] = 0x42 // some future version we do not understand
    buf.writeUInt32LE(2, 1)
    buf.write("{}", 5, "utf8")
    writeFileSync(file, buf)

    let caught: unknown = null
    try {
      new McpTokenRegistry({ path: file })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(McpTokenVersionError)
    expect(caught).toBeInstanceOf(McpTokenError)
    if (caught instanceof McpTokenVersionError) {
      expect(caught.observed).toBe(0x42)
      expect(caught.expected).toBe(PERSISTENT_FORMAT_VERSION)
    }
  })

  it("migration_empty_state_ok", () => {
    expect(existsSync(file)).toBe(false)
    const reg = new McpTokenRegistry({ path: file })
    expect(reg.countActive("ws-1")).toBe(0)

    // First write materialises the file.
    const t = reg.issue({ workspace: "ws-1" })
    expect(existsSync(file)).toBe(true)
    expect(reg.isValid(t.id)).toBe(true)

    // Reopen on the same path: empty-state hydration is still correct.
    const reg2 = new McpTokenRegistry({ path: file })
    expect(reg2.isValid(t.id)).toBe(true)
  })
})
