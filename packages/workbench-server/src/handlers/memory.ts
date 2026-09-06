/* SPDX-License-Identifier: MIT */
/**
 * Memory runtime: remember / search / remove. Capability-gated on
 * `workspace.read`/`workspace.write` — there is no dedicated
 * "memory.*" capability, the broker model treats memory as part of the
 * workspace.
 */
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** GET/POST/DELETE /v1/memory/:action */
export async function memoryAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  principal: Principal,
): Promise<Response> {
  if (!ctx.memory) return ctx.deny(principal, "memory.unavailable", 503)
  const input =
    request.method === "GET"
      ? Object.fromEntries(new URL(request.url).searchParams.entries())
      : await body(request)
  if (typeof input.workspaceId !== "string") {
    return ctx.deny(principal, "memory.scope", 400, { reason: "missing-workspace-id" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "memory.scope", 403, { resource: input.workspaceId })
  if (request.method === "POST" && action === "remember") {
    const gate = await ctx.checkCapability("workspace.write", input.workspaceId, principal)
    if (gate) return gate
    if (
      typeof input.content !== "string" ||
      (input.source !== "user" && input.source !== "agent" && input.source !== "import")
    ) {
      return ctx.deny(principal, "memory.remember", 400, {
        resource: input.workspaceId,
        reason: "missing-content-or-invalid-source",
      })
    }
    const record = await ctx.memory.remember({
      workspaceId: input.workspaceId,
      content: input.content,
      source: input.source,
      tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
      id: typeof input.id === "string" ? input.id : undefined,
    })
    ctx.allow(principal, "memory.remember", {
      resource: input.workspaceId,
      authorizingCapability: "workspace.write",
    })
    return json(201, { record })
  }
  if (request.method === "GET" && action === "search") {
    const gate = await ctx.checkCapability("workspace.read", input.workspaceId, principal)
    if (gate) return gate
    const records = await ctx.memory.search({
      workspaceId: input.workspaceId,
      text: typeof input.text === "string" ? input.text : undefined,
    })
    ctx.allow(principal, "memory.search", {
      resource: input.workspaceId,
      authorizingCapability: "workspace.read",
    })
    return json(200, { records })
  }
  if (request.method === "DELETE" && action === "remove" && typeof input.id === "string") {
    const gate = await ctx.checkCapability("workspace.write", input.workspaceId, principal)
    if (gate) return gate
    const removed = await ctx.memory.remove(input.workspaceId, input.id)
    ctx.allow(principal, "memory.remove", {
      resource: input.workspaceId,
      authorizingCapability: "workspace.write",
    })
    return json(200, { removed })
  }
  return ctx.deny(principal, "memory.action", 400, { resource: input.workspaceId })
}
