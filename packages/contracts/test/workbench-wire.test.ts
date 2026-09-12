/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "vitest"
import {
  EVENT_MERGE_RULES,
  MUTATION_EVENT_TYPES,
  createIdempotencyKey,
  isMutationEventType,
  parseAcceptedOperation,
  parseBinaryPayloadRef,
  parseHandshakeRequest,
  parseHandshakeResponse,
  parsePageRequest,
  parseTokenRotation,
  parseWorkspaceEvent,
  WIRE_POLICY,
} from "../src/workbench-wire/index"

describe("workbench wire contract", () => {
  it("keeps an explicit reconciliation rule for every event type", () => {
    expect(Object.values(EVENT_MERGE_RULES)).toHaveLength(5)
    expect(EVENT_MERGE_RULES["trace.appended"]).toBe("append-only")
  })

  it("validates the handshake and rejects unsupported shapes", () => {
    expect(parseHandshakeRequest({
      kind: "workbench.handshake",
      protocolVersion: 1,
      supportedVersions: [1],
      clientInstanceId: "client-1",
    }).clientInstanceId).toBe("client-1")
    expect(() => parseHandshakeRequest({ kind: "workbench.handshake", supportedVersions: [] })).toThrow()
    expect(parseHandshakeResponse({ kind: "workbench.handshake.refused", accepted: false, protocolVersion: null, supportedVersions: [1], instanceId: "server-1", reason: "unsupported-version" }).accepted).toBe(false)
  })

  it("creates persisted-retry-safe UUID v7 idempotency keys", () => {
    const key = createIdempotencyKey(1_725_000_000_000)
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(parseAcceptedOperation({ status: 202, operationId: "op-1", approvalId: null, idempotencyKey: key }).operationId).toBe("op-1")
  })

  it("validates monotonic event identity and short-lived binary references", () => {
    expect(parseWorkspaceEvent({ eventId: "event-1", workspaceId: "ws-1", sequenceId: 4, cursor: "opaque-4", type: "workspace.changed", payload: {}, resource: { type: "workspace", id: "ws-1" } }).sequenceId).toBe(4)
    expect(parseBinaryPayloadRef({ kind: "binary-ref", url: "https://127.0.0.1/file", expiresAt: Date.now() + 1000, sha256: "abc", byteLength: 10 }).byteLength).toBe(10)
    expect(() => parseWorkspaceEvent({ eventId: "event-1", workspaceId: "ws-1", sequenceId: -1, cursor: "opaque", type: "workspace.changed", payload: {}, resource: { type: "workspace", id: "ws-1" } })).toThrow()
  })

  it("exposes an explicit mutation-event set (E11)", () => {
    expect(MUTATION_EVENT_TYPES).toEqual(["workspace.changed", "operation.updated", "approval.updated"])
    expect(isMutationEventType("workspace.changed")).toBe(true)
    expect(isMutationEventType("operation.updated")).toBe(true)
    expect(isMutationEventType("approval.updated")).toBe(true)
    expect(isMutationEventType("catalog.updated")).toBe(false)
    expect(isMutationEventType("trace.appended")).toBe(false)
  })

  it("requires a resource on every mutation event (E11 oracle: chaque mutation produit une ressource/ID)", () => {
    const resource = { type: "operation", id: "op-1" }
    for (const type of MUTATION_EVENT_TYPES) {
      const event = parseWorkspaceEvent({ eventId: "ev-1", workspaceId: "ws-1", sequenceId: 1, cursor: "c-1", type, payload: {}, resource })
      // WHY: the parser is the ONE place that decides whether a wire event
      // carries a resource — the consumer's `event.resource.id` access
      // relies on this invariant. If the cast ever stops narrowing to
      // `WorkspaceMutationEvent`, the test will fail to compile.
      if (event.type === "operation.updated" || event.type === "approval.updated" || event.type === "workspace.changed") {
        expect(event.resource).toEqual(resource)
      }
    }
  })

  it("rejects mutation events that omit the resource field", () => {
    expect(() => parseWorkspaceEvent({ eventId: "ev-1", workspaceId: "ws-1", sequenceId: 1, cursor: "c-1", type: "operation.updated", payload: {} })).toThrow(/resource/)
    expect(() => parseWorkspaceEvent({ eventId: "ev-1", workspaceId: "ws-1", sequenceId: 1, cursor: "c-1", type: "operation.updated", payload: {}, resource: { type: "" } })).toThrow(/resource\.type/)
    expect(() => parseWorkspaceEvent({ eventId: "ev-1", workspaceId: "ws-1", sequenceId: 1, cursor: "c-1", type: "operation.updated", payload: {}, resource: "not-an-object" })).toThrow(/resource/)
  })

  it("accepts bulk events without a resource (whole aggregate)", () => {
    const catalog = parseWorkspaceEvent({ eventId: "ev-2", workspaceId: "ws-1", sequenceId: 2, cursor: "c-2", type: "catalog.updated", payload: { version: 3 } })
    expect(catalog.type).toBe("catalog.updated")
    const trace = parseWorkspaceEvent({ eventId: "ev-3", workspaceId: "ws-1", sequenceId: 3, cursor: "c-3", type: "trace.appended", payload: { line: "x" } })
    expect(trace.type).toBe("trace.appended")
  })

  it("keeps cursor, rotation, and rate limits explicit", () => {
    expect(parsePageRequest({ workspaceId: "ws-1", cursor: "opaque", pageSize: 20 }).pageSize).toBe(20)
    expect(parseTokenRotation({ state: "rotating", token: "next", previousToken: "current", gracePeriodMs: 1000, expiresAt: Date.now() + 1000 }).previousToken).toBe("current")
    expect(WIRE_POLICY.maxSseConnectionsPerWorkspace).toBe(2)
    expect(() => parsePageRequest({ workspaceId: "ws-1", pageSize: 101 })).toThrow()
  })
})
