/* SPDX-License-Identifier: MIT */
/**
 * MCP daemon over a real transport (card C26).
 *
 * composeMcpServer() produced an authenticated server that nothing exposed,
 * and a token lived only as long as the process that issued it. These tests
 * drive the daemon over the loopback transport pair, so a token issued at
 * startup has to survive every call that follows.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createLoopbackPair,
  JSON_RPC_ERRORS,
  type JsonRpcMessage,
  type MessageTransport,
} from "@unifia/mcp-transport"
import { serveMcp } from "../../../src/knowledge/mcp/serve.js"
import { writePolicy, DEFAULT_POLICY } from "../../../src/knowledge/policy/store.js"
import { CONTROL_LOG_FILE } from "../../../src/knowledge/policy/control-log.js"

function note(id: string, body: string, restrictions?: string[]) {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-08-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-29T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    ...(restrictions ? ["unifia_restrictions:", ...restrictions] : []),
    "---",
    body,
  ].join("\n")
}

/** Send one request and await its response. */
async function call(
  client: MessageTransport,
  responses: AsyncIterator<JsonRpcMessage>,
  id: number,
  method: string,
  params: unknown,
): Promise<JsonRpcMessage> {
  await client.send({ jsonrpc: "2.0", id, method, params } as JsonRpcMessage)
  const next = await responses.next()
  return next.value as JsonRpcMessage
}

