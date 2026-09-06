/* SPDX-License-Identifier: MIT */
/**
 * Document listing and the spec validator.
 *
 * "Documents" here means every non-binary artifact in the workspace
 * (binary artifacts are listed under /v1/artifacts instead). The spec
 * validator parses a textual or object spec, computes its effective
 * capabilities, and returns both — the Workbench UI uses it to preview
 * what a design-skills manifest will require before the user commits.
 */
import { parseSpec, resolveEffectiveCapabilities } from "@unifia/spec-runtime"
import type { ArtifactVersion } from "@unifia/artifact-runtime"
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"

/** GET /v1/documents — list non-binary artifacts. */
export async function documents(ctx: ServerContext, request: Request, principal: Principal): Promise<Response> {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId || !ctx.authorize(request, workspaceId)) {
    return ctx.deny(principal, "documents.scope", 403, { resource: workspaceId ?? null })
  }
  const artifacts = ctx.artifactsFor(workspaceId)
  if (!artifacts) return ctx.deny(principal, "documents.unavailable", 503, { resource: workspaceId })
  const gate = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (gate) return gate
  const documents = (await artifacts.list()).filter((artifact: ArtifactVersion) => artifact.kind !== "binary")
  ctx.allow(principal, "documents.list", { resource: workspaceId, authorizingCapability: "workspace.read" })
  return json(200, { documents })
}

/** POST /v1/specs/validate — parse and resolve capabilities. */
export async function specValidate(ctx: ServerContext, request: Request, principal: Principal): Promise<Response> {
  const input = await body(request)
  if (
    typeof input.workspaceId !== "string" ||
    (typeof input.spec !== "string" && (!input.spec || typeof input.spec !== "object"))
  ) {
    return ctx.deny(principal, "spec.validate", 400, { reason: "missing-workspace-id-or-spec" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "spec.validate.scope", 403, { resource: input.workspaceId })
  const gate = await ctx.checkCapability("workspace.read", input.workspaceId, principal)
  if (gate) return gate
  const spec = parseSpec(input.spec)
  const resolution = resolveEffectiveCapabilities(spec, [])
  ctx.allow(principal, "spec.validate", { resource: input.workspaceId, authorizingCapability: "workspace.read" })
  return json(200, { valid: true, spec, capabilities: resolution })
}
