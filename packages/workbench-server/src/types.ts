/* SPDX-License-Identifier: MIT */
/**
 * Type definitions for the workbench-server.
 *
 * WHY a dedicated file: these shapes are referenced by every other module
 * (handlers, helpers, the WorkbenchServer class itself). Co-locating them
 * keeps the cross-import graph one-directional and avoids the cycle that
 * would form if a handler had to import the class just to type a parameter.
 */
import type {
  ApprovalRequestRecord,
  AuditContext,
  AuditEvent,
  BrowserAutomationBroker,
  CapabilityRegistry,
  DesktopAutomationBroker,
  McpUiControlBroker,
  P3Capability,
  RuntimeAdapter,
  RuntimeDecision,
  UiAction,
  WorkspaceHandle,
  WorkspacePort,
} from "@unifia/contracts"
import type { ArtifactStore } from "@unifia/artifact-runtime"
import type { MemoryRuntime } from "@unifia/memory-runtime"
import type { WorkflowRuntimePort } from "./workflow-port.js"
import type { DesignSkillManifest, SkillRegistry } from "@unifia/skill-hub"
import type { PrincipalAuthenticator, RateLimiter, ScopedTokenAuthority } from "./auth.js"
import type { PresentLinkSigner } from "./present-link.js"

/** Audit port — the only method the server needs from the runtime. */
export type AuditPort = {
  record(context: AuditContext, decision: RuntimeDecision): unknown
  page?: (afterSequence: number, limit: number) => { events: readonly AuditEvent[]; nextCursor: number | null }
}

/** Outcome of a capability check. */
export type CapabilityDecision = "allow" | "deny" | { kind: "approval_required"; approvalId: string }

/** Gate that the server consults before sensitive routes. */
export type CapabilityGate = {
  check(capability: P3Capability, resource: string, actor: string): Promise<CapabilityDecision>
  getApproval?: (id: string) => { resource: string } | undefined
  listApprovals?: (resource: string) => readonly ApprovalRequestRecord[]
  resolve?: (id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) => unknown
  cancel?: (id: string) => unknown
}

/** GitHub surface dependency. */
export type WorkbenchGithubSurface = {
  status(workspaceId: string): Promise<Record<string, unknown>>
  deviceStart(workspaceId: string): Promise<Record<string, unknown>>
  devicePoll(workspaceId: string): Promise<Record<string, unknown>>
  deviceCancel(workspaceId: string): Promise<{ ok: boolean }>
  disconnect(workspaceId: string): Promise<{ ok: boolean }>
}

/**
 * Resolves the artifact lineage for one workspace.
 *
 * WHY a resolver and not one store: ArtifactStore.list() takes no workspace and
 * reads a single directory, so a store shared by every workspace the sidecar
 * serves would let workspace A list and read workspace B's artifacts. The
 * routes all authorize a workspaceId already; this makes the storage honour the
 * same boundary. Tests that only ever use one workspace may still pass a plain
 * store.
 */
export type ArtifactStoreResolver = (workspaceId: string) => ArtifactStore

/** All injected dependencies of WorkbenchServer. */
export type ServerDependencies = {
  auth: PrincipalAuthenticator
  rateLimiter?: RateLimiter
  workspace: WorkspacePort
  runtime: RuntimeAdapter
  audit: AuditPort
  capability: CapabilityGate
  instanceId?: string
  tokenIssuer?: ScopedTokenAuthority
  artifacts?: ArtifactStore | ArtifactStoreResolver
  browser?: BrowserAutomationBroker
  desktop?: DesktopAutomationBroker
  workflow?: WorkflowRuntimePort
  memory?: MemoryRuntime
  capabilities?: CapabilityRegistry
  ui?: McpUiControlBroker
  uiAllowedActions?: ReadonlySet<string>
  skillHub?: SkillRegistry
  designSkills?: (workspaceId: string) => Promise<readonly DesignSkillManifest[]>
  github?: WorkbenchGithubSurface
  allowedOrigins?: readonly string[]
  workspaceEventsPollMs?: number
  presentLinks?: PresentLinkSigner
}

/** Common JSON object shape. */
export type JsonRecord = Record<string, unknown>

/** Re-exported for handler files. */
export type { UiAction, WorkspaceHandle }

/** Plugin entry shape, used by the plugin handlers. */
export type PluginEntry = { id: string; name: string; version: string; capabilities: readonly string[] }
