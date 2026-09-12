/* SPDX-License-Identifier: MIT */

import { WORK_V1_FUNCTIONS, type WorkFunction } from "./modes.js"

export type ArtifactLineage = "work/document" | "design/render"
export type WorkbenchTransportMethod = "GET" | "POST" | "PUT" | "DELETE"

export type WorkbenchRoute = {
  readonly surface: "work" | "design"
  readonly operation: WorkFunction
  readonly method: WorkbenchTransportMethod
  readonly route: `/v1/${string}`
  readonly capability: string
  readonly event: string
  readonly lineage?: ArtifactLineage
}

type RouteByWorkFunction = { readonly [FunctionName in WorkFunction]: WorkbenchRoute }

/**
 * The route matrix is intentionally a total mapped type. Adding a Work V1
 * function without registering its route is a compile-time error.
 */
export const WORKBENCH_ROUTE_REGISTRY: RouteByWorkFunction = {
  "workspace-switcher": { surface: "work", operation: "workspace-switcher", method: "GET", route: "/v1/workspaces", capability: "workspace.open", event: "workspace.changed" },
  "session-chat": { surface: "work", operation: "session-chat", method: "POST", route: "/v1/sessions/:sessionId/prompt", capability: "session.prompt", event: "operation.updated" },
  // C1-2/C2-2: the server only ever accepted POST here (index.ts's #files
  // handler); the client's real readFiles() already sends POST. This entry
  // declared GET, which is what made it drift-detectable in the first place.
  files: { surface: "work", operation: "files", method: "POST", route: "/v1/files/read", capability: "workspace.read", event: "workspace.changed" },
  search: { surface: "work", operation: "search", method: "GET", route: "/v1/files/search", capability: "workspace.read", event: "workspace.changed" },
  artifacts: { surface: "work", operation: "artifacts", method: "GET", route: "/v1/artifacts", capability: "workspace.read", event: "catalog.updated", lineage: "work/document" },
  documents: { surface: "work", operation: "documents", method: "GET", route: "/v1/documents", capability: "workspace.read", event: "catalog.updated", lineage: "work/document" },
  trace: { surface: "work", operation: "trace", method: "GET", route: "/v1/trace", capability: "trace.read", event: "trace.appended" },
  approvals: { surface: "work", operation: "approvals", method: "GET", route: "/v1/approvals", capability: "approval.read", event: "approval.updated" },
  "activity-log": { surface: "work", operation: "activity-log", method: "GET", route: "/v1/activity", capability: "trace.read", event: "trace.appended" },
  "capability-picker": { surface: "work", operation: "capability-picker", method: "GET", route: "/v1/capabilities/search", capability: "package.install", event: "catalog.updated" },
  export: { surface: "design", operation: "export", method: "POST", route: "/v1/artifacts/export", capability: "artifact.export", event: "operation.updated", lineage: "design/render" },
}

export const WORKBENCH_ROUTE_OPERATIONS = Object.keys(WORKBENCH_ROUTE_REGISTRY) as WorkFunction[]

export function routeFor(operation: WorkFunction): WorkbenchRoute {
  return WORKBENCH_ROUTE_REGISTRY[operation]
}

export function routesForLineage(lineage: ArtifactLineage): readonly WorkbenchRoute[] {
  return WORKBENCH_ROUTE_OPERATIONS.map((operation) => WORKBENCH_ROUTE_REGISTRY[operation]).filter((route) => route.lineage === lineage)
}

export type WorkbenchServerRoute = {
  readonly method: WorkbenchTransportMethod
  readonly route: `/v1/${string}`
  readonly capability: string
  readonly event: string
}

