/* SPDX-License-Identifier: MIT */
/**
 * P29 — Marketplace plugin routes. The runtime keeps a small in-memory
 * catalogue of installed plugins per workspace. The install is
 * capability-gated on `package.install`; the apply is gated on
 * `plugin.apply` (DA-CAP-01, now part of the P3Capability closed union —
 * ADR-1038 §9.2 of the 4.0 plan).
 */
import type { Principal } from "../auth.js"
import { json } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** GET /v1/plugins?workspaceId=… */
export async function pluginsList(ctx: ServerContext, request: Request, principal: Principal): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) return ctx.deny(principal, "plugin.scope", 400, { reason: "missing-workspace-id" })
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "plugin.scope", 403, { resource: workspaceId })
  const decision = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (decision) return decision
  const plugins = ctx.pluginsByWorkspace.get(workspaceId) ?? []
  ctx.allow(principal, "workspace.read", { resource: workspaceId, authorizingCapability: "workspace.read" })
  return json(200, { plugins })
}

/** GET /v1/plugins/:id?workspaceId=… */
export async function pluginRead(
  ctx: ServerContext,
  request: Request,
  pluginId: string,
  principal: Principal,
): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) return ctx.deny(principal, "plugin.scope", 400, { reason: "missing-workspace-id" })
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "plugin.scope", 403, { resource: workspaceId })
  const decision = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (decision) return decision
  const plugins = ctx.pluginsByWorkspace.get(workspaceId) ?? []
  const plugin = plugins.find((p) => p.id === pluginId)
  if (!plugin) return ctx.deny(principal, "plugin.not-found", 404, { resource: pluginId })
  ctx.allow(principal, "workspace.read", { resource: workspaceId, authorizingCapability: "workspace.read" })
  return json(200, plugin as unknown as Record<string, unknown>)
}

/** POST /v1/plugins/:id/install */
export async function pluginInstall(
  ctx: ServerContext,
  request: Request,
  pluginId: string,
  principal: Principal,
): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) return ctx.deny(principal, "plugin.scope", 400, { reason: "missing-workspace-id" })
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "plugin.scope", 403, { resource: workspaceId })
  const decision = await ctx.checkCapability("package.install", workspaceId, principal)
  if (decision) return decision
  const body = (await request.json().catch(() => ({}))) as {
    name?: string
    version?: string
    capabilities?: readonly string[]
  }
  if (
    typeof body.name !== "string" ||
    typeof body.version !== "string" ||
    !Array.isArray(body.capabilities)
  ) {
    return ctx.deny(principal, "plugin.invalid", 400, {
      resource: pluginId,
      reason: "missing-name-version-or-capabilities",
    })
  }
  const existing = ctx.pluginsByWorkspace.get(workspaceId) ?? []
  const without = existing.filter((p) => p.id !== pluginId)
  ctx.pluginsByWorkspace.set(workspaceId, [
    ...without,
    { id: pluginId, name: body.name, version: body.version, capabilities: body.capabilities },
  ])
  ctx.allow(principal, "package.install", { resource: pluginId, authorizingCapability: "package.install" })
  return json(200, { ok: true, id: pluginId })
}

/** POST /v1/plugins/:id/apply */
export async function pluginApply(
  ctx: ServerContext,
  request: Request,
  pluginId: string,
  principal: Principal,
): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) return ctx.deny(principal, "plugin.scope", 400, { reason: "missing-workspace-id" })
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "plugin.scope", 403, { resource: workspaceId })
  // DA-CAP-01: "plugin.apply" is now part of the P3Capability closed union
  // (ADR-1038, §9.2 of the 4.0 plan). The runtime no longer needs to inject
  // a cast at this one site — every call into #checkCapability is typed.
  const applyCapability = "plugin.apply"
  const decision = await ctx.checkCapability(applyCapability, workspaceId, principal)
  if (decision) return decision
  const plugins = ctx.pluginsByWorkspace.get(workspaceId) ?? []
  const plugin = plugins.find((p) => p.id === pluginId)
  if (!plugin) return ctx.deny(principal, "plugin.not-found", 404, { resource: pluginId })
  ctx.allow(principal, "plugin.apply", { resource: pluginId, authorizingCapability: "plugin.apply" })
  return json(200, { ok: true, applied: pluginId })
}

/** DELETE /v1/plugins/:id */
export async function pluginDelete(
  ctx: ServerContext,
  request: Request,
  pluginId: string,
  principal: Principal,
): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) return ctx.deny(principal, "plugin.scope", 400, { reason: "missing-workspace-id" })
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "plugin.scope", 403, { resource: workspaceId })
  const decision = await ctx.checkCapability("package.install", workspaceId, principal)
  if (decision) return decision
  const existing = ctx.pluginsByWorkspace.get(workspaceId) ?? []
  ctx.pluginsByWorkspace.set(
    workspaceId,
    existing.filter((p) => p.id !== pluginId),
  )
  ctx.allow(principal, "package.install", { resource: pluginId, authorizingCapability: "package.install" })
  return json(200, { ok: true })
}
