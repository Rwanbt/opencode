/* SPDX-License-Identifier: MIT */
/**
 * Artifact CRUD: read, write, history, export, and the raw-bytes route
 * that backs the sandboxed iframe (P10/P11).
 *
 * The `present` flow (signed share-link mint/consume) is in
 * `./artifacts-present.ts` because it is independent of principal
 * authentication on the consume side.
 */
import { basename } from "node:path"
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import { ARTIFACT_RAW_CSP, ARTIFACT_RAW_CONTENT_TYPES } from "../constants.js"
import type { ServerContext } from "../server-context.js"

/** GET /v1/artifacts — list or read one. */
export async function artifactRead(
  ctx: ServerContext,
  request: Request,
  artifactId: string | undefined,
  principal: Principal,
): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId || !ctx.authorize(request, workspaceId)) {
    return ctx.deny(principal, "artifact.read.scope", 403, { resource: workspaceId ?? null })
  }
  const artifacts = ctx.artifactsFor(workspaceId)
  if (!artifacts) return ctx.deny(principal, "artifact.read.unavailable", 503, { resource: workspaceId })
  const gate = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (gate) return gate
  if (!artifactId) {
    ctx.allow(principal, "artifact.list", { resource: workspaceId, authorizingCapability: "workspace.read" })
    return json(200, { artifacts: await artifacts.list() })
  }
  const artifact = await artifacts.latest(artifactId)
  if (!artifact) return ctx.deny(principal, "artifact.not-found", 404, { resource: artifactId })
  const content = await artifacts.read(artifact)
  ctx.allow(principal, "artifact.read", { resource: workspaceId, authorizingCapability: "workspace.read" })
  return json(200, { artifact, content: Buffer.from(content).toString("base64"), encoding: "base64" })
}

/**
 * P10 raw artifact read. Returns the raw bytes of a single artifact's
 * file (with Content-Type derived from the requested path's extension)
 * so the sandboxed iframe in P11 can mount agent-authored HTML
 * without the host ever reading the bytes through `contentDocument`.
 *
 * Security, in order of checks:
 *  1. path shape: no `..`, no leading `/` or `\`, no Windows drive
 *     letter, no NUL — anything that would let the caller escape
 *     the artifact directory.
 *  2. workspace authorization and broker capability `artifact.preview`.
 *  3. artifact existence: a missing artifact yields the same 403
 *     as a path mismatch, so a caller cannot probe for artifact IDs
 *     they do not already have a token for.
 *  4. path within the artifact: the request path must match the
 *     artifact's filename (single-file model). Bundles are a
 *     future concern; the same `403 on mismatch` rule still
 *     applies.
 *  5. CSP for HTML responses (defense in depth — also catches the
 *     "save to disk, open in a regular browser" attack path).
 */
export async function artifactRaw(
  ctx: ServerContext,
  request: Request,
  artifactId: string | undefined,
  rawPath: string | undefined,
  principal: Principal,
): Promise<Response> {
  if (!artifactId) return ctx.deny(principal, "artifact.raw.id", 400, { reason: "missing-artifact-id" })
  if (!rawPath) return ctx.deny(principal, "artifact.raw.path", 400, { reason: "missing-raw-path" })
  if (
    rawPath.includes("..") ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("\\") ||
    /^[A-Za-z]:/.test(rawPath) ||
    rawPath.includes("\0")
  ) {
    return ctx.deny(principal, "artifact.raw.path-escape", 403, { resource: rawPath })
  }
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId || !ctx.authorize(request, workspaceId)) {
    return ctx.deny(principal, "artifact.raw.scope", 403, { resource: workspaceId ?? null })
  }
  const artifacts = ctx.artifactsFor(workspaceId)
  if (!artifacts) return ctx.deny(principal, "artifact.raw.unavailable", 503, { resource: workspaceId })
  const gate = await ctx.checkCapability("artifact.preview", workspaceId, principal)
  if (gate) return gate
  const artifact = await artifacts.latest(artifactId)
  if (!artifact) return ctx.deny(principal, "artifact.raw.path", 403, { resource: artifactId })
  const artifactFileName = basename(artifact.relativePath)
  if (rawPath !== artifactFileName && rawPath !== artifact.relativePath) {
    return ctx.deny(principal, "artifact.raw.path", 403, { resource: artifactId })
  }
  const content = await artifacts.read(artifact)
  const lower = rawPath.toLowerCase()
  const lastDot = lower.lastIndexOf(".")
  const ext = lastDot >= 0 ? lower.slice(lastDot + 1) : ""
  const knownType = Object.hasOwn(ARTIFACT_RAW_CONTENT_TYPES, ext) ? ARTIFACT_RAW_CONTENT_TYPES[ext]! : null
  const contentType = knownType ?? "application/octet-stream"
  const disposition = knownType ? "inline" : "attachment"
  const headers: Record<string, string> = {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "content-disposition": `${disposition}; filename="${rawPath.replace(/"/g, "")}"`,
  }
  if (ext === "html" || ext === "htm") {
    headers["content-security-policy"] = ARTIFACT_RAW_CSP
  }
  ctx.allow(principal, "artifact.preview", {
    resource: workspaceId,
    authorizingCapability: "artifact.preview",
  })
  return new Response(new Blob([new Uint8Array(content)]), { status: 200, headers })
}

