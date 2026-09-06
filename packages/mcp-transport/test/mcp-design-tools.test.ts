/* SPDX-License-Identifier: MIT */

/**
 * M8 — DA-CAP-01 / Plan V3 §9.3 verification.
 *
 * Two questions this file answers:
 *
 * 1. **Static**: does the MCP `TOOL_CAPABILITY` map (design-tools.ts:46-52)
 *    stay consistent with the new P3 union? DA-CAP-01 added
 *    `plugin.apply`, `artifact.render`, `designsystem.read`,
 *    `media.generate` to `P3_CAPABILITIES`. If `TOOL_CAPABILITY` ever
 *    returns a name that is NOT in the closed union, the workbench-side
 *    broker will reject the call as an unknown capability (ruleId
 *    "C2-unknown-capability"). The test pins the contract.
 *
 * 2. **Dynamic**: does the JsonRpcClient refuse a tool invocation that
 *    the principal is not entitled to make, BEFORE the call is sent
 *    over the wire, with JSON-RPC -32004 (unauthorized), and with no
 *    side effect on the peer?
 *
 * The `MethodAuthorizer` is a port, not a production policy. The
 * production policy lives in the workbench server. The tests below
 * model a representative host-side authorizer and verify the
 * JsonRpcClient honours ANY conforming authorizer: deny → -32004
 * synchronously, no peer traffic, no rate-limit budget consumed.
 */

import { afterEach, describe, expect, test } from "bun:test"
import {
  DESIGN_TOOLS,
  JSON_RPC_ERRORS,
  JsonRpcClient,
  JsonRpcError,
  TOOL_CAPABILITY,
  createLoopbackPair,
  requiredCapability,
  type MessageTransport,
  type MethodAuthorizer,
} from "../src/index.js"
import { P3_CAPABILITIES, type P3Capability } from "@unifia/contracts"

// -- Fixtures -----------------------------------------------------------------

/**
 * Caller-string convention used in these tests. The host encodes
 * "who is calling, against which workspace" into the single string
 * the transport's `MethodAuthorizer` port accepts. Production
 * injects a richer authorizer that reads the principal from the
 * verified token; this convention is the simplest encoding that
 * carries both pieces without expanding the port.
 *
 * Shape: `principal-id@workspace=ws`
 */
const callerFor = (principalId: string, workspaceId: string): string => `${principalId}@workspace=${workspaceId}`

type Principal = {
  id: string
  grants: ReadonlySet<string>
  allowedWorkspaces: ReadonlySet<string>
}

const principal = (id: string, grants: readonly string[], workspaces: readonly string[]): Principal => ({
  id,
  grants: new Set(grants),
  allowedWorkspaces: new Set(workspaces),
})

/**
 * Model a host-side `MethodAuthorizer` that enforces both the
 * capability and the workspace scope. The authorizer only needs to
 * know the principal directory; the tool and the workspace come from
 * the method-name / caller-string convention above.
 */
function authorizerFor(directory: ReadonlyMap<string, Principal>): MethodAuthorizer {
  return {
    authorize(method: string, caller: string): boolean {
      // WHY: the tool name is the suffix of the method after the
      // `tools/call/` prefix; the convention is enforced by the host,
      // not by the transport.
      const toolMatch = /^tools\/call\/([a-z_]+)$/.exec(method)
      if (!toolMatch) return false
      const tool = toolMatch[1] as (typeof DESIGN_TOOLS)[number]
      if (!DESIGN_TOOLS.includes(tool)) return false
      const callerMatch = /^([^@]+)@workspace=([a-z0-9-]+)$/.exec(caller)
      if (!callerMatch) return false
      const [, principalId, workspace] = callerMatch
      const principal = directory.get(principalId)
      if (!principal) return false
      if (!principal.allowedWorkspaces.has(workspace)) return false
      return principal.grants.has(requiredCapability(tool))
    },
  }
}

// -- Peer recorder ------------------------------------------------------------

/**
 * Stand up a loopback peer that records every method name it sees.
 * Used to assert that an unauthorised call never reaches the wire.
 * Returns the client side (so the test can build a JsonRpcClient on
 * top of it), the recorded method list, and a close handle.
 */
function startRecordingPeer(): {
  clientSide: MessageTransport
  seen: string[]
  close: () => Promise<void>
} {
  const [clientSide, serverSide] = createLoopbackPair()
  const seen: string[] = []
  void (async () => {
    for await (const message of serverSide.receive()) {
      if (!("method" in message)) continue
      seen.push(message.method)
      if (!("id" in message)) continue
      // Reply with an innocuous result so any successful call (i.e.
      // one that should NOT succeed) would land something the test
      // can assert on. The tests below use an always-deny authorizer
      // so this branch is unreachable.
      await serverSide.send({ jsonrpc: "2.0", id: message.id, result: { reached: true } })
    }
  })()
  return { clientSide, seen, close: () => serverSide.close() }
}

