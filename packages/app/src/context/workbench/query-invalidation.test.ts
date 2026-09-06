/* SPDX-License-Identifier: MIT */

import { expect, test, describe } from "bun:test"
import { parseWorkspaceEvent, type WorkspaceEvent } from "@unifia/contracts/workbench-wire"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import type { QueryKey } from "@tanstack/solid-query"

import {
  keysToInvalidate,
  createCoalescedInvalidate,
  QUERY_FAMILY_STALE_TIME_MS,
  QUERY_DEFAULT_GC_TIME_MS,
  QUERY_DEFAULT_RETRY,
} from "./query-invalidation"
import { workbenchQueryKey } from "./query-keys"

const connection: WorkbenchConnection = {
  serverOrigin: "https://server",
  instanceId: "instance-1",
  workspaceId: "ws-1",
  // WHY: the mapping is a pure function of the connection's identifying
  // triple. The `client` field is never read by the mapper; casting
  // through `unknown` keeps the test self-contained without depending on
  // a real WorkbenchClient.
  client: undefined as never,
  revoke: () => Promise.resolve(),
  // DA-UI-01 — capability-gated affordances consume the connection's
  // `grants` set. The query-invalidation mapper doesn't read it, but
  // the type is now required; an empty set matches the base surface
  // lease (no `workflow.run` ⇒ Automate is hidden, but the mapper's
  // contract is unchanged).
  grants: new Set<string>(),
}

function mutationEvent(overrides: Partial<{ type: "workspace.changed" | "operation.updated" | "approval.updated"; resource: { type: string; id: string } }> = {}): WorkspaceEvent {
  return parseWorkspaceEvent({
    eventId: "ev-1",
    workspaceId: "ws-1",
    sequenceId: 1,
    cursor: "c-1",
    type: overrides.type ?? "workspace.changed",
    payload: {},
    resource: overrides.resource ?? { type: "file", id: "/path/to/file" },
  })
}

function bulkEvent(type: "catalog.updated" | "trace.appended"): WorkspaceEvent {
  return parseWorkspaceEvent({
    eventId: "ev-1",
    workspaceId: "ws-1",
    sequenceId: 1,
    cursor: "c-1",
    type,
    payload: {},
  })
}

