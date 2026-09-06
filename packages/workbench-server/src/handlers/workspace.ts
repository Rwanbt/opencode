/* SPDX-License-Identifier: MIT */
/**
 * Workspace CRUD — register, open, list/create sessions, close a file
 * session. The pre-handshake routes use the principal's `workspace.register`
 * and `workspace.open` scopes; the per-workspace routes authorize via a
 * file-session token in `x-unifia-file-session` (or legacy
 * `Authorization: Bearer`).
 */
import type { Principal } from "../auth.js"
import { principalCanOpen, principalCanRegister } from "../auth.js"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** POST /v1/workspaces/register */
export async function register(ctx: ServerContext, request: Request, principal: Principal): Promise<Response> {
  if (!principalCanRegister(principal)) {
    return ctx.deny(principal, "workspace.register.scope", 403, { reason: "principal-cannot-register" })
  }
  const input = await body(request)
  if (typeof input.name !== "string" || typeof input.path !== "string") {
    return ctx.deny(principal, "workspace.register", 400, { reason: "missing-name-or-path" })
  }
  const workspace = await ctx.workspace.register({ name: input.name, path: input.path })
  ctx.allow(principal, "workspace.register", { resource: workspace.id })
  return json(201, workspace as unknown as Record<string, unknown>)
}

/** POST /v1/workspaces/:id/open */
export async function open(ctx: ServerContext, workspaceId: string, principal: Principal): Promise<Response> {
  if (!principalCanOpen(principal, workspaceId)) {
    return ctx.deny(principal, "workspace.open.scope", 403, {
      resource: workspaceId,
      reason: "principal-cannot-open",
    })
  }
  const handle = await ctx.workspace.open(workspaceId)
  ctx.tokens.set(handle.token, handle)
  ctx.allow(principal, "workspace.open", { resource: workspaceId })
  return json(200, handle as unknown as Record<string, unknown>)
}

/** GET or POST /v1/workspaces/:id/sessions */
export async function sessions(
  ctx: ServerContext,
  request: Request,
  workspaceId: string,
  principal: Principal,
): Promise<Response> {
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "session.scope", 403, { resource: workspaceId })
  if (request.method === "GET") {
    const sessions = await ctx.runtime.listSessions({ workspaceId })
    for (const session of sessions) ctx.sessionOwners.set(session.id, workspaceId)
    ctx.allow(principal, "session.list", { resource: workspaceId })
    return json(200, { sessions })
  }
  if (request.method === "POST") {
    const session = await ctx.runtime.createSession({ workspaceId })
    ctx.sessionOwners.set(session.id, workspaceId)
    ctx.allow(principal, "session.create", { resource: workspaceId })
    return json(201, { session })
  }
  return ctx.deny(principal, "session.method", 405, { resource: workspaceId })
}

/** DELETE /v1/file-sessions/:token — closes one file session. */
export async function closeFileSession(ctx: ServerContext, request: Request, token: string): Promise<Response> {
  const supplied = ctx.bearer(request)
  if (!supplied || supplied !== token || !ctx.tokens.has(token)) {
    return ctx.deny(null, "workspace.close.scope", 403, { reason: "missing-or-mismatched-file-session-token" })
  }
  const workspaceId = ctx.tokens.get(token)?.id
  await ctx.workspace.close(ctx.runtimeToken(token))
  ctx.runtimeTokens.delete(token)
  ctx.tokens.delete(token)
  // DA-AUD-01: file-session close is a system event (the file-session
  // token is a capability handle, not a principal — see bearer doc). The
  // actor is "system:workbench-server:workspace.close", the resource
  // is the workspace id carried by the runtime handle.
  ctx.systemAudit("workspace.close", "allow", { resource: workspaceId })
  return json(200, { closed: true })
}
