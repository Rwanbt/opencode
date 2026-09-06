/* SPDX-License-Identifier: MIT */
/**
 * Phase 9.4 — the present-link mint and consume pair.
 *
 * `artifactPresentLink` is authenticated and capability-gated like
 * `#artifactExport`: the caller must already hold `artifact.export` for
 * the workspace. The minted link itself carries no such requirement —
 * that's the whole point, it's what lets it be opened by someone else.
 *
 * `artifactPresent` is deliberately reachable with NO principal (see
 * `#route`'s early dispatch for this path, before the universal auth
 * gate): the whole point of a present link is that the recipient never
 * authenticated with this server. The signed, single-artifact,
 * short-lived token verified below is the only access control this
 * route has — and is meant to be the only one it needs.
 */
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import { ARTIFACT_RAW_CSP } from "../constants.js"
import type { ServerContext } from "../server-context.js"

/** POST /v1/artifacts/:id/present — mint a signed, short-lived link. */
export async function artifactPresentLink(
  ctx: ServerContext,
  request: Request,
  artifactId: string | undefined,
  principal: Principal,
): Promise<Response> {
  if (!ctx.presentLinks) return ctx.deny(principal, "artifact.present.unconfigured", 503)
  if (!artifactId) return ctx.deny(principal, "artifact.present.id", 400, { reason: "missing-artifact-id" })
  const input = await body(request)
  if (typeof input.workspaceId !== "string") {
    return ctx.deny(principal, "artifact.present", 400, { reason: "missing-workspace-id" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "artifact.present.scope", 403, { resource: input.workspaceId })
  const artifacts = ctx.artifactsFor(input.workspaceId)
  if (!artifacts) return ctx.deny(principal, "artifact.present.unavailable", 503, { resource: input.workspaceId })
  const gate = await ctx.checkCapability("artifact.export", input.workspaceId, principal)
  if (gate) return gate
  const artifact = await artifacts.latest(artifactId)
  if (!artifact) return ctx.deny(principal, "artifact.present.missing", 404, { resource: artifactId })
  const { token: linkToken, expiresAt } = ctx.presentLinks.sign(artifactId, input.workspaceId)
  const origin = new URL(request.url).origin
  ctx.allow(principal, "artifact.export", {
    resource: artifactId,
    authorizingCapability: "artifact.export",
  })
  return json(200, {
    url: `${origin}/v1/artifacts/${encodeURIComponent(artifactId)}/present?token=${encodeURIComponent(linkToken)}`,
    expiresAt,
  })
}

/** GET /v1/artifacts/:id/present?token=… — consume a present link. */
export async function artifactPresent(
  ctx: ServerContext,
  request: Request,
  artifactId: string | undefined,
): Promise<Response> {
  if (!ctx.presentLinks) return ctx.deny(null, "artifact.present.unconfigured", 503)
  if (!artifactId) return ctx.deny(null, "artifact.present.id", 400, { reason: "missing-artifact-id" })
  const suppliedToken = new URL(request.url).searchParams.get("token")
  if (!suppliedToken) return ctx.deny(null, "artifact.present.token", 400, { reason: "missing-present-token" })
  const claims = ctx.presentLinks.verify(suppliedToken)
  if (!claims || claims.artifactId !== artifactId) {
    return ctx.deny(null, "artifact.present.token", 403, { reason: "invalid-or-mismatched-present-token" })
  }
  // The workspace comes from the signed claims, so the link reaches exactly
  // the lineage it was minted against and no other.
  const artifacts = ctx.artifactsFor(claims.workspaceId)
  if (!artifacts) return ctx.deny(null, "artifact.present.unavailable", 503, { resource: claims.workspaceId })
  const artifact = await artifacts.latest(artifactId)
  if (!artifact) return ctx.deny(null, "artifact.present.missing", 404, { resource: artifactId })
  const content = await artifacts.read(artifact)
  // DA-AUD-01: present-link consumption is a system event (no principal);
  // the resource is the workspace the link was minted against.
  ctx.systemAudit("artifact.present", "allow", { resource: claims.workspaceId })
  return new Response(new Blob([new Uint8Array(content)]), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": ARTIFACT_RAW_CSP,
    },
  })
}