describe("E12 — keysToInvalidate (event→query key mapping)", () => {
  test("a file change invalidates file listing + file content, NOT GitHub or history", () => {
    // WHY: the runbook's «fichier ne refetch pas GitHub/history» oracle.
    // The keyspace includes github-status and design-history — they MUST
    // NOT appear in the invalidation set for a file event.
    const keys = keysToInvalidate(connection, mutationEvent({ resource: { type: "file", id: "/a/b.txt" } }))
    expect(keys).toContainEqual(workbenchQueryKey(connection, "files"))
    expect(keys).toContainEqual(workbenchQueryKey(connection, "file", { path: "/a/b.txt" }))
    expect(keys).not.toContainEqual(expect.objectContaining([expect.arrayContaining(["github-status"])]))
    expect(keys).not.toContainEqual(expect.objectContaining([expect.arrayContaining(["design-history"])]))
  })

  test("a design-system change invalidates only the design-systems catalog", () => {
    const keys = keysToInvalidate(connection, mutationEvent({ resource: { type: "design-system", id: "figma-1" } }))
    expect(keys).toEqual([workbenchQueryKey(connection, "design-systems")])
  })

  test("a design-skill change invalidates only the design-skills catalog", () => {
    const keys = keysToInvalidate(connection, mutationEvent({ resource: { type: "design-skill", id: "skill-1" } }))
    expect(keys).toEqual([workbenchQueryKey(connection, "design-skills")])
  })

  test("an artifact change invalidates only the artifacts listing", () => {
    const keys = keysToInvalidate(connection, mutationEvent({ resource: { type: "artifact", id: "art-1" } }))
    expect(keys).toEqual([workbenchQueryKey(connection, "artifacts")])
  })

  test("a document change invalidates only the documents listing", () => {
    const keys = keysToInvalidate(connection, mutationEvent({ resource: { type: "document", id: "doc-1" } }))
    expect(keys).toEqual([workbenchQueryKey(connection, "documents")])
  })

  test("a workspace.changed event with an unknown resource type invalidates nothing", () => {
    // WHY: the server is supposed to emit precise resource types. If
    // it sends a type the mapper doesn't know, the conservative
    // answer is NO invalidation — the old code invalidated the whole
    // subtree, which is the regression E12 removes.
    const keys = keysToInvalidate(connection, mutationEvent({ resource: { type: "mystery-thing", id: "x" } }))
    expect(keys).toEqual([])
  })

  test("operation.updated invalidates nothing (operations are streamed, not queried)", () => {
    const event = parseWorkspaceEvent({
      eventId: "ev-1",
      workspaceId: "ws-1",
      sequenceId: 1,
      cursor: "c-1",
      type: "operation.updated",
      payload: { state: "running" },
      resource: { type: "operation", id: "op-1" },
    })
    expect(keysToInvalidate(connection, event)).toEqual([])
  })

  test("approval.updated invalidates only the approvals listing", () => {
    const event = parseWorkspaceEvent({
      eventId: "ev-1",
      workspaceId: "ws-1",
      sequenceId: 1,
      cursor: "c-1",
      type: "approval.updated",
      payload: { state: "approved" },
      resource: { type: "approval", id: "ap-1" },
    })
    const keys = keysToInvalidate(connection, event)
    expect(keys).toEqual([workbenchQueryKey(connection, "approvals")])
  })

  test("catalog.updated invalidates catalogs only (not file listing, not GitHub, not history)", () => {
    const keys = keysToInvalidate(connection, bulkEvent("catalog.updated"))
    expect(keys).toContainEqual(workbenchQueryKey(connection, "design-systems"))
    expect(keys).toContainEqual(workbenchQueryKey(connection, "design-skills"))
    expect(keys).not.toContainEqual(expect.objectContaining([expect.arrayContaining(["files"])]))
    expect(keys).not.toContainEqual(expect.objectContaining([expect.arrayContaining(["github-status"])]))
    expect(keys).not.toContainEqual(expect.objectContaining([expect.arrayContaining(["design-history"])]))
  })

  test("trace.appended invalidates nothing (append-only — the stream is the source)", () => {
    expect(keysToInvalidate(connection, bulkEvent("trace.appended"))).toEqual([])
  })
})

/**
 * E14 — coalescing + per-family cache defaults.
 *
 * The oracle (« 100 événements identiques produisent un fetch utile »)
 * has two halves:
 *   1. TanStack dedupes invalidations for the same key — the fetch
 *      protection is automatic, we just need to avoid the re-render
 *      storm.
 *   2. The coalescing window ensures 100 events in 16 ms collapse to
 *      ONE batch, not 100 batches of 1.
 */
