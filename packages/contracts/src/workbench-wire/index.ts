/* SPDX-License-Identifier: MIT */

export const WIRE_PROTOCOL_VERSION = 1 as const
export const WORKBENCH_EVENT_TYPES = [
  "workspace.changed",
  "operation.updated",
  "approval.updated",
  "catalog.updated",
  "trace.appended",
] as const

export type WorkbenchEventType = (typeof WORKBENCH_EVENT_TYPES)[number]
export type EventMergeRule = "append-only" | "replace" | "last-wins" | "state-snapshot"

/**
 * WHY a separate MUTATION_EVENT_TYPES set: the wire contract distinguishes
 * events that target ONE resource (workspace.changed, operation.updated,
 * approval.updated) from events that target the WHOLE aggregate (catalog
 * replacement, trace append). Only mutations must carry a `resource` field
 * identifying the affected entity — without it, the event→query key
 * invalidation map (E12) cannot scope the refetch to one TanStack key.
 */
export const MUTATION_EVENT_TYPES = [
  "workspace.changed",
  "operation.updated",
  "approval.updated",
] as const
export type MutationEventType = (typeof MUTATION_EVENT_TYPES)[number]
export const isMutationEventType = (type: WorkbenchEventType): type is MutationEventType =>
  (MUTATION_EVENT_TYPES as readonly WorkbenchEventType[]).includes(type)

/**
 * Identifies the single resource a mutation event targets.
 *
 * WHY `type` is a free-form string (not a TS union): the set of resource
 * types is owned by the producer side (server-side handlers emit
 * "workspace" / "operation" / "approval" today; future handlers may add
 * "design-skill", "file-session", etc.). Locking the union here would force
 * the wire to track every producer; the parser only needs to know the
 * `resource` is a non-empty object so the consumer's narrowing is sound.
 */
export interface ResourceRef {
  type: string
  id: string
}

export const EVENT_MERGE_RULES: Record<WorkbenchEventType, EventMergeRule> = {
  "workspace.changed": "state-snapshot",
  "operation.updated": "last-wins",
  "approval.updated": "replace",
  "catalog.updated": "replace",
  "trace.appended": "append-only",
}

export const WIRE_POLICY = {
  resyncSequenceGap: 1,
  cursorMaxAgeMs: 15 * 60 * 1000,
  tokenGracePeriodMs: 30 * 1000,
  maxSseConnectionsPerWorkspace: 2,
  maxSseConnectionsPerInstance: 4,
  maxEventsPerSecond: {
    "workspace.changed": 20,
    "operation.updated": 50,
    "approval.updated": 20,
    "catalog.updated": 5,
    "trace.appended": 200,
  },
} as const

export type OpaqueCursor = string & { readonly __opaqueCursor: unique symbol }
export type IdempotencyKey = string & { readonly __idempotencyKey: unique symbol }

/**
 * Every request header a legitimate caller (browser WorkbenchClient or the
 * native/sidecar bridge) sends to the workbench server. Single source of
 * truth for both sides of the CORS contract (FUNC-002): the client types its
 * header maps against `WorkbenchRequestHeader` so an undeclared header
 * becomes a type error, and the server derives `access-control-allow-headers`
 * from this same list instead of a hand-maintained string that can drift.
 */
export const WORKBENCH_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "idempotency-key",
  "last-event-id",
  "x-unifia-file-session",
] as const
export type WorkbenchRequestHeader = (typeof WORKBENCH_REQUEST_HEADERS)[number]

export interface HandshakeRequest {
  kind: "workbench.handshake"
  protocolVersion: number
  supportedVersions: readonly number[]
  clientInstanceId: string
}

export interface HandshakeResponse {
  kind: "workbench.handshake.accepted" | "workbench.handshake.refused"
  accepted: boolean
  protocolVersion: number | null
  supportedVersions: readonly number[]
  instanceId: string
  reason?: "unsupported-version" | "invalid-request"
}

