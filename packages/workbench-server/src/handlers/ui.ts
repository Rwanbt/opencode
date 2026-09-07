/* SPDX-License-Identifier: MIT */
/**
 * UI control plane: execute an MCP-UI action, or render a UI node into
 * HTML through the contracts' generative-ui renderer.
 *
 * WHY the `desktop.control` gate for execute: the action is an arbitrary
 * UI mutation, which the broker model treats as the most powerful
 * capability a session can hold. The render route is `workspace.read` —
 * it only formats data, never mutates state.
 */
import type { UiNode } from "@unifia/contracts"
import { renderGenerativeUi, type UiAction } from "@unifia/contracts"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** POST /v1/ui/actions */
export async function uiAction(ctx: ServerContext, request: Request, principal: import("../auth.js").Principal | null): Promise<Response> {
  if (!ctx.ui) return ctx.deny(principal, "ui.unavailable", 503)
  const input = await body(request)
  if (typeof input.workspaceId !== "string" || !input.action || typeof input.action !== "object") {
    return ctx.deny(principal, "ui.scope", 400, { reason: "missing-workspace-id-or-action" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "ui.scope", 403, { resource: input.workspaceId })
  const gate = await ctx.checkCapability("desktop.control", input.workspaceId, principal as import("../auth.js").Principal)
  if (gate) return gate
  const result = await ctx.ui.execute(input.action as UiAction)
  ctx.allow(principal, "ui.action", {
    resource: input.workspaceId,
    authorizingCapability: "desktop.control",
  })
  return json(
    result.status === "denied" ? 403 : result.status === "pending-approval" ? 202 : 200,
    { result },
  )
}

/** POST /v1/ui/render */
export async function renderUi(ctx: ServerContext, request: Request): Promise<Response> {
  if (!ctx.uiAllowedActions) return ctx.deny(null, "ui.render.unavailable", 503)
  const principal = await ctx.authenticate(request)
  const input = await body(request)
  if (
    typeof input.workspaceId !== "string" ||
    !input.node ||
    typeof input.node !== "object" ||
    Array.isArray(input.node)
  ) {
    return ctx.deny(principal ?? null, "ui.render", 400, { reason: "missing-workspace-id-or-node" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal ?? null, "ui.render.scope", 403, { resource: input.workspaceId })
  try {
    const rendered = renderGenerativeUi(input.node as UiNode, ctx.uiAllowedActions)
    ctx.allow(principal ?? null, "ui.render", { resource: input.workspaceId })
    return json(200, { rendered })
  } catch {
    return ctx.deny(principal ?? null, "ui.render", 400, { resource: input.workspaceId })
  }
}