describe("C26 — the MCP daemon answers over a transport", () => {
  let root: string
  let client: MessageTransport
  let server: MessageTransport
  let handle: ReturnType<typeof serveMcp>
  let responses: AsyncIterator<JsonRpcMessage>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-serve-"))
    mkdirSync(join(root, "memory"))
    writeFileSync(join(root, "memory", "open.md"), note("1", "alpha public", ["  remote_model: allow"]))
    writeFileSync(join(root, "memory", "secret.md"), note("2", "alpha SECRET_BODY", ["  remote_model: deny"]))
    writePolicy(root, {
      ...DEFAULT_POLICY,
      version: 1,
      egress: "deny",
      egressByDestination: { "provider:mcp:remote": "allow" },
    })
    const pair = createLoopbackPair()
    client = pair[0]
    server = pair[1]
    handle = serveMcp({ workspaceRoot: root, transport: server })
    responses = client.receive()[Symbol.asyncIterator]()
  })
  afterEach(async () => {
    await client.close()
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** The transport envelope: credentials beside the payload, never inside. */
  const search = (q: string, token?: string) => ({
    ...(token !== undefined ? { token } : {}),
    request: {
      workspace: root,
      query: q,
      maxCandidates: 50,
      maxPayloadBytes: 1_000_000,
      maxSnippetBytes: 65_536,
      deadlineMs: 2_000,
      spaces: [],
      types: [],
      tags: [],
    },
  })

  it("serves a search when the session token is actually presented", async () => {
    // This test previously sent no token at all and passed, because the
    // daemon substituted its own privileged one. It now supplies it.
    const res = (await call(
      client,
      responses,
      1,
      "knowledge_search",
      search("alpha", handle.tokenId),
    )) as { result?: { candidates: unknown[] } }
    expect(res.result?.candidates.length).toBeGreaterThan(0)
  })

  it("refuses a request that carries no token at all", async () => {
    const res = (await call(client, responses, 1, "knowledge_search", search("alpha"))) as {
      error?: { code: number }
      result?: unknown
    }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.unauthorized)
    expect(res.result).toBeUndefined()
  })

  it("returns no vault data whatsoever to an anonymous request", async () => {
    const res = (await call(client, responses, 1, "knowledge_search", search("alpha"))) as {
      result?: unknown
      error?: unknown
    }
    expect(JSON.stringify(res)).not.toContain("alpha public")
    expect(res.result).toBeUndefined()
  })

  it("refuses an empty or non-string token", async () => {
    for (const bad of ["", 0, null, true, {}, []]) {
      const res = (await call(client, responses, 1, "knowledge_search", {
        token: bad,
        request: search("alpha").request,
      })) as { error?: { code: number } }
      expect(res.error?.code).toBe(JSON_RPC_ERRORS.unauthorized)
    }
  })

  it("never echoes the session token in a response", async () => {
    const res = await call(client, responses, 1, "knowledge_search", search("alpha", handle.tokenId))
    expect(JSON.stringify(res)).not.toContain(handle.tokenId)
  })

  it("rejects a payload that violates its official schema", async () => {
    const res = (await call(client, responses, 1, "knowledge_search", {
      token: handle.tokenId,
      // maxCandidates above the contract ceiling of 1000.
      request: { ...search("alpha").request, maxCandidates: 100_000 },
    })) as { error?: { code: number; message: string } }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.invalidParams)
    // The path is safe to return; the received value is not.
    expect(res.error?.message).not.toContain("100000")
  })

  it("rejects an unknown property on a strict payload", async () => {
    const res = (await call(client, responses, 1, "knowledge_search", {
      token: handle.tokenId,
      request: { ...search("alpha").request, sneaky: true },
    })) as { error?: { code: number } }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.invalidParams)
  })

  it("keeps the token valid across successive calls", async () => {
    const token = handle.tokenId
    for (const id of [1, 2, 3]) {
      const res = (await call(client, responses, id, "knowledge_search", search("alpha", token))) as {
        result?: unknown
        error?: unknown
      }
      expect(res.error).toBeUndefined()
      expect(res.result).toBeDefined()
    }
  })

  it("refuses an unknown token with the unauthorized code", async () => {
    const res = (await call(
      client,
      responses,
      1,
      "knowledge_search",
      search("alpha", "tok_not_a_real_token"),
    )) as { error?: { code: number } }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.unauthorized)
  })

  it("makes a revocation take effect immediately", async () => {
    const token = handle.tokenId
    handle.composed.tokens.revoke(token)
    const res = (await call(client, responses, 1, "knowledge_search", search("alpha", token))) as {
      error?: { code: number }
    }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.unauthorized)
  })

  it("rejects a method outside the knowledge surface", async () => {
    const res = (await call(client, responses, 1, "knowledge_admin_wipe", {
      token: handle.tokenId,
      request: {},
    })) as {
      error?: { code: number }
    }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.methodNotFound)
  })

  it("refuses a request naming another workspace", async () => {
    const res = (await call(client, responses, 1, "knowledge_search", {
      token: handle.tokenId,
      request: { ...search("alpha").request, workspace: "/somewhere/else" },
    })) as { error?: { code: number } }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.unauthorized)
  })

  it("withholds a remote-denied note over the wire", async () => {
    const res = (await call(
      client,
      responses,
      1,
      "knowledge_search",
      search("alpha", handle.tokenId),
    )) as { result?: { candidates: Array<{ snippet: string }> } }
    const bodies = (res.result?.candidates ?? []).map((c) => c.snippet).join(" ")
    expect(bodies).not.toContain("SECRET_BODY")
  })

  it("returns the note body from knowledge_get, bounded by maxBytes", async () => {
    const res = (await call(client, responses, 1, "knowledge_get", {
      token: handle.tokenId,
      request: { workspace: root, locator: "open.md", maxBytes: 8, deadlineMs: 2_000 },
    })) as { result?: { found: boolean; body?: string; bodyBytes: number } }
    expect(res.result?.found).toBe(true)
    expect(res.result?.bodyBytes).toBeLessThanOrEqual(8)
    expect(typeof res.result?.body).toBe("string")
  })

  it("refuses knowledge_propose: the session token is read-only", async () => {
    const res = (await call(client, responses, 1, "knowledge_propose", {
      token: handle.tokenId,
      request: { workspace: root, intent: {} },
    })) as { error?: { code: number } }
    expect(res.error?.code).toBe(JSON_RPC_ERRORS.unauthorized)
  })

  it("writes the egress trail before the answer leaves (ADR-KNOW-0006 §6)", async () => {
    await call(client, responses, 1, "knowledge_search", search("alpha", handle.tokenId))
    // Not "eventually": by the time the client holds the response, the
    // decisions that produced it are already on disk.
    const trail = readFileSync(join(root, CONTROL_LOG_FILE), "utf8")
    expect(trail).toContain('"decision":"allow"')
    expect(trail).toContain('"decision":"deny"')
    // The refusal is recorded without quoting what it refused.
    expect(trail).not.toContain("SECRET_BODY")
  })

  it("returns an error rather than content it cannot record", async () => {
    // A directory where the log file belongs: the append can never succeed.
    // Releasing the note anyway would be content leaving with no trail — the
    // precise outcome the control log exists to prevent — so the daemon must
    // fail the request instead.
    mkdirSync(join(root, CONTROL_LOG_FILE), { recursive: true })
    const res = (await call(client, responses, 1, "knowledge_get", {
      token: handle.tokenId,
      request: { workspace: root, locator: "open.md", maxBytes: 4096, deadlineMs: 2_000 },
    })) as { error?: { code: number }; result?: { body?: string } }
    expect(res.error).toBeDefined()
    expect(res.result).toBeUndefined()
  })
})
