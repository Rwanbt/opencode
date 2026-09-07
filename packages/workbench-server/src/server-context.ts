/* SPDX-License-Identifier: MIT */
/**
 * ServerContext — the surface handlers see when they run.
 *
 * WHY a typed context: the route handlers used to be private methods on
 * WorkbenchServer, which made the class itself 1300+ lines long. Extracting
 * them to free functions required giving them access to the same per-server
 * state (workspace handles, session owners, the audit port, the capability
 * gate). The cleanest way to expose that without making everything `public`
 * on the class is to define the union of "what a handler needs" here and
 * have the class implement it; handlers are written against this interface
 * and called with the class as `this`.
 *
 * This is structural, not nominal — TypeScript checks that the class
 * matches, and the private fields are surfaced as plain (non-`#`) members
 * inside the class body. Tests do not access these members, so the
 * encapsulation that mattered (preventing external mutation) is unaffected.
 */
import type {
  BrowserAutomationBroker,
  CapabilityRegistry,
  DesktopAutomationBroker,
  McpUiControlBroker,
  P3Capability,
  RuntimeAdapter,
  RuntimeDecision,
  WorkspaceHandle,
  WorkspacePort,
} from "@unifia/contracts"
import type { ArtifactStore } from "@unifia/artifact-runtime"
import type { MemoryRuntime } from "@unifia/memory-runtime"
import type { WorkflowRuntimePort } from "./workflow-port.js"
import type { DesignSkillManifest, SkillRegistry } from "@unifia/skill-hub"
import type {
  PrincipalAuthenticator,
  RateLimiter,
  ScopedToken,
  ScopedTokenAuthority,
} from "./auth.js"
import type { OperationRegistry } from "./operations.js"
import type { PresentLinkSigner } from "./present-link.js"
import type {
  ArtifactStoreResolver,
  AuditPort,
  CapabilityGate,
  JsonRecord,
  PluginEntry,
  WorkbenchGithubSurface,
} from "./types.js"

export type ServerContext = {
  /** Injected dependencies. */
  readonly auth: PrincipalAuthenticator
  readonly rateLimiter: RateLimiter
  readonly workspace: WorkspacePort
  readonly runtime: RuntimeAdapter
  readonly audit: AuditPort
  readonly capability: CapabilityGate
  readonly instanceId: string
  readonly tokenIssuer: ScopedTokenAuthority | undefined
  readonly artifacts: ArtifactStore | ArtifactStoreResolver | undefined
  readonly browser: BrowserAutomationBroker | undefined
  readonly desktop: DesktopAutomationBroker | undefined
  readonly workflow: WorkflowRuntimePort | undefined
  readonly memory: MemoryRuntime | undefined
  readonly capabilities: CapabilityRegistry | undefined
  readonly ui: McpUiControlBroker | undefined
  readonly uiAllowedActions: ReadonlySet<string> | undefined
  readonly skillHub: SkillRegistry | undefined
  readonly designSkills: ((workspaceId: string) => Promise<readonly DesignSkillManifest[]>) | undefined
  readonly github: WorkbenchGithubSurface | undefined
  readonly allowedOrigins: readonly string[] | undefined
  readonly presentLinks: PresentLinkSigner | undefined

  /** Owned state — Maps are mutable so handlers can grow them in place. */
  readonly operations: OperationRegistry
  readonly tokens: Map<string, WorkspaceHandle>
  readonly runtimeTokens: Map<string, string>
  readonly nativeTokens: Map<string, Set<string>>
  readonly sessionOwners: Map<string, string>
  readonly pluginsByWorkspace: Map<string, readonly PluginEntry[]>

  /** Helpers handlers reach for. */
  authenticate(request: Request): Promise<import("./auth.js").Principal | undefined>
  authorize(request: Request, workspaceId: string): string | undefined
  bearer(request: Request): string | undefined
  artifactsFor(workspaceId: string): ArtifactStore | undefined
  runtimeToken(token: string): string
  checkCapability(
    capability: P3Capability,
    resource: string,
    principal: import("./auth.js").Principal,
  ): Promise<Response | undefined>
  allow(
    principal: import("./auth.js").Principal | null,
    action: string,
    opts?: {
      authorizingCapability?: P3Capability | null
      resource?: string | null
      reason?: string | null
      capability?: string
    },
  ): void
  deny(
    principal: import("./auth.js").Principal | null,
    action: string,
    status: number,
    opts?: {
      authorizingCapability?: P3Capability | null
      resource?: string | null
      reason?: string | null
      capability?: string
    },
  ): Response
  systemAudit(action: string, decision: RuntimeDecision, opts?: { reason?: string; resource?: string }): void
  userAudit(
    principal: import("./auth.js").Principal,
    action: string,
    decision: RuntimeDecision,
    opts?: {
      authorizingCapability?: P3Capability | null
      resource?: string | null
      reason?: string | null
      capability?: string
    },
  ): void
  registerNativeToken(token: ScopedToken): Promise<void>
  json(status: number, body: JsonRecord): Response
}