/** GET /v1/artifacts/:id/history */
export async function artifactHistory(
  ctx: ServerContext,
  request: Request,
  artifactId: string | undefined,
  principal: Principal,
): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId || !ctx.authorize(request, workspaceId)) {
    return ctx.deny(principal, "artifact.history.scope", 403, { resource: workspaceId ?? null })
  }
  const artifacts = ctx.artifactsFor(workspaceId)
  if (!artifacts) return ctx.deny(principal, "artifact.history.unavailable", 503, { resource: workspaceId })
  const gate = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (gate) return gate
  if (!artifactId) return ctx.deny(principal, "artifact.history.id", 400, { reason: "missing-artifact-id" })
  ctx.allow(principal, "artifact.history", { resource: workspaceId, authorizingCapability: "workspace.read" })
  return json(200, { history: await artifacts.history(artifactId) })
}

/** POST /v1/artifacts — create a new artifact. */
export async function artifactWrite(ctx: ServerContext, request: Request, principal: Principal): Promise<Response> {
  const input = await body(request)
  if (
    typeof input.workspaceId !== "string" ||
    typeof input.kind !== "string" ||
    typeof input.filename !== "string" ||
    typeof input.content !== "string"
  ) {
    return ctx.deny(principal, "artifact.create", 400, {
      reason: "missing-workspace-kind-filename-or-content",
    })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "artifact.create.scope", 403, { resource: input.workspaceId })
  const artifacts = ctx.artifactsFor(input.workspaceId)
  if (!artifacts) return ctx.deny(principal, "artifact.create.unavailable", 503, { resource: input.workspaceId })
  const gate = await ctx.checkCapability("artifact.create", input.workspaceId, principal)
  if (gate) return gate
  const artifact = await artifacts.create({
    kind: input.kind as Parameters<typeof artifacts.create>[0]["kind"],
    filename: input.filename,
    content: input.content,
    artifactId: typeof input.artifactId === "string" ? input.artifactId : undefined,
    metadata: input.metadata as Record<string, string> | undefined,
    provenance: input.provenance as Parameters<typeof artifacts.create>[0]["provenance"],
  })
  ctx.allow(principal, "artifact.create", {
    resource: input.workspaceId,
    authorizingCapability: "artifact.create",
  })
  return json(201, { artifact })
}

/** POST /v1/artifacts/export — write an artifact to the outbox. */
export async function artifactExport(ctx: ServerContext, request: Request, principal: Principal): Promise<Response> {
  const input = await body(request)
  if (typeof input.workspaceId !== "string" || typeof input.artifactId !== "string") {
    return ctx.deny(principal, "artifact.export", 400, { reason: "missing-workspace-id-or-artifact-id" })
  }
  const token = ctx.authorize(request, input.workspaceId)
  if (!token) return ctx.deny(principal, "artifact.export.scope", 403, { resource: input.workspaceId })
  const artifacts = ctx.artifactsFor(input.workspaceId)
  if (!artifacts) return ctx.deny(principal, "artifact.export.unavailable", 503, { resource: input.workspaceId })
  const gate = await ctx.checkCapability("artifact.export", input.workspaceId, principal)
  if (gate) return gate
  const artifact = await artifacts.latest(input.artifactId)
  if (!artifact) return ctx.deny(principal, "artifact.export.not-found", 404, { resource: input.artifactId })
  const exported = await artifacts.export(artifact, {
    outbox: typeof input.outbox === "string" ? input.outbox : undefined,
    metadata: input.metadata === "keep" ? "keep" : "strip",
  })
  ctx.allow(principal, "artifact.export", {
    resource: input.workspaceId,
    authorizingCapability: "artifact.export",
  })
  return json(200, { exported })
}
