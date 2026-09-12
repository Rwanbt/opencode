/* SPDX-License-Identifier: MIT */

import type { QueryClient, QueryKey } from "@tanstack/solid-query"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import type { WorkspaceEvent } from "@unifia/contracts/workbench-wire"

import { workbenchQueryKey } from "./query-keys"

/**
 * E12 — event→query key mapping.
 *
 * WHY this module exists: before E12, the workbench provider invalidated the
 * WHOLE workspace query subtree on every event
 * (`queryClient.invalidateQueries({ queryKey: ["workbench", origin, instance,
 * workspaceId] })`). That meant a single file-save event refetched
 * `github-status`, `design-history`, every `design-files-tab-*` and every
 * other workbench query — exactly the over-fetching the runbook's
 * «fichier ne refetch pas GitHub/history» oracle forbids.
 *
 * E11 gave every mutation event a typed `resource` field
 * ({type, id}). E12 uses that field to scope the invalidation to the
 * minimum set of query keys the event actually invalidated.
 *
 * E14 — coalescing: when 100 events arrive in a 50 ms window, the
 * `coalescedInvalidate` wrapper dedupes them so the QueryClient
 * receives ONE invalidation per affected key, not 100.
 *
 * Pure function: returns the list of query keys. A separate side-effecting
 * wrapper applies them. Splitting the two means the mapping is testable
 * without a QueryClient (and without mocking TanStack's internals), and
 * the side-effecting path is the only place that calls
 * `queryClient.invalidateQueries`.
 *
 * Resource-type vocabulary (server-side convention, free-form per E11):
 *   "file"          → file listing + content for that path
 *   "design-system" → the design-systems catalog
 *   "design-skill"  → the design-skills catalog
 *   "artifact"      → the artifact listing
 *   "document"      → the document listing
 *   "operation"     → tracked via the operations query (no listing query yet)
 *   "approval"      → approvals listing
 *
 * A `workspace.changed` event whose `resource.type` is not in this table
 * deliberately invalidates NOTHING rather than the whole subtree — the
 * server is supposed to send a precise type, and over-invalidating on
 * unknown types is the very regression E12 is removing.
 */

const MUTATION_RESOURCE_KEY_BUILDERS: Record<
  string,
  (connection: WorkbenchConnection, id: string) => readonly QueryKey[]
> = {
  file: (connection, id) => [
    workbenchQueryKey(connection, "files"),
    workbenchQueryKey(connection, "file", { path: id }),
    workbenchQueryKey(connection, "design-files-tab"),
    workbenchQueryKey(connection, "design-files-tab-content", { path: id }),
  ],
  "design-system": (connection) => [workbenchQueryKey(connection, "design-systems")],
  "design-skill": (connection) => [workbenchQueryKey(connection, "design-skills")],
  artifact: (connection) => [workbenchQueryKey(connection, "artifacts")],
  document: (connection) => [workbenchQueryKey(connection, "documents")],
  approval: (connection) => [workbenchQueryKey(connection, "approvals")],
}

export function keysToInvalidate(
  connection: WorkbenchConnection,
  event: WorkspaceEvent,
): readonly QueryKey[] {
  switch (event.type) {
    case "workspace.changed": {
      const builder = MUTATION_RESOURCE_KEY_BUILDERS[event.resource.type]
      return builder ? builder(connection, event.resource.id) : []
    }
    case "operation.updated":
      // Operations are not listed by a TanStack query today (the
      // provider streams them). Refetching nothing is correct: the
      // active operation view consumes the SSE stream directly.
      return []
    case "approval.updated":
      return [workbenchQueryKey(connection, "approvals")]
    case "catalog.updated":
      // Whole-aggregate replacement: the catalogs are the only data
      // that derives from the catalog. NOT the file listing, NOT the
      // GitHub status, NOT the design history.
      return [
        workbenchQueryKey(connection, "design-systems"),
        workbenchQueryKey(connection, "design-skills"),
      ]
    case "trace.appended":
      // Append-only: no refetch, the stream itself is the source.
      return []
  }
}

/**
 * Side-effecting wrapper around {@link keysToInvalidate}. Kept as a
 * one-liner so the call site (workbench/provider.tsx) cannot drift
 * from the pure mapping — every event that the provider handles goes
 * through the same code path.
 */
export function invalidateForEvent(
  client: QueryClient,
  connection: WorkbenchConnection,
  event: WorkspaceEvent,
): void {
  for (const key of keysToInvalidate(connection, event)) {
    void client.invalidateQueries({ queryKey: key })
  }
}

// ---------------------------------------------------------------------------
// E14 — coalescing + per-family cache defaults.
// ---------------------------------------------------------------------------