/**
 * WHY a discriminated union rather than a flat interface with optional
 * `resource`: TypeScript cannot enforce "this field is required when this
 * discriminator matches" on a flat object. A consumer doing
 * `if (event.type === "operation.updated") invalidate(event.resource.id)`
 * must be statically guaranteed that `resource` is present — and the
 * parser must throw when it is missing, otherwise the consumer gets
 * `undefined` at runtime and refetches the whole workspace instead of
 * the one key it should have.
 *
 * E11 oracle: « chaque mutation produit une ressource/ID ». Bulk events
 * (catalog.updated, trace.appended) intentionally have no `resource`
 * because the producer is the whole aggregate; the consumer falls back
 * to coarse invalidation by design (catalog changes mean the cached
 * catalog is stale; traces never need a refetch).
 */
export interface WorkspaceEventBase {
  eventId: string
  workspaceId: string
  sequenceId: number
  cursor: OpaqueCursor
  payload: unknown
}

export type WorkspaceMutationEvent =
  | (WorkspaceEventBase & { type: "workspace.changed"; resource: ResourceRef })
  | (WorkspaceEventBase & { type: "operation.updated"; resource: ResourceRef })
  | (WorkspaceEventBase & { type: "approval.updated"; resource: ResourceRef })

export type WorkspaceBulkEvent =
  | (WorkspaceEventBase & { type: "catalog.updated" })
  | (WorkspaceEventBase & { type: "trace.appended" })

export type WorkspaceEvent = WorkspaceMutationEvent | WorkspaceBulkEvent

export interface PageRequest {
  workspaceId: string
  cursor?: OpaqueCursor
  pageSize: number
}

export interface Page<T> {
  items: readonly T[]
  nextCursor: OpaqueCursor | null
  hasMore: boolean
}

export interface BinaryPayloadRef {
  kind: "binary-ref"
  url: string
  expiresAt: number
  sha256: string
  byteLength: number
}

export interface AcceptedOperation {
  status: 202
  operationId: string
  approvalId: string | null
  idempotencyKey: IdempotencyKey
}

export interface TokenRotation {
  state: "rotating"
  token: string
  previousToken: string | null
  gracePeriodMs: number
  expiresAt: number
}

export interface WireProtocolError {
  code: "unsupported-version" | "stale-cursor" | "expired-cursor" | "rate-limited"
  message: string
  supportedVersions?: readonly number[]
  retryAfterMs?: number
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return value
}

const requireFiniteNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${field} must be finite`)
  return value
}

export const parseOpaqueCursor = (value: unknown): OpaqueCursor => {
  const cursor = requireString(value, "cursor")
  if (cursor.length > 512) throw new TypeError("cursor exceeds the 512 character limit")
  return cursor as OpaqueCursor
}

export const parseIdempotencyKey = (value: unknown): IdempotencyKey => {
  const key = requireString(value, "idempotencyKey").toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    throw new TypeError("idempotencyKey must be a UUID v7")
  }
  return key as IdempotencyKey
}

export const createIdempotencyKey = (timestamp = Date.now()): IdempotencyKey => {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) throw new Error("Web Crypto is required to create an idempotency key")
  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  let time = Math.max(0, Math.floor(timestamp))
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256
    time = Math.floor(time / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return parseIdempotencyKey(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`)
}

export const parseHandshakeRequest = (value: unknown): HandshakeRequest => {
  if (!isRecord(value) || value.kind !== "workbench.handshake") throw new TypeError("invalid handshake request")
  const supportedVersions = value.supportedVersions
  if (!Array.isArray(supportedVersions) || supportedVersions.some((version) => !Number.isInteger(version))) {
    throw new TypeError("supportedVersions must be an integer array")
  }
  return {
    kind: value.kind,
    protocolVersion: requireFiniteNumber(value.protocolVersion, "protocolVersion"),
    supportedVersions,
    clientInstanceId: requireString(value.clientInstanceId, "clientInstanceId"),
  }
}

export const parseHandshakeResponse = (value: unknown): HandshakeResponse => {
  if (!isRecord(value) || !["workbench.handshake.accepted", "workbench.handshake.refused"].includes(value.kind as string)) {
    throw new TypeError("invalid handshake response")
  }
  const supportedVersions = value.supportedVersions
  if (!Array.isArray(supportedVersions) || supportedVersions.some((version) => !Number.isInteger(version))) {
    throw new TypeError("supportedVersions must be an integer array")
  }
  if (typeof value.accepted !== "boolean") throw new TypeError("accepted must be boolean")
  if (value.accepted !== (value.kind === "workbench.handshake.accepted")) throw new TypeError("handshake kind and accepted disagree")
  return {
    kind: value.kind as HandshakeResponse["kind"],
    accepted: value.accepted,
    protocolVersion: value.protocolVersion === null ? null : requireFiniteNumber(value.protocolVersion, "protocolVersion"),
    supportedVersions,
    instanceId: requireString(value.instanceId, "instanceId"),
    reason: value.reason as HandshakeResponse["reason"],
  }
}

