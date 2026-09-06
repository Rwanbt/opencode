/* SPDX-License-Identifier: MIT */
/**
 * Side-effect automation routes: browser, desktop, and workflow. These
 * are the routes the capability gate is most protective about — every
 * step-up-eligible capability is reached through here.
 */
import type { WorkflowDefinitionPort } from "../workflow-port.js"
import type { Principal } from "../auth.js"
import { body, json, workflowAuthority } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** POST /v1/browser/:action */
export async function browserAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  principal: Principal,
): Promise<Response> {
  if (!ctx.browser) return ctx.deny(principal, "browser.unavailable", 503)
  const input = await body(request)
  if (typeof input.workspaceId !== "string") {
    return ctx.deny(principal, "browser.scope", 400, { reason: "missing-workspace-id" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "browser.scope", 403, { resource: input.workspaceId })
  const gate = await ctx.checkCapability("browser.navigate", input.workspaceId, principal)
  if (gate) return gate
  if (action === "navigate" && typeof input.url === "string") {
    await ctx.browser.navigate(input.workspaceId, input.url)
    ctx.allow(principal, "browser.navigate", {
      resource: input.workspaceId,
      authorizingCapability: "browser.navigate",
    })
    return json(202, { accepted: true })
  }
  if (action === "snapshot") {
    const snapshot = await ctx.browser.snapshot(input.workspaceId)
    ctx.allow(principal, "browser.snapshot", {
      resource: input.workspaceId,
      authorizingCapability: "browser.navigate",
    })
    return json(200, { snapshot })
  }
  if (action === "screenshot") {
    const screenshot = await ctx.browser.screenshot(input.workspaceId)
    ctx.allow(principal, "browser.screenshot", {
      resource: input.workspaceId,
      authorizingCapability: "browser.navigate",
    })
    return json(200, { contentType: "image/png", data: Buffer.from(screenshot).toString("base64") })
  }
  return ctx.deny(principal, "browser.action", 400, { resource: input.workspaceId })
}

/** POST /v1/desktop/:action */
export async function desktopAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  principal: Principal,
): Promise<Response> {
  if (!ctx.desktop) return ctx.deny(principal, "desktop.unavailable", 503)
  const input = await body(request)
  if (typeof input.workspaceId !== "string" || typeof input.appId !== "string") {
    return ctx.deny(principal, "desktop.scope", 400, { reason: "missing-workspace-id-or-app-id" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "desktop.scope", 403, { resource: input.workspaceId })
  const target = {
    appId: input.appId,
    windowId: typeof input.windowId === "string" ? input.windowId : undefined,
  }
  if (action === "observe") {
    const gate = await ctx.checkCapability("desktop.observe", input.workspaceId, principal)
    if (gate) return gate
    const observation = await ctx.desktop.observe(target)
    ctx.allow(principal, "desktop.observe", {
      resource: input.workspaceId,
      authorizingCapability: "desktop.observe",
    })
    return json(200, { observation })
  }
  if (action === "control" && (input.action === "keyboard" || input.action === "mouse")) {
    const gate = await ctx.checkCapability("desktop.control", input.workspaceId, principal)
    if (gate) return gate
    await ctx.desktop.control(target, input.action, input.payload)
    ctx.allow(principal, "desktop.control", {
      resource: input.workspaceId,
      authorizingCapability: "desktop.control",
    })
    return json(202, { accepted: true })
  }
  return ctx.deny(principal, "desktop.action", 400, { resource: input.workspaceId })
}

/**
 * POST /v1/workflows/:action — start/resume/cancel a workflow run.
 *
 * Authority is carried explicitly by the caller. The route does not retain
 * workflow ownership or synthesize a token after restart.
 */
export async function workflowAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  principal: Principal,
): Promise<Response> {
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 503)
  const input = await body(request)
  if (action === "start") {
    if (
      typeof input.workspaceId !== "string" ||
      !input.definition ||
      typeof input.definition !== "object"
    ) {
      return ctx.deny(principal, "workflow.start", 400, { reason: "missing-workspace-id-or-definition" })
    }
    const token = ctx.authorize(request, input.workspaceId)
    if (!token) return ctx.deny(principal, "workflow.scope", 403, { resource: input.workspaceId })
    const gate = await ctx.checkCapability("workflow.run", input.workspaceId, principal)
    if (gate) return gate
    const definition = { ...(input.definition as WorkflowDefinitionPort), workspaceId: input.workspaceId }
    const state = await ctx.workflow.start(definition, principal.id)
    // DA-AUD-03: the route label is "workflow.start", the broker's
    // capability is "workflow.run". Record both so a downstream reader
    // can answer "what did the user ask for?" AND "what capability
    // authorised it?" without conflating the two (B07 §4 row :1317).
    ctx.allow(principal, "workflow.start", {
      resource: input.workspaceId,
      authorizingCapability: "workflow.run",
    })
    return json(202, { state })
  }
  if (typeof input.workflowId !== "string") {
    return ctx.deny(principal, "workflow.scope", 400, { reason: "missing-workflow-id" })
  }
  if (typeof input.workspaceId !== "string") {
    return ctx.deny(principal, "workflow.scope", 400, { reason: "missing-workspace-id" })
  }
  const workspaceId = input.workspaceId
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== input.workflowId || !ctx.authorize(request, workspaceId)) {
    return ctx.deny(principal, "workflow.scope", 403, { resource: input.workflowId })
  }
  const state =
    action === "resume"
       ? await ctx.workflow.resume(token)
       : action === "cancel"
         ? await ctx.workflow.cancel(token)
        : undefined
  if (!state) return ctx.deny(principal, "workflow.action", 400, { resource: input.workflowId })
  ctx.allow(principal, `workflow.${action}`, { resource: workspaceId })
  return json(200, { state })
}