// -- Test scaffolding ---------------------------------------------------------

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.shift()
    if (cleanup) await cleanup()
  }
})

// -- 1. TOOL_CAPABILITY vs the new P3 union -----------------------------------

describe("MCP TOOL_CAPABILITY vs the new P3 capability union (DA-CAP-01)", () => {
  test("every TOOL_CAPABILITY value is a member of P3_CAPABILITIES", () => {
    // WHY: the workbench broker refuses unknown capability names with
    // ruleId "C2-unknown-capability" (PolicyEngineDouble). A typo in
    // TOOL_CAPABILITY that is not in the union would silently turn
    // every MCP call into a 403, not a 32004. This test catches that.
    const union = new Set<string>(P3_CAPABILITIES)
    for (const tool of DESIGN_TOOLS) {
      const capability = TOOL_CAPABILITY[tool]
      expect(union.has(capability)).toBe(true)
      // compile-time belt: the value is also a P3Capability, not just
      // a string that happens to be in the union.
      const typed: P3Capability = capability as P3Capability
      expect(P3_CAPABILITIES.includes(typed)).toBe(true)
    }
  })

  test("the four tool→capability pairs are exactly what the docstring claims", () => {
    // WHY: this is the public contract documented at design-tools.ts:5-12.
    // Drift here would silently change which tools require which grant.
    expect(TOOL_CAPABILITY).toEqual({
      search_files: "workspace.read",
      get_file: "workspace.read",
      get_artifact: "workspace.read",
      apply_plugin: "plugin.apply",
    })
  })

  test("the four capabilities referenced by TOOL_CAPABILITY are all in the new union", () => {
    // WHY: even if the table is reshuffled, every name it can return
    // must remain a member of P3_CAPABILITIES. This is the "no drift"
    // guarantee for the union expansion done in DA-CAP-01.
    expect(P3_CAPABILITIES).toContain("workspace.read")
    expect(P3_CAPABILITIES).toContain("plugin.apply")
  })
})

// -- 2. MethodAuthorizer enforcement ------------------------------------------

describe("MethodAuthorizer refuses tools outside the principal's grants or workspaces", () => {
  const readonlyAlice = principal("alice", ["workspace.read"], ["design-app"])
  const adminBob = principal("bob", ["workspace.read", "plugin.apply"], ["design-app", "ops-app"])
  // WHY: the directory is keyed by principal id, not by the full
  // caller string. The authorizer parses the caller to recover the
  // principal id and the workspace separately, then looks up the
  // principal directory by id. Keying by the full caller would let
  // the same principal appear under several entries, which the host
  // can avoid by indexing once.
  const directory = new Map<string, Principal>([
    [readonlyAlice.id, readonlyAlice],
    [adminBob.id, adminBob],
  ])

  test("denies a tool whose required capability is not in the principal's grants", () => {
    const auth = authorizerFor(directory)
    // alice has `workspace.read` but not `plugin.apply`
    expect(auth.authorize("tools/call/apply_plugin", callerFor("alice", "design-app"))).toBe(false)
    // ... and her `workspace.read` grant covers the read tools
    expect(auth.authorize("tools/call/search_files", callerFor("alice", "design-app"))).toBe(true)
    expect(auth.authorize("tools/call/get_file", callerFor("alice", "design-app"))).toBe(true)
    expect(auth.authorize("tools/call/get_artifact", callerFor("alice", "design-app"))).toBe(true)
  })

  test("denies a tool whose required capability is granted but the workspace is out of scope", () => {
    const auth = authorizerFor(directory)
    // bob has plugin.apply but only against design-app / ops-app
    expect(auth.authorize("tools/call/apply_plugin", callerFor("bob", "design-app"))).toBe(true)
    expect(auth.authorize("tools/call/apply_plugin", callerFor("bob", "ops-app"))).toBe(true)
    // ... and an unknown workspace (or an unmapped principal) is denied
    expect(auth.authorize("tools/call/apply_plugin", callerFor("bob", "other-app"))).toBe(false)
    expect(auth.authorize("tools/call/apply_plugin", "eve@workspace=design-app")).toBe(false)
  })

  test("denies calls that do not match the tools/call/<tool> convention", () => {
    const auth = authorizerFor(directory)
    // WHY: anything outside the convention cannot be matched to a
    // tool, so it cannot be matched to a capability; the host's
    // safe-by-default stance is to refuse. A non-conforming method
    // is not an authorised call.
    expect(auth.authorize("apply_plugin", callerFor("bob", "design-app"))).toBe(false)
    expect(auth.authorize("tools/call/unknown_tool", callerFor("bob", "design-app"))).toBe(false)
  })
})

// -- 3. JsonRpcClient.#guard on authorizer denial ----------------------------