export const parsePageRequest = (value: unknown): PageRequest => {
  if (!isRecord(value)) throw new TypeError("invalid page request")
  const pageSize = requireFiniteNumber(value.pageSize, "pageSize")
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new TypeError("pageSize must be between 1 and 100")
  return {
    workspaceId: requireString(value.workspaceId, "workspaceId"),
    cursor: value.cursor === undefined ? undefined : parseOpaqueCursor(value.cursor),
    pageSize,
  }
}

export const parseTokenRotation = (value: unknown): TokenRotation => {
  if (!isRecord(value) || value.state !== "rotating") throw new TypeError("invalid token rotation")
  const gracePeriodMs = requireFiniteNumber(value.gracePeriodMs, "gracePeriodMs")
  if (gracePeriodMs < 0 || gracePeriodMs > WIRE_POLICY.tokenGracePeriodMs) throw new TypeError("grace period exceeds policy")
  return {
    state: "rotating",
    token: requireString(value.token, "token"),
    previousToken: value.previousToken === null ? null : requireString(value.previousToken, "previousToken"),
    gracePeriodMs,
    expiresAt: requireFiniteNumber(value.expiresAt, "expiresAt"),
  }
}

export const parseWorkspaceEvent = (value: unknown): WorkspaceEvent => {
  if (!isRecord(value) || !WORKBENCH_EVENT_TYPES.includes(value.type as WorkbenchEventType)) throw new TypeError("invalid workspace event")
  const sequenceId = requireFiniteNumber(value.sequenceId, "sequenceId")
  if (!Number.isInteger(sequenceId) || sequenceId < 0) throw new TypeError("sequenceId must be a non-negative integer")
  const base = {
    eventId: requireString(value.eventId, "eventId"),
    workspaceId: requireString(value.workspaceId, "workspaceId"),
    sequenceId,
    cursor: parseOpaqueCursor(value.cursor),
    payload: value.payload,
  }
  // WHY: the parser is the ONE place that decides whether a wire event
  // carries a `resource`. Mutation events must always include it (the
  // event→query key map in E12 scopes invalidation on `resource.id`).
  // Bulk events are identified by their type alone — a present `resource`
  // on a bulk event is silently ignored to keep producers honest about
  // which kind of event they are emitting.
  if (isMutationEventType(value.type as WorkbenchEventType)) {
    if (!isRecord(value.resource)) throw new TypeError("resource must be an object for mutation events")
    const resource: ResourceRef = {
      type: requireString(value.resource.type, "resource.type"),
      id: requireString(value.resource.id, "resource.id"),
    }
    return { ...base, type: value.type as MutationEventType, resource }
  }
  return { ...base, type: value.type as "catalog.updated" | "trace.appended" }
}

export const parseBinaryPayloadRef = (value: unknown): BinaryPayloadRef => {
  if (!isRecord(value) || value.kind !== "binary-ref") throw new TypeError("invalid binary payload reference")
  const byteLength = requireFiniteNumber(value.byteLength, "byteLength")
  if (!Number.isInteger(byteLength) || byteLength < 0) throw new TypeError("byteLength must be a non-negative integer")
  return {
    kind: value.kind,
    url: requireString(value.url, "url"),
    expiresAt: requireFiniteNumber(value.expiresAt, "expiresAt"),
    sha256: requireString(value.sha256, "sha256"),
    byteLength,
  }
}

export const parseAcceptedOperation = (value: unknown): AcceptedOperation => {
  if (!isRecord(value) || value.status !== 202) throw new TypeError("invalid accepted operation")
  return {
    status: 202,
    operationId: requireString(value.operationId, "operationId"),
    approvalId: value.approvalId === null ? null : requireString(value.approvalId, "approvalId"),
    idempotencyKey: parseIdempotencyKey(value.idempotencyKey),
  }
}
