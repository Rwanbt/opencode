/* SPDX-License-Identifier: MIT */
/**
 * Lifecycle methods on WorkbenchServer: native token issue/rotate/revoke
 * and the multi-session shutdown. Extracted from `server.ts` so the
 * class skeleton stays under the 200-LOC per-file budget.
 *
 * WHY free functions: these methods do not need any private state
 * beyond what's already on the ServerContext — they read it directly.
 * Making them free functions lets the class be a thin shell that
 * forwards the calls and keeps the lifecycle behaviour in one place.
 */
import type { ScopedToken, ScopedTokenRequest } from "./auth.js"
import { allow as allowFn, systemAudit as systemAuditFn } from "./audit-context.js"
import {
  registerNativeToken as registerNativeTokenFn,
  runtimeToken as runtimeTokenFn,
} from "./server-helpers.js"
import type { ServerContext } from "./server-context.js"

/**
 * Native bridge boundary for short-lived scoped credentials.
 * WHY this is a method instead of an HTTP route: the signing key and issuer
 * must remain inside the native/server process and never become WebView data.
 */
export async function issueNativeScopedToken(
  ctx: ServerContext,
  request: Omit<ScopedTokenRequest, "instanceId">,
): Promise<ScopedToken> {
  if (!ctx.tokenIssuer) throw new Error("scoped token issuer is not configured")
  const token = ctx.tokenIssuer.issue({ ...request, instanceId: ctx.instanceId })
  await registerNativeTokenFn(ctx, token)
  // DA-AUD-01: token issue is a system event (the call comes from the
  // native bridge, not a user-typed request). The principal in the
  // request body is recorded as the resource so a downstream reader
  // can correlate "who got this token" with "what was issued".
  allowFn(ctx, null, "token.issue", {
    resource: request.principalId,
    reason: `capabilities=${request.capabilities.length}`,
  })
  return token
}

export async function rotateNativeScopedToken(
  ctx: ServerContext,
  request: Omit<ScopedTokenRequest, "instanceId">,
): Promise<{ token: ScopedToken; previousToken: string | null; gracePeriodMs: number }> {
  if (!ctx.tokenIssuer) throw new Error("scoped token issuer is not configured")
  const rotation = ctx.tokenIssuer.rotate({ ...request, instanceId: ctx.instanceId })
  await registerNativeTokenFn(ctx, rotation.token)
  if (rotation.previousToken) {
    await registerNativeTokenFn(ctx, { ...rotation.token, token: rotation.previousToken })
  }
  allowFn(ctx, null, "token.rotate", {
    resource: request.principalId,
    reason: `capabilities=${request.capabilities.length}`,
  })
  return rotation
}

export async function revokeNativeScopedToken(ctx: ServerContext, workspaceId: string): Promise<void> {
  if (!ctx.tokenIssuer) throw new Error("scoped token issuer is not configured")
  ctx.tokenIssuer.revoke({ workspaceId, instanceId: ctx.instanceId })
  for (const token of ctx.nativeTokens.get(workspaceId) ?? []) {
    await ctx.workspace.close(ctx.runtimeTokens.get(token) ?? token).catch(() => undefined)
    ctx.runtimeTokens.delete(token)
    ctx.tokens.delete(token)
  }
  ctx.nativeTokens.delete(workspaceId)
  allowFn(ctx, null, "token.revoke", { resource: workspaceId })
}

/**
 * Closes every open file session.
 *
 * WHY it swallows per-token failures: shutdown must release as many sessions
 * as it can. One workspace whose root already vanished must not leave the
 * others holding watchers. The failures are returned so a caller can report
 * them rather than discover them silently.
 */
export async function shutdown(ctx: ServerContext): Promise<readonly string[]> {
  const failures: string[] = []
  for (const token of [...ctx.tokens.keys()]) {
    try {
      await ctx.workspace.close(runtimeTokenFn(ctx, token))
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "close failed")
    }
    ctx.tokens.delete(token)
    ctx.runtimeTokens.delete(token)
  }
  // DA-AUD-01: shutdown is a system event — no principal in scope, the
  // actor is the stable "system:workbench-server:workspace.shutdown"
  // string. `reason` carries the failure summary so a downstream reader
  // can tell a clean shutdown from a degraded one without joining the
  // live process.
  systemAuditFn(ctx, "workspace.shutdown", failures.length === 0 ? "allow" : "deny", {
    reason: failures.length === 0 ? "clean" : `${failures.length}-failures`,
  })
  return failures
}
