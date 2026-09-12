/* SPDX-License-Identifier: MIT */
/**
 * File and design-system routes: read/write/create/remove/rename on the
 * workspace filesystem, plus list/search and the design-system manifest
 * reader. The capability is reused (`workspace.read`/`workspace.write`)
 * rather than added to the P3 catalogue — the P3 list is closed and
 * "workspace.delete" was deliberately not created.
 */
import type { FileReadResult, P3Capability } from "@unifia/contracts"
import { WORKSPACE_MANIFEST_PATH } from "@unifia/contracts"
import type { Principal } from "../auth.js"
import { body, encodeReadResult, decodeWriteInput, isMissingFile, json, parseManifestResult } from "../http.js"
import type { ServerContext } from "../server-context.js"

type FileOp = "read" | "write" | "create" | "remove" | "rename"

/** POST /v1/files/:op — multi-file read/write/create/remove/rename. */
export async function files(
  ctx: ServerContext,
  request: Request,
  operation: FileOp,
  principal: Principal,
): Promise<Response> {
  const input = await body(request)
  if (
    typeof input.workspaceId !== "string" ||
    (!Array.isArray(input.paths) && operation === "read")
  ) {
    return ctx.deny(principal, `workspace.${operation}`, 400, { reason: "missing-workspace-id-or-paths" })
  }
  const workspaceId = input.workspaceId
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, `workspace.${operation}.scope`, 403, { resource: workspaceId })
  // create/remove/rename mutate the workspace filesystem exactly like
  // write does — reusing "workspace.write" here keeps the P3 capability
  // catalogue closed rather than adding a "workspace.delete" the
  // capability broker, approval UI, and picker would all need to learn
  // about for a distinction nothing downstream has asked for.
  const capability = (operation === "read" ? "workspace.read" : "workspace.write") as P3Capability
  const capabilityResponse = await ctx.checkCapability(capability, workspaceId, principal)
  if (capabilityResponse) return capabilityResponse
  if (operation === "read") {
    const results = await ctx.workspace.read(ctx.runtimeToken(token), input.paths as string[])
    ctx.allow(principal, "workspace.read", { resource: workspaceId, authorizingCapability: "workspace.read" })
    return json(200, { results: results.map(encodeReadResult) })
  }
  if (operation === "write") {
    if (!Array.isArray(input.writes)) {
      return ctx.deny(principal, "workspace.write", 400, { resource: workspaceId, reason: "missing-writes" })
    }
    const writes = (input.writes as Record<string, unknown>[]).map(decodeWriteInput)
    const results = await ctx.workspace.write(ctx.runtimeToken(token), writes)
    ctx.allow(principal, "workspace.write", { resource: workspaceId, authorizingCapability: "workspace.write" })
    return json(200, { results: results as unknown as Record<string, unknown>[] })
  }
  if (operation === "create") {
    if (!Array.isArray(input.writes)) {
      return ctx.deny(principal, "workspace.write", 400, { resource: workspaceId, reason: "missing-writes" })
    }
    const creates = (input.writes as Record<string, unknown>[]).map(decodeWriteInput)
    const results = await ctx.workspace.create(ctx.runtimeToken(token), creates)
    ctx.allow(principal, "workspace.write", { resource: workspaceId, authorizingCapability: "workspace.write" })
    return json(200, { results: results as unknown as Record<string, unknown>[] })
  }
  if (operation === "remove") {
    if (!Array.isArray(input.paths)) {
      return ctx.deny(principal, "workspace.write", 400, { resource: workspaceId, reason: "missing-paths" })
    }
    const results = await ctx.workspace.remove(ctx.runtimeToken(token), input.paths as string[])
    ctx.allow(principal, "workspace.write", { resource: workspaceId, authorizingCapability: "workspace.write" })
    return json(200, { results: results as unknown as Record<string, unknown>[] })
  }
  if (typeof input.from !== "string" || typeof input.to !== "string") {
    return ctx.deny(principal, "workspace.write", 400, {
      resource: workspaceId,
      reason: "missing-from-or-to",
    })
  }
  const result = await ctx.workspace.rename(ctx.runtimeToken(token), input.from, input.to)
  ctx.allow(principal, "workspace.write", { resource: workspaceId, authorizingCapability: "workspace.write" })
  return json(200, { result: result as unknown as Record<string, unknown> })
}

/** GET /v1/files/:op — `list` (paginated) or `search`. */
export async function fileIndex(
  ctx: ServerContext,
  request: Request,
  operation: "list" | "search",
  principal: Principal,
): Promise<Response> {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return ctx.deny(principal, `workspace.${operation}`, 400, { reason: "missing-workspace-id" })
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, `workspace.${operation}.scope`, 403, { resource: workspaceId })
  const capabilityResponse = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (capabilityResponse) return capabilityResponse
  const prefix = url.searchParams.get("prefix") ?? "."
  if (operation === "search") {
    const entries = await ctx.workspace.search(
      ctx.runtimeToken(token),
      url.searchParams.get("query") ?? "",
      prefix,
    )
    ctx.allow(principal, "workspace.read", { resource: workspaceId, authorizingCapability: "workspace.read" })
    return json(200, { entries })
  }
  // FUNC-004/C5-1: list is paginated — cursor is opaque and round-tripped
  // via the query string exactly as WorkspacePort.list() returned it.
  const cursor = url.searchParams.get("cursor") ?? undefined
  const page = await ctx.workspace.list(ctx.runtimeToken(token), prefix, cursor)
  ctx.allow(principal, "workspace.read", { resource: workspaceId, authorizingCapability: "workspace.read" })
  return json(200, { entries: page.entries, nextCursor: page.nextCursor, skipped: page.skipped })
}

/** GET /v1/design-systems — read the workspace manifest. */
export async function designSystems(ctx: ServerContext, request: Request, principal: Principal): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (!workspaceId) return ctx.deny(principal, "design-system.manifest", 400, { reason: "missing-workspace-id" })
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "design-system.manifest.scope", 403, { resource: workspaceId })
  const capabilityResponse = await ctx.checkCapability("workspace.read", workspaceId, principal)
  if (capabilityResponse) return capabilityResponse
  let result: FileReadResult | undefined
  try {
    result = (await ctx.workspace.read(ctx.runtimeToken(token), [WORKSPACE_MANIFEST_PATH]))[0]
  } catch (error) {
    if (isMissingFile(error)) {
      return ctx.deny(principal, "design-system.manifest.missing", 404, { resource: workspaceId })
    }
    throw error
  }
  if (!result) return ctx.deny(principal, "design-system.manifest.missing", 404, { resource: workspaceId })
  try {
    const manifest = parseManifestResult(result.content)
    ctx.allow(principal, "workspace.read", { resource: workspaceId, authorizingCapability: "workspace.read" })
    return json(200, manifest as unknown as Record<string, unknown>)
  } catch {
    return ctx.deny(principal, "design-system.manifest.invalid", 400, { resource: workspaceId })
  }
}