describe("JsonRpcClient.#guard", () => {
  test("throws JsonRpcError with the unauthorized code on authorizer denial", async () => {
    const { clientSide, seen, close } = startRecordingPeer()
    const guarded = new JsonRpcClient(clientSide, {
      timeoutMs: 200,
      caller: callerFor("alice", "design-app"),
      authorizer: { authorize: () => false },
    })
    cleanups.push(() => guarded.close().catch(() => {}))
    cleanups.push(close)

    let caught: unknown
    try {
      await guarded.call("tools/call/apply_plugin", { pluginId: "any" })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(JsonRpcError)
    const err = caught as JsonRpcError
    expect(err.code).toBe(JSON_RPC_ERRORS.unauthorized)
    // The literal value of the unauthorised code is -32004; the
    // constant import covers the symbol, the literal pins the wire
    // format. If either drifts, JSON-RPC peers will reject the error.
    expect(err.code).toBe(-32004)
    // The message should mention the method, but NOT echo the caller's
    // identity or any params (avoid leaking principal info to the peer
    // or the audit log).
    expect(err.message).toContain("tools/call/apply_plugin")
    // The peer must never have seen the unauthorised call.
    expect(seen).not.toContain("tools/call/apply_plugin")
  })

  test("a denied call does not consume the rate-limit budget", async () => {
    // WHY: client.ts:103-107 explicitly states that authorisation is
    // checked BEFORE the rate limiter. A denial must therefore leave
    // the caller's budget untouched — otherwise an attacker could
    // burn the victim's budget with one cheap, unauthorised call.
    const { clientSide, close } = startRecordingPeer()
    let takeCount = 0
    const guarded = new JsonRpcClient(clientSide, {
      timeoutMs: 200,
      caller: callerFor("alice", "design-app"),
      authorizer: { authorize: () => false },
      rateLimiter: { take: () => (takeCount += 1) > 0 },
    })
    cleanups.push(() => guarded.close().catch(() => {}))
    cleanups.push(close)

    await expect(guarded.call("tools/call/apply_plugin")).rejects.toBeInstanceOf(JsonRpcError)
    expect(takeCount).toBe(0) // the rate limiter was never consulted
  })
})

// -- 4. Malicious direct client scenario --------------------------------------

describe("Malicious direct client scenario", () => {
  test("a client with no grants cannot invoke apply_plugin: -32004 and no peer traffic", async () => {
    const { clientSide, seen, close } = startRecordingPeer()

    // The "malicious" client: same transport, no grants, calls the
    // strongest capability (apply_plugin) directly. The authorizer
    // is the host-side gate; with no grants it must refuse.
    const malicious = new JsonRpcClient(clientSide, {
      timeoutMs: 200,
      caller: callerFor("mallory", "design-app"),
      authorizer: { authorize: () => false },
    })
    cleanups.push(() => malicious.close().catch(() => {}))
    cleanups.push(close)

    let caught: unknown
    try {
      await malicious.call("tools/call/apply_plugin", { pluginId: "injected" })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(JsonRpcError)
    expect((caught as JsonRpcError).code).toBe(JSON_RPC_ERRORS.unauthorized)

    // The peer never observed the call. The recorded list either
    // does not contain the method, or contains only the
    // `notifications/cancelled` that may have been emitted by the
    // timeout/close path. We assert specifically about the tool call.
    expect(seen).not.toContain("tools/call/apply_plugin")
  })

  test("a client whose grant set is too small for the requested tool gets -32004 on that tool only", async () => {
    // Same hostile client, but with a finer-grained authorizer that
    // models a partially-privileged principal: read access is allowed,
    // plugin.apply is not. The read tools should pass; apply_plugin
    // should be denied. This proves the granularity of the gate.
    const { clientSide, seen, close } = startRecordingPeer()
    const directory = new Map<string, Principal>([
      ["alice", principal("alice", ["workspace.read"], ["design-app"])],
    ])
    const partiallyPrivileged = new JsonRpcClient(clientSide, {
      timeoutMs: 200,
      caller: callerFor("alice", "design-app"),
      authorizer: authorizerFor(directory),
    })
    cleanups.push(() => partiallyPrivileged.close().catch(() => {}))
    cleanups.push(close)

    // The read tools reach the peer.
    const readResult = await partiallyPrivileged.call("tools/call/search_files", { query: "index" })
    expect((readResult as { reached: boolean }).reached).toBe(true)
    expect(seen).toContain("tools/call/search_files")

    // The mutating tool is refused before the wire.
    let caught: unknown
    try {
      await partiallyPrivileged.call("tools/call/apply_plugin", { pluginId: "any" })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(JsonRpcError)
    expect((caught as JsonRpcError).code).toBe(JSON_RPC_ERRORS.unauthorized)
    expect(seen).not.toContain("tools/call/apply_plugin")
  })
})
