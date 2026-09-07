/* SPDX-License-Identifier: MIT */
/**
 * WorkbenchServer — the workbench sidecar.
 *
 * Owns the in-memory state (open file sessions, native token lists,
 * per-workspace session owners, plugin catalogues, workflow owners) and
 * delegates request handling to:
 *  - `server-fetch.ts` for the request envelope (origin check, OPTIONS,
 *    catch-all audit)
 *  - `server-dispatch.ts` for route dispatch
 *  - `server-lifecycle.ts` for the native token methods and shutdown
 *  - `server-helpers.ts` for per-request helpers
 *  - `audit-context.ts` for `#allow` / `#deny` / `#systemAudit` / `#userAudit`
 *  - `handlers/*.ts` for the actual route bodies
 *
 * The class implements `ServerContext` so handlers can be called with
 * the instance as `this` without exposing implementation details to
 * external callers — tests do not poke at the fields.
 */
import { randomUUID } from "node:crypto"
import type {
  AuditContext,
  P3Capability,
  RuntimeDecision,
  WorkspaceHandle,
  WorkspacePort,
} from "@unifia/contracts"
import { FixedWindowRateLimiter } from "./auth.js"
import { OperationRegistry } from "./operations.js"
import { DEFAULT_RATE_BUDGET, DEFAULT_RATE_WINDOW_MS } from "./constants.js"
import {
  allow as allowFn,
  deny as denyFn,
  systemAudit as systemAuditFn,
  userAudit as userAuditFn,
} from "./audit-context.js"
import {
  artifactsFor as artifactsForFn,
  authenticate as authenticateFn,
  authorize as authorizeFn,
  bearer as bearerFn,
  checkCapability as checkCapabilityFn,
  registerNativeToken as registerNativeTokenFn,
  runtimeToken as runtimeTokenFn,
} from "./server-helpers.js"
import { json } from "./http.js"
import { fetch as fetchFn } from "./server-fetch.js"
import {
  issueNativeScopedToken as issueFn,
  revokeNativeScopedToken as revokeFn,
  rotateNativeScopedToken as rotateFn,
  shutdown as shutdownFn,
} from "./server-lifecycle.js"
import type { ServerContext } from "./server-context.js"
import type { ServerDependencies, JsonRecord, PluginEntry } from "./types.js"

export class WorkbenchServer implements ServerContext {
  readonly auth: ServerContext["auth"]
  readonly rateLimiter: ServerContext["rateLimiter"]
  readonly workspace: WorkspacePort
  readonly runtime: ServerContext["runtime"]
  readonly audit: ServerContext["audit"]
  readonly capability: ServerContext["capability"]
  readonly instanceId: string
  readonly tokenIssuer: ServerContext["tokenIssuer"]
  readonly artifacts: ServerContext["artifacts"]
  readonly browser: ServerContext["browser"]
  readonly desktop: ServerContext["desktop"]
  readonly workflow: ServerContext["workflow"]
  readonly memory: ServerContext["memory"]
  readonly capabilities: ServerContext["capabilities"]
  readonly ui: ServerContext["ui"]
  readonly uiAllowedActions: ServerContext["uiAllowedActions"]
  readonly skillHub: ServerContext["skillHub"]
  readonly designSkills: ServerContext["designSkills"]
  readonly github: ServerContext["github"]
  readonly presentLinks: ServerContext["presentLinks"]
  readonly allowedOrigins: ServerContext["allowedOrigins"]
  readonly operations: OperationRegistry
  readonly tokens = new Map<string, WorkspaceHandle>()
  readonly runtimeTokens = new Map<string, string>()
  readonly nativeTokens = new Map<string, Set<string>>()
  readonly sessionOwners = new Map<string, string>()
  readonly pluginsByWorkspace = new Map<string, readonly PluginEntry[]>()

  constructor(dependencies: ServerDependencies) {
    this.auth = dependencies.auth
    this.instanceId = dependencies.instanceId ?? randomUUID()
    this.tokenIssuer = dependencies.tokenIssuer
    this.presentLinks = dependencies.presentLinks
    this.allowedOrigins = dependencies.allowedOrigins
    // WHY: a limiter is always installed. An absent `rateLimiter` must mean
    // "use the default budget", never "no limit" — omission must not disable a
    // control.
    this.rateLimiter =
      dependencies.rateLimiter ?? new FixedWindowRateLimiter(DEFAULT_RATE_BUDGET, DEFAULT_RATE_WINDOW_MS)
    this.workspace = dependencies.workspace
    this.runtime = dependencies.runtime
    this.audit = dependencies.audit
    this.capability = dependencies.capability
    this.artifacts = dependencies.artifacts
    this.browser = dependencies.browser
    this.desktop = dependencies.desktop
    this.workflow = dependencies.workflow
    this.memory = dependencies.memory
    this.capabilities = dependencies.capabilities
    this.ui = dependencies.ui
    this.uiAllowedActions = dependencies.uiAllowedActions
    this.skillHub = dependencies.skillHub
    this.designSkills = dependencies.designSkills
    this.github = dependencies.github
    this.operations = new OperationRegistry(() => `operation-${randomUUID()}`)
  }

  // The following are ServerContext pass-throughs so handlers can be called
  // with `this: ServerContext` while keeping the methods bound to the class.
  fetch(request: Request): Promise<Response> {
    return fetchFn(this, request)
  }
  issueNativeScopedToken(request: Omit<import("./auth.js").ScopedTokenRequest, "instanceId">) {
    return issueFn(this, request)
  }
  rotateNativeScopedToken(request: Omit<import("./auth.js").ScopedTokenRequest, "instanceId">) {
    return rotateFn(this, request)
  }
  revokeNativeScopedToken(workspaceId: string) {
    return revokeFn(this, workspaceId)
  }
  shutdown() {
    return shutdownFn(this)
  }

  /** Number of file sessions currently open. Exposed for shutdown assertions. */
  get openFileSessions(): number {
    return this.tokens.size
  }

  authenticate(request: Request) {
    return authenticateFn(this, request)
  }
  authorize(request: Request, workspaceId: string) {
    return authorizeFn(this, request, workspaceId)
  }
  bearer(request: Request) {
    return bearerFn(this, request)
  }
  artifactsFor(workspaceId: string) {
    return artifactsForFn(this, workspaceId)
  }
  runtimeToken(token: string) {
    return runtimeTokenFn(this, token)
  }
  checkCapability(capability: P3Capability, resource: string, principal: import("./auth.js").Principal) {
    return checkCapabilityFn(this, capability, resource, principal)
  }
  registerNativeToken(token: import("./auth.js").ScopedToken) {
    return registerNativeTokenFn(this, token)
  }
  allow(principal: import("./auth.js").Principal | null, action: string, opts?: Parameters<typeof allowFn>[3]) {
    return allowFn(this, principal, action, opts)
  }
  deny(
    principal: import("./auth.js").Principal | null,
    action: string,
    status: number,
    opts?: Parameters<typeof denyFn>[4],
  ) {
    return denyFn(this, principal, action, status, opts)
  }
  systemAudit(action: string, decision: RuntimeDecision, opts?: { reason?: string; resource?: string }) {
    return systemAuditFn(this, action, decision, opts)
  }
  userAudit(
    principal: import("./auth.js").Principal,
    action: string,
    decision: RuntimeDecision,
    opts?: Parameters<typeof userAuditFn>[4],
  ) {
    return userAuditFn(this, principal, action, decision, opts)
  }
  json(status: number, body: JsonRecord): Response {
    return json(status, body)
  }
}

/** Re-exported here so consumers don't have to import from `types.ts` directly. */
export type { AuditContext }