/**
 * Default cache windows per data family (E14).
 *
 * WHY per-family and not a single default: a file listing changes often
 * (every save) and a refetch is cheap; a GitHub status refetch goes over
 * the network and is rate-limited; design history is append-only and
 * the stream is the source of truth. One global `staleTime` would
 * either over-fetch (file listing) or under-fetch (GitHub).
 *
 * `staleTime: Infinity` here means "do not refetch on remount; only
 * refetch when an event invalidates the key". This is the E14 cache
 * oracle (« 100 événements identiques produisent un fetch utile »):
 * a refetch only happens when the SSE event explicitly says so, never
 * on a remount, hover, or focus event.
 */
export const QUERY_FAMILY_STALE_TIME_MS: Readonly<Record<string, number>> = {
  files: 5_000,
  file: 5_000,
  "design-files-tab": 5_000,
  "design-files-tab-content": 5_000,
  "design-files-tab-assets": 30_000,
  "design-systems": Infinity,
  "design-skills": Infinity,
  "github-status": 60_000,
  "spec-validation": 30_000,
  "design-history": Infinity,
  documents: 30_000,
  artifacts: 30_000,
  approvals: 10_000,
  // `artifact-raw` is a binary payload; treat as long-lived.
  "artifact-raw": Infinity,
}

/**
 * Garbage-collect window (formerly `cacheTime` in TanStack v4). Picked
 * to outlast a typical Work session: 30 min after the last subscriber
 * leaves, the cache is reclaimed. Family-agnostic on purpose — the
 * staleTime above already drives refetch decisions.
 */
export const QUERY_DEFAULT_GC_TIME_MS = 30 * 60 * 1000

/**
 * Number of automatic retries for transient failures. The plan
 * (« définir staleTime, gcTime, retry et refetch par famille de
 * données ») sets a conservative 2 — 1 immediate, 1 after backoff.
 * Retries that exhaust their budget surface to the UI as errors.
 */
export const QUERY_DEFAULT_RETRY = 2

/**
 * E14 — coalesce bursts of events into one invalidation per key.
 *
 * The oracle: « 100 événements identiques produisent un fetch utile ».
 * TanStack dedupes invalidations for the same key, so the fetch
 * protection is automatic; what we still need to avoid is the
 * re-render storm from invalidating 100 times in a 16 ms window
 * (the SSE event loop tick).
 *
 * The implementation is a per-instance timer that flushes a
 * deduplicated Set<QueryKey> at most every `windowMs` (default 50 ms).
 * The returned `flush()` forces an immediate flush; the returned
 * `stop()` cancels the pending timer and prevents future flushes
 * (the SSE cancel path calls this).
 */
export interface CoalescedInvalidate {
  enqueue(connection: WorkbenchConnection, event: WorkspaceEvent): void
  flush(): void
  stop(): void
}

export function createCoalescedInvalidate(
  client: QueryClient,
  options: { windowMs?: number; setTimeoutFn?: (cb: () => void, ms: number) => unknown; clearTimeoutFn?: (handle: unknown) => void } = {},
): CoalescedInvalidate {
  const windowMs = options.windowMs ?? 50
  const setT = options.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms))
  const clearT = options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let pending = new Set<string>()
  let pendingConnection: WorkbenchConnection | undefined
  let handle: unknown
  let stopped = false

  const schedule = () => {
    if (handle !== undefined) return
    handle = setT(() => { handle = undefined; flush() }, windowMs)
  }

  const flush = () => {
    if (stopped) return
    if (pending.size === 0) return
    if (!pendingConnection) return
    // WHY rebuild QueryKey from the serialized form: a QueryKey is a
    // readonly tuple; serializing to JSON lets us dedupe deep-equal
    // tuples (TanStack's matchKeys uses structural equality, but
    // building a Set<QueryKey> on the live objects is the simpler
    // path here). We pass the original tuple directly to the
    // QueryClient.
    if (handle !== undefined) { clearT(handle); handle = undefined }
    const keys = JSON.parse(`[${[...pending].join(",")}]`) as QueryKey[]
    pending = new Set()
    for (const key of keys) {
      void client.invalidateQueries({ queryKey: key })
    }
  }

  return {
    enqueue: (connection, event) => {
      if (stopped) return
      pendingConnection = connection
      for (const key of keysToInvalidate(connection, event)) {
        pending.add(JSON.stringify(key))
      }
      schedule()
    },
    flush,
    stop: () => {
      if (stopped) return
      stopped = true
      if (handle !== undefined) { clearT(handle); handle = undefined }
      pending = new Set()
    },
  }
}