/** M6 routes are registered here before the server implementation consumes them. */
export const M6_SERVER_ROUTE_REGISTRY = {
  sessionEvents: { method: "GET", route: "/v1/sessions/:sessionId/events", capability: "workspace.watch", event: "trace.appended" },
  // C2-2/FUNC-001: the client connects once per workspace, not per session
  // (see WorkbenchClient.events()); the server fans in every session's
  // events into one stream for this route.
  workspaceEvents: { method: "GET", route: "/v1/workspaces/:workspaceId/events", capability: "workspace.watch", event: "trace.appended" },
  operationCancel: { method: "POST", route: "/v1/operations/:operationId/cancel", capability: "workspace.watch", event: "operation.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M7 file index routes are registered before the server implementation consumes them. */
export const M7_SERVER_ROUTE_REGISTRY = {
  filesList: { method: "GET", route: "/v1/files/list", capability: "workspace.read", event: "workspace.changed" },
  filesSearch: { method: "GET", route: "/v1/files/search", capability: "workspace.read", event: "workspace.changed" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M8 approval and audit read routes are registered before server consumption. */
export const M8_SERVER_ROUTE_REGISTRY = {
  approvalsList: { method: "GET", route: "/v1/approvals", capability: "approval.read", event: "approval.updated" },
  tracePage: { method: "GET", route: "/v1/trace", capability: "trace.read", event: "trace.appended" },
  activityPage: { method: "GET", route: "/v1/activity", capability: "trace.read", event: "trace.appended" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M9a artifact read routes are registered before server consumption. */
export const M9A_SERVER_ROUTE_REGISTRY = {
  artifactsList: { method: "GET", route: "/v1/artifacts", capability: "workspace.read", event: "catalog.updated" },
  artifactDetail: { method: "GET", route: "/v1/artifacts/:artifactId", capability: "workspace.read", event: "catalog.updated" },
  artifactHistory: { method: "GET", route: "/v1/artifacts/:artifactId/history", capability: "workspace.read", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M9b artifact lineage write route is registered before server consumption. */
export const M9B_SERVER_ROUTE_REGISTRY = {
  artifactCreate: { method: "POST", route: "/v1/artifacts", capability: "artifact.create", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M10 export route remains approval-gated by the server capability broker. */
export const M10_SERVER_ROUTE_REGISTRY = {
  artifactExport: { method: "POST", route: "/v1/artifacts/export", capability: "artifact.export", event: "operation.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/**
 * P10 raw artifact read route. The iframe created in P11 fetches
 * artifact bodies through this route to mount them as a sandboxed
 * document (ADR-1035). Capability `artifact.preview` is step-up
 * eligible per ADR-1038 — a per-request grant issued by the broker.
 */
export const P10_SERVER_ROUTE_REGISTRY = {
  artifactRaw: { method: "GET", route: "/v1/artifacts/:artifactId/raw/:path", capability: "artifact.preview", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M11 validates untrusted specs without granting their requested capabilities. */
export const M11_SERVER_ROUTE_REGISTRY = {
  specValidate: { method: "POST", route: "/v1/specs/validate", capability: "workspace.read", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M15 capability picker consumes the scoped server search route. */
export const M15_SERVER_ROUTE_REGISTRY = {
  capabilitySearch: { method: "GET", route: "/v1/capabilities/search", capability: "package.install", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** M20 Design System catalogs are read from the explicit workspace manifest. */
export const M20_SERVER_ROUTE_REGISTRY = {
  designSystems: { method: "GET", route: "/v1/design-systems", capability: "workspace.read", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/**
 * M22 — Phase 9.4 present links. Only the mint route is registered here:
 * it's a normal, capability-gated, Bearer-authenticated call. The route
 * it mints a token for (`GET /v1/artifacts/:artifactId/present?token=`)
 * is deliberately unauthenticated (that's the point — see present-link.ts
 * on the server) and is opened directly via the returned URL, never
 * called through WorkbenchClient.
 */
export const M22_SERVER_ROUTE_REGISTRY = {
  artifactPresentLink: { method: "POST", route: "/v1/artifacts/:artifactId/present", capability: "artifact.export", event: "operation.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** P23 design-skill manifests exposed to the Design composer picker. */
export const M23_SERVER_ROUTE_REGISTRY = {
  designSkills: { method: "GET", route: "/v1/design-skills", capability: "workspace.read", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/**
 * M21 — Design Files tab CRUD (parity Phase 7.3): create, delete, rename
 * (upload reuses create with base64-encoded content). Deliberately not
 * `/v1/files/write` — that route predates this registry (the server's
 * `#files` handler already dispatched it) but refuses to create a new
 * path, an asserted safety invariant (`workspace-runtime/test/runtime.test.ts`
 * — "silent file creation was not denied"); `create` is a distinct
 * server capability with the opposite refusal (target must NOT exist),
 * mirroring how `createArtifact` is already separate from "modify an
 * artifact" elsewhere in this contract.
 */
export const M21_SERVER_ROUTE_REGISTRY = {
  filesCreate: { method: "POST", route: "/v1/files/create", capability: "workspace.write", event: "workspace.changed" },
  filesRemove: { method: "POST", route: "/v1/files/remove", capability: "workspace.write", event: "workspace.changed" },
  filesRename: { method: "POST", route: "/v1/files/rename", capability: "workspace.write", event: "workspace.changed" },
} as const satisfies Record<string, WorkbenchServerRoute>

/** P25 GitHub account surface; tokens never cross this boundary. */
export const M25_SERVER_ROUTE_REGISTRY = {
  githubStatus: { method: "GET", route: "/v1/github/status", capability: "workspace.read", event: "catalog.updated" },
  githubDeviceStart: { method: "POST", route: "/v1/github/device/start", capability: "workspace.write", event: "operation.updated" },
  githubDevicePoll: { method: "POST", route: "/v1/github/device/poll", capability: "workspace.write", event: "operation.updated" },
  githubDeviceCancel: { method: "POST", route: "/v1/github/device/cancel", capability: "workspace.write", event: "operation.updated" },
  githubDisconnect: { method: "POST", route: "/v1/github/disconnect", capability: "workspace.write", event: "catalog.updated" },
} as const satisfies Record<string, WorkbenchServerRoute>

/**
 * Capabilities the Design/Work WebView leases at connection time — the scopes
 * baked into the token the native bridge issues.
 *
 * WHY workspace.write is here: the lease used to be read/watch only, which
 * predated the Fichiers CRUD (M21) and the composer attachments that reuse it.
 * #checkCapability refuses any capability absent from the calling token's
 * scopes before the approval gate runs, so every one of those routes answered
 * 403 in the shipped app while passing its own tests against a fully-scoped
 * test principal.
 *
 * artifact.preview is here for the same reason and is narrower than
 * workspace.read: it reads one artifact's bytes, not arbitrary workspace
 * files. Without it ArtifactPreview's readArtifactRaw answered a flat 403,
 * since artifact.preview is not step-up eligible either.
 *
 * Step-up eligible capabilities are deliberately NOT here: the server lets a
 * base-scoped token reach the gate for those, so the lease does not need them.
 */
export const SURFACE_LEASE_CAPABILITIES = ["workspace.read", "workspace.write", "workspace.watch", "artifact.preview"] as const

/** Registries whose routes the Design/Work surfaces actually call. */
const SURFACE_REGISTRIES = [
  M6_SERVER_ROUTE_REGISTRY,
  M7_SERVER_ROUTE_REGISTRY,
  M9A_SERVER_ROUTE_REGISTRY,
  M9B_SERVER_ROUTE_REGISTRY,
  M10_SERVER_ROUTE_REGISTRY,
  M11_SERVER_ROUTE_REGISTRY,
  M20_SERVER_ROUTE_REGISTRY,
  M21_SERVER_ROUTE_REGISTRY,
  M22_SERVER_ROUTE_REGISTRY,
  M23_SERVER_ROUTE_REGISTRY,
  M25_SERVER_ROUTE_REGISTRY,
  P10_SERVER_ROUTE_REGISTRY,
] as const

/** Every capability those registries demand, deduplicated. */
export const SURFACE_REQUIRED_CAPABILITIES: readonly string[] = [
  ...new Set(SURFACE_REGISTRIES.flatMap((registry) => Object.values(registry).map((route) => route.capability))),
].sort()

const missingOperations = WORK_V1_FUNCTIONS.filter((operation) => !WORKBENCH_ROUTE_OPERATIONS.includes(operation))
if (missingOperations.length > 0) throw new Error(`route registry is missing Work V1 operations: ${missingOperations.join(", ")}`)
