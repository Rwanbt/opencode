/* SPDX-License-Identifier: MIT */
/**
 * Skill-hub search/install/update and the per-workspace design-skills
 * listing. The skill-hub registry is in-memory and process-local; the
 * routes are pre-auth (they don't go through the principal gate) and
 * authenticate the caller for audit purposes only.
 */
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** GET/POST /v1/skill-hub/:action — search/install/update. */
export async function skillHubAction(ctx: ServerContext, request: Request, action: string): Promise<Response> {
  if (!ctx.skillHub) return ctx.deny(null, "skill-hub.unavailable", 503)
  const principal = await ctx.authenticate(request)
  const input =
    request.method === "GET"
      ? Object.fromEntries(new URL(request.url).searchParams.entries())
      : await body(request)
  if (typeof input.workspaceId !== "string") {
    return ctx.deny(principal ?? null, "skill-hub.scope", 400, { reason: "missing-workspace-id" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal ?? null, "skill-hub.scope", 403, { resource: input.workspaceId })
  if (action === "search") {
    const query = typeof input.query === "string" ? input.query : undefined
    const tags =
      typeof input.tags === "string" && input.tags.length > 0
        ? input.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0)
        : Array.isArray(input.tags)
          ? input.tags.filter((tag): tag is string => typeof tag === "string")
          : undefined
    const trust =
      input.trust === "untrusted" || input.trust === "verified" || input.trust === "official" ? input.trust : undefined
    const manifests = await ctx.skillHub.search({ query, tags, trust })
    ctx.allow(principal ?? null, "skill-hub.search", { resource: input.workspaceId })
    return json(200, { manifests })
  }
  if (action === "install") {
    if (typeof input.digest !== "string") {
      return ctx.deny(principal ?? null, "skill-hub.install", 400, { reason: "missing-digest" })
    }
    const installed = await ctx.skillHub.install(input.digest)
    ctx.allow(principal ?? null, "skill-hub.install", { resource: input.digest })
    return json(201, { installed })
  }
  if (action === "update") {
    if (typeof input.name !== "string") {
      return ctx.deny(principal ?? null, "skill-hub.update", 400, { reason: "missing-name" })
    }
    const updated = await ctx.skillHub.update(input.name)
    ctx.allow(principal ?? null, "skill-hub.update", { resource: input.name })
    return json(200, { updated: updated ?? null })
  }
  return ctx.deny(principal ?? null, "skill-hub.action", 400, { resource: input.workspaceId })
}

/** GET /v1/design-skills — list design skill manifests for a workspace. */
export async function designSkillsAction(
  ctx: ServerContext,
  request: Request,
  principal: Principal,
): Promise<Response> {
  if (!ctx.designSkills) return ctx.deny(principal, "design-skills.unavailable", 503)
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) {
    return ctx.deny(principal, "design-skills.scope", 400, { reason: "missing-workspace-id" })
  }
  if (!ctx.authorize(request, workspaceId)) {
    return ctx.deny(principal, "design-skills.scope", 403, { resource: workspaceId })
  }
  const gate = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (gate) return gate
  const skills = await ctx.designSkills(workspaceId)
  ctx.allow(principal, "design-skills.list", {
    resource: workspaceId,
    authorizingCapability: "workspace.read",
  })
  return json(200, { skills })
}
