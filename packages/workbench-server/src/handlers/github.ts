/* SPDX-License-Identifier: MIT */
/**
 * GitHub device-flow surface. `status` is a read; every other action
 * mutates stored credentials for the account, so it carries the same
 * capability as any other workspace write.
 *
 * WHY the GET/body branch: `status()` sends the workspace in the query
 * string, so reading `input.workspaceId` from a JSON body used to refuse
 * every status call.
 */
import type { P3Capability } from "@unifia/contracts"
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"

export async function githubAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  principal: Principal,
): Promise<Response> {
  if (!ctx.github) return ctx.deny(principal, "github.unavailable", 503)
  const workspaceId =
    request.method === "GET"
      ? new URL(request.url).searchParams.get("workspaceId")
      : (await body(request)).workspaceId
  if (
    typeof workspaceId !== "string" ||
    !ctx.authorize(request, workspaceId)
  ) {
    return ctx.deny(principal, "github.scope", 403, { reason: "missing-workspace-id-or-no-token" })
  }
  if (
    action !== "status" &&
    action !== "start" &&
    action !== "poll" &&
    action !== "cancel" &&
    action !== "disconnect"
  ) {
    return ctx.deny(principal, "github.action", 400, { resource: workspaceId })
  }
  const capability: P3Capability = action === "status" ? "workspace.read" : "workspace.write"
  const gate = await ctx.checkCapability(capability, workspaceId, principal)
  if (gate) return gate
  if (action === "status") return json(200, await ctx.github.status(workspaceId))
  if (action === "start") return json(200, await ctx.github.deviceStart(workspaceId))
  if (action === "poll") return json(200, await ctx.github.devicePoll(workspaceId))
  if (action === "cancel") return json(200, await ctx.github.deviceCancel(workspaceId))
  return json(200, await ctx.github.disconnect(workspaceId))
}