describe("E14 — createCoalescedInvalidate", () => {
  function makeStubClient() {
    const calls: QueryKey[] = []
    const client = {
      invalidateQueries: (input: { queryKey: QueryKey }) => { calls.push(input.queryKey) },
    }
    return { client: client as unknown as import("@tanstack/solid-query").QueryClient, calls }
  }
  // Build a tiny setTimeoutFn that flushes synchronously when scheduled.
  function makeSyncScheduler() {
    const queue: Array<() => void> = []
    return {
      queue,
      setTimeoutFn: (cb: () => void) => { queue.push(cb); return queue.length - 1 },
      clearTimeoutFn: (h: unknown) => { queue[h as number] = () => undefined },
      runAll: () => { const q = queue.splice(0); for (const cb of q) cb() },
    }
  }

  test("100 identical events produce 1 fetch per affected key (E14 oracle)", () => {
    const stub = makeStubClient()
    const scheduler = makeSyncScheduler()
    const coalesced = createCoalescedInvalidate(stub.client, { setTimeoutFn: scheduler.setTimeoutFn, clearTimeoutFn: scheduler.clearTimeoutFn })
    const event = mutationEvent({ resource: { type: "file", id: "/a/b.txt" } })
    for (let i = 0; i < 100; i += 1) coalesced.enqueue(connection, event)
    // BEFORE the timer fires: no invalidation calls.
    expect(stub.calls.length).toBe(0)
    // Flush: exactly 4 keys (shared files/content plus Design Files listing/content),
    // and 100 events × 4 keys would have produced 400 calls without
    // coalescing.
    scheduler.runAll()
    expect(stub.calls.length).toBe(4)
    // The keys are the workbench file-listing + file-content keys.
    expect(stub.calls).toContainEqual(workbenchQueryKey(connection, "files"))
    expect(stub.calls).toContainEqual(workbenchQueryKey(connection, "file", { path: "/a/b.txt" }))
  })

  test("events affecting different keys still coalesce into a single batch", () => {
    const stub = makeStubClient()
    const scheduler = makeSyncScheduler()
    const coalesced = createCoalescedInvalidate(stub.client, { setTimeoutFn: scheduler.setTimeoutFn, clearTimeoutFn: scheduler.clearTimeoutFn })
    coalesced.enqueue(connection, mutationEvent({ resource: { type: "file", id: "/a" } }))
    coalesced.enqueue(connection, mutationEvent({ resource: { type: "file", id: "/b" } }))
    coalesced.enqueue(connection, mutationEvent({ resource: { type: "design-system", id: "figma" } }))
    scheduler.runAll()
    // 7 keys: shared files (dedup'd to 1), two file paths, two Design Files
    // listings/contents, and design-systems.
    expect(stub.calls.length).toBe(7)
  })

  test("flush() forces an immediate drain without waiting for the timer", () => {
    const stub = makeStubClient()
    const scheduler = makeSyncScheduler()
    const coalesced = createCoalescedInvalidate(stub.client, { setTimeoutFn: scheduler.setTimeoutFn, clearTimeoutFn: scheduler.clearTimeoutFn })
    coalesced.enqueue(connection, mutationEvent({ resource: { type: "file", id: "/x" } }))
    expect(stub.calls.length).toBe(0)
    coalesced.flush()
    expect(stub.calls.length).toBe(4)
    // The scheduled timer is cancelled by flush — running it does nothing.
    scheduler.runAll()
    expect(stub.calls.length).toBe(4)
  })

  test("stop() prevents future enqueues and flushes", () => {
    const stub = makeStubClient()
    const scheduler = makeSyncScheduler()
    const coalesced = createCoalescedInvalidate(stub.client, { setTimeoutFn: scheduler.setTimeoutFn, clearTimeoutFn: scheduler.clearTimeoutFn })
    coalesced.stop()
    coalesced.enqueue(connection, mutationEvent({ resource: { type: "file", id: "/x" } }))
    coalesced.flush()
    expect(stub.calls.length).toBe(0)
  })

  test("enqueue after stop is a no-op (SSE cancel path)", () => {
    const stub = makeStubClient()
    const coalesced = createCoalescedInvalidate(stub.client)
    coalesced.stop()
    coalesced.enqueue(connection, mutationEvent({ resource: { type: "file", id: "/x" } }))
    expect(stub.calls.length).toBe(0)
  })
})

describe("E14 — per-family cache defaults", () => {
  test("stable data families are not refetched on remount (staleTime: Infinity)", () => {
    // The E14 cache oracle: a refetch only happens when an SSE event
    // explicitly invalidates the key. staleTime: Infinity means
    // TanStack treats the cached data as fresh until invalidated.
    expect(QUERY_FAMILY_STALE_TIME_MS["design-systems"]).toBe(Infinity)
    expect(QUERY_FAMILY_STALE_TIME_MS["design-skills"]).toBe(Infinity)
    expect(QUERY_FAMILY_STALE_TIME_MS["design-history"]).toBe(Infinity)
  })

  test("dynamic data families have a finite staleTime", () => {
    expect(QUERY_FAMILY_STALE_TIME_MS.files).toBeLessThan(Infinity)
    expect(QUERY_FAMILY_STALE_TIME_MS["github-status"]).toBeLessThan(Infinity)
    expect(QUERY_FAMILY_STALE_TIME_MS.documents).toBeLessThan(Infinity)
  })

  test("gcTime outlasts a typical Work session", () => {
    // 30 min — the cache survives a tab switch and a coffee break.
    expect(QUERY_DEFAULT_GC_TIME_MS).toBe(30 * 60 * 1000)
  })

  test("retry budget is conservative (2 attempts: 1 immediate, 1 backoff)", () => {
    expect(QUERY_DEFAULT_RETRY).toBe(2)
  })
})
