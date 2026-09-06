/* SPDX-License-Identifier: MIT */
/**
 * Approval lifecycle: resolve, cancel, list, and the per-workspace
 * audit/activity paginator.
 *
 * WHY the file-session token is the only auth for resolve/cancel: the
 * approval is bound to the workspace that minted it (see
 * `capability.getApproval(id).resource`), and the token is the
 * capability handle. The principal is recovered separately for audit
 * attribution (DA-AUD-02).
 */
import { body, json } from "../http.js"
import { userAudit } from "../audit-context.js"
import type { ServerContext } from "../server-context.js"

/** POST or DELETE /v1/approvals/:id */
export async function approval(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const token = ctx.bearer(request)
  const approval = token ? ctx.capability.getApproval?.(id) : undefined
  if (!token || !approval || ctx.tokens.get(token)?.id !== approval.resource) {
    return ctx.deny(null, "approval.scope", 403)
  }
  // DA-AUD-02: thread principal.id into the approval audit rows. The
  // file-session token is the capability handle, not the caller's identity
  // (see #bearer doc) — the principal is recovered via #authenticate as
  // every other handler does, so the audit row answers "who clicked
  // Allow/Deny?" rather than the server identity.
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "approval.principal", 401)
  if (request.method === "DELETE") {
    const decision = ctx.capability.cancel?.(id)
    if (!decision) return ctx.deny(principal, "approval.cancel", 404, { resource: approval.resource })
    userAudit(ctx, principal, "approval.cancel", "deny", {
      resource: approval.resource,
      reason: "user-cancelled",
    })
    return json(200, { decision })
  }
  const input = await body(request)
  if (input.decision !== "allow" && input.decision !== "deny") {
    return ctx.deny(principal, "approval.resolve", 400, { resource: approval.resource })
  }
  // DA-AUD-02: pass principal.id as the broker's actor so the resolved
  // approval carries the resolving principal's identity.
  const decision = ctx.capability.resolve?.(id, input.decision, principal.id, approval.resource)
  if (!decision) return ctx.deny(principal, "approval.resolve", 404, { resource: approval.resource })
  const decisionKind = (decision as { kind?: string }).kind
  userAudit(ctx, principal, "approval.resolve", decisionKind === "allow" ? "allow" : "deny", {
    resource: approval.resource,
    reason: `user-${decisionKind ?? "unknown"}`,
  })
  return json(200, { decision })
}

/** GET /v1/approvals?workspaceId=… */
export async function approvalList(ctx: ServerContext, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get("workspaceId")
  const token = workspaceId ? ctx.authorize(request, workspaceId) : undefined
  if (!workspaceId || !token) return ctx.deny(null, "approval.list.scope", 403, { resource: workspaceId ?? null })
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "approval.list.principal", 401)
  const approvals = ctx.capability.listApprovals?.(workspaceId)
  if (!approvals) return ctx.deny(principal, "approval.list.unavailable", 503, { resource: workspaceId })
  ctx.allow(principal, "approval.list", { resource: workspaceId })
  return json(200, { approvals })
}

/** GET /v1/trace or /v1/activity — paginated audit rows for a workspace. */
export async function auditPage(ctx: ServerContext, request: Request, kind: "trace" | "activity"): Promise<Response> {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId || !ctx.authorize(request, workspaceId)) {
    return ctx.deny(null, `${kind}.scope`, 403, { resource: workspaceId ?? null })
  }
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, `${kind}.principal`, 401)
  const after = Number(url.searchParams.get("after") ?? "0")
  const requestedLimit = Number(url.searchParams.get("limit") ?? "50")
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
  const page = ctx.audit.page?.(Number.isSafeInteger(after) && after > 0 ? after : 0, limit)
  if (!page) return ctx.deny(principal, `${kind}.unavailable`, 503, { resource: workspaceId })
  ctx.allow(principal, `${kind}.read`, { resource: workspaceId })
  return json(200, { kind, ...page })
}
