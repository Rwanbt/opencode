/* SPDX-License-Identifier: MIT */
/**
 * Per-request helpers shared by every handler.
 *
 * WHY a single module: `authenticate`, `authorize`, `bearer`,
 * `checkCapability`, `artifactsFor`, `runtimeToken` and
 * `registerNativeToken` are the building blocks almost every route uses.
 * Co-locating them keeps their protocols visible — `bearer`'s
 * Authorization fallback (legacy file-session token) is a documented quirk
 * future readers must not refactor away.
 */
import type { P3Capability } from "@unifia/contracts"
import type { ArtifactStore } from "@unifia/artifact-runtime"
import type { Principal, ScopedToken } from "./auth.js"
import { json } from "./http.js"
import { STEP_UP_ELIGIBLE_CAPABILITIES } from "./constants.js"
import { userAudit } from "./audit-context.js"
import type { ServerContext } from "./server-context.js"

/**
 * Reads the file-session token, which is a capability handle and NOT the
 * caller's identity — identity lives in `Authorization` and is resolved by
 * the PrincipalAuthenticator.
 *
 * WHY the Authorization fallback: callers that predate principal
 * authentication carry the file-session token in `Authorization: Bearer`.
 * The fallback is safe because the value is only ever looked up in
 * `ctx.tokens` — a principal token is never present there, so a misrouted
 * credential fails closed with 403 rather than granting access.
 */
export function bearer(_ctx: ServerContext, request: Request): string | undefined {
  const scoped = request.headers.get("x-unifia-file-session")
  if (scoped) return scoped
  const value = request.headers.get("authorization")
  if (value?.startsWith("Bearer ")) return value.slice(7)
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return undefined
  const protocols = request.headers.get("sec-websocket-protocol")?.split(",").map((part) => part.trim()) ?? []
  const index = protocols.indexOf("bearer")
  return index >= 0 ? protocols[index + 1] : undefined
}

/**
 * Resolve the principal for this request.
 *
 * Tries the injected authenticator first; if it has nothing, falls back to
 * a scoped-token verify (the file-session and the post-auth scoped tokens
 * share a single Authorization header in this branch).
 */
export async function authenticate(ctx: ServerContext, request: Request): Promise<Principal | undefined> {
  const principal = await ctx.auth.authenticate(request)
  if (principal) return principal
  const token = bearer(ctx, request)
  if (!token || !ctx.tokenIssuer) return undefined
  const claims = ctx.tokenIssuer.verify(token)
  if (!claims) return undefined
  return {
    id: claims.principalId,
    scopes: new Set(["workspace.open", ...claims.capabilities]),
    workspaces: new Set([claims.workspaceId]),
  }
}

/** Track a freshly-issued native token so revokeNativeScopedToken can find it. */
export async function registerNativeToken(ctx: ServerContext, token: ScopedToken): Promise<void> {
  const runtimeHandle = await ctx.workspace.open(token.workspaceId)
  ctx.tokens.set(token.token, { id: token.workspaceId, token: token.token })
  ctx.runtimeTokens.set(token.token, runtimeHandle.token)
  const tokens = ctx.nativeTokens.get(token.workspaceId) ?? new Set<string>()
  tokens.add(token.token)
  ctx.nativeTokens.set(token.workspaceId, tokens)
}

/** Look up the file-session token tied to `workspaceId` in the request. */
export function authorize(ctx: ServerContext, request: Request, workspaceId: string): string | undefined {
  const token = bearer(ctx, request)
  const handle = token ? ctx.tokens.get(token) : undefined
  return handle?.id === workspaceId ? token : undefined
}

/** Resolve the artifact store for a workspace, or `undefined` if no store was injected. */
export function artifactsFor(ctx: ServerContext, workspaceId: string): ArtifactStore | undefined {
  const artifacts = ctx.artifacts
  if (!artifacts) return undefined
  return typeof artifacts === "function" ? artifacts(workspaceId) : artifacts
}

/** Map a file-session token to the underlying runtime token. */
export function runtimeToken(ctx: ServerContext, token: string): string {
  return ctx.runtimeTokens.get(token) ?? token
}

/**
 * SEC-001: the principal's own granted scopes (built from
 * ScopedTokenRequest.capabilities at authenticate) are checked FIRST,
 * before the injected CapabilityGate ever runs. Before this fix, a token
 * scoped to ["workspace.read", "workspace.watch"] could still reach the
 * gate for "workflow.run" and get 202 approvalRequired — the gate's
 * server-wide allowlist has no idea what was actually granted to the
 * calling token. A capability the token was never issued must fail
 * closed at 403 without ever creating an approval — UNLESS the
 * capability is step-up eligible (STEP_UP_ELIGIBLE_CAPABILITIES): the
 * base connection lease only ever carries workspace.read/watch (see
 * READ_CAPABILITIES in provider.tsx), so artifact.create/export — real
 * operations Design/Work trigger — must still be able to reach the
 * approval gate below, or "saved"/"exported" break outright instead of
 * asking for confirmation. Every other capability (workspace.write,
 * workflow.run, desktop.control/observe, browser.navigate,
 * package.install) has no legitimate caller in this branch and is
 * refused before the gate runs, so it can never create an approval
 * either — see 2026-08-17 decision, capability-scope.test.ts.
 */
export async function checkCapability(
  ctx: ServerContext,
  capability: P3Capability,
  resource: string,
  principal: Principal,
): Promise<Response | undefined> {
  if (!principal.scopes.has(capability) && !STEP_UP_ELIGIBLE_CAPABILITIES.has(capability)) {
    return ctx.deny(principal, capability, 403, { authorizingCapability: capability, resource })
  }
  // DA-AUD-02: thread principal.id into the broker's `_actor` slot so the
  // broker's own observation (when wired) sees the caller. The gate's
  // allow/deny decision still does not consult the actor (see ADR-1034
  // §"Capability matrix"), but the value is now propagated to the audit row
  // in case a future gate policy needs it.
  const decision = await ctx.capability.check(capability, resource, principal.id)
  if (decision === "allow") return undefined
  if (typeof decision === "object") {
    userAudit(ctx, principal, capability, "approval_required", {
      authorizingCapability: capability,
      resource,
      reason: "broker.request",
    })
    return json(202, { approvalRequired: true, approvalId: decision.approvalId, capability })
  }
  return ctx.deny(principal, capability, 403, { authorizingCapability: capability, resource })
}
