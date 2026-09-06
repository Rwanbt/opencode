/* SPDX-License-Identifier: MIT */
/**
 * Capability-registry CRUD: register/approve/enable/revoke/search.
 *
 * All routes are gated on `package.install` — the registry is the
 * surface through which a new capability is admitted, so it must itself
 * be a write-class operation.
 */
import type { CapabilityManifest } from "@unifia/contracts"
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** GET/POST /v1/capabilities/:action */
export async function capabilityAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  principal: Principal,
): Promise<Response> {
  if (!ctx.capabilities) return ctx.deny(principal, "capability.unavailable", 503)
  const input =
    request.method === "GET"
      ? Object.fromEntries(new URL(request.url).searchParams.entries())
      : await body(request)
  if (typeof input.workspaceId !== "string") {
    return ctx.deny(principal, "capability.scope", 400, { reason: "missing-workspace-id" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "capability.scope", 403, { resource: input.workspaceId })
  const gate = await ctx.checkCapability("package.install", input.workspaceId, principal)
  if (gate) return gate
  if (action === "register" && input.manifest && typeof input.manifest === "object") {
    ctx.capabilities.register(input.manifest as CapabilityManifest)
    ctx.allow(principal, "capability.register", {
      resource: input.workspaceId,
      authorizingCapability: "package.install",
    })
    return json(201, { registered: true })
  }
  if (action === "approve" && typeof input.digest === "string") {
    ctx.capabilities.approve(input.digest)
    ctx.allow(principal, "capability.approve", {
      resource: input.digest,
      authorizingCapability: "package.install",
    })
    return json(200, { approved: true })
  }
  if (action === "enable" && typeof input.digest === "string") {
    ctx.capabilities.enable(input.digest)
    ctx.allow(principal, "capability.enable", {
      resource: input.digest,
      authorizingCapability: "package.install",
    })
    return json(200, { enabled: true })
  }
  if (action === "revoke" && typeof input.digest === "string") {
    ctx.capabilities.revoke(input.digest)
    ctx.allow(principal, "capability.revoke", {
      resource: input.digest,
      authorizingCapability: "package.install",
    })
    return json(200, { revoked: true })
  }
  if (action === "search") {
    const records = ctx.capabilities.search({
      tag: typeof input.tag === "string" ? input.tag : undefined,
      trustLevel:
        typeof input.trustLevel === "string"
          ? (input.trustLevel as "untrusted" | "verified" | "official")
          : undefined,
      enabledOnly: input.enabledOnly === "true",
    })
    ctx.allow(principal, "capability.search", {
      resource: input.workspaceId,
      authorizingCapability: "package.install",
    })
    return json(200, { records })
  }
  return ctx.deny(principal, "capability.action", 400, { resource: input.workspaceId })
}
