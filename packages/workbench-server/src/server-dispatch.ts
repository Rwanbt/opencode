/* SPDX-License-Identifier: MIT */
/**
 * Route dispatcher — a flat `if`-chain that decodes the path and
 * delegates to the matching handler. The order matters for two cases:
 *  - `v1/artifacts/:id/present` is checked BEFORE the universal
 *    principal gate, because the present link's own signed token IS its
 *    authentication (verified inside the handler).
 *  - All other routes go through the standard auth → rate-limit →
 *    handler chain implemented in `WorkbenchServer.fetch`.
 */
import * as handshake from "./handlers/handshake.js"
import * as workspace from "./handlers/workspace.js"
import * as sessions from "./handlers/sessions.js"
import * as workspaceEventsStream from "./handlers/workspace-events-stream.js"
import * as files from "./handlers/files.js"
import * as plugins from "./handlers/plugins.js"
import * as automation from "./handlers/automation.js"
import * as memory from "./handlers/memory.js"
import * as capabilities from "./handlers/capabilities.js"
import * as ui from "./handlers/ui.js"
import * as skillHub from "./handlers/skill-hub.js"
import * as github from "./handlers/github.js"
import * as approvals from "./handlers/approvals.js"
import * as artifacts from "./handlers/artifacts.js"
import * as artifactsPresent from "./handlers/artifacts-present.js"
import * as documents from "./handlers/documents.js"
import * as workflows from "./handlers/workflows.js"
import type { ServerContext } from "./server-context.js"

/**
 * Dispatch one request. Returns the matching handler's response, or
 * 404 (deny) when no route matches. The pre-auth present-link route is
 * short-circuited above the principal gate and so receives `null` as the
 * `Principal` argument on the `authenticate` call.
 */
export async function dispatch(ctx: ServerContext, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "v1") return ctx.deny(null, "route.unknown", 404)
  // Phase 9.4 — dispatched before the universal principal gate below:
  // a present link's own signed token IS its authentication, verified
  // inside the handler. Requiring a Bearer principal here would defeat
  // the entire point of a link meant for someone who never
  // authenticated with this server.
  if (segments[1] === "artifacts" && segments[3] === "present" && request.method === "GET") {
    return artifactsPresent.artifactPresent(ctx, request, segments[2])
  }
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "auth.principal", 401)
  if (!ctx.rateLimiter.take(principal.id)) {
    return ctx.deny(principal, "auth.rate-limit", 429, { reason: "rate-limit-exceeded" })
  }
  if (request.method === "POST" && segments[1] === "handshake") return handshake.handshake(ctx, request)
  if (request.method === "POST" && segments[1] === "workspaces" && segments[2] === "register") {
    return workspace.register(ctx, request, principal)
  }
  if (segments[1] === "workspaces" && segments[3] === "open" && request.method === "POST") {
    return workspace.open(ctx, segments[2], principal)
  }
  if (segments[1] === "workspaces" && segments[3] === "sessions") {
    return workspace.sessions(ctx, request, segments[2], principal)
  }
  if (segments[1] === "workspaces" && segments[3] === "events" && request.method === "GET") {
    return workspaceEventsStream.workspaceEvents(ctx, request, segments[2], principal)
  }
  if (segments[1] === "sessions" && segments[3] === "prompt" && request.method === "POST") {
    return sessions.prompt(ctx, request, segments[2])
  }
  if (segments[1] === "sessions" && segments[3] === "events" && request.method === "GET") {
    return sessions.events(ctx, request, segments[2], principal)
  }
  if (segments[1] === "operations" && segments[3] === "cancel" && request.method === "POST") {
    return sessions.cancelOperation(ctx, request, segments[2], principal)
  }
  if (
    segments[1] === "files" &&
    (segments[2] === "read" ||
      segments[2] === "write" ||
      segments[2] === "create" ||
      segments[2] === "remove" ||
      segments[2] === "rename") &&
    request.method === "POST"
  ) {
    return files.files(ctx, request, segments[2] as "read" | "write" | "create" | "remove" | "rename", principal)
  }
  if (segments[1] === "files" && (segments[2] === "list" || segments[2] === "search") && request.method === "GET") {
    return files.fileIndex(ctx, request, segments[2] as "list" | "search", principal)
  }
  if (segments[1] === "design-systems" && request.method === "GET") {
    return files.designSystems(ctx, request, principal)
  }
  if (segments[1] === "file-sessions" && request.method === "DELETE") {
    return workspace.closeFileSession(ctx, request, segments[2])
  }
  if (segments[1] === "approvals" && request.method === "GET") {
    return approvals.approvalList(ctx, request)
  }
  if (segments[1] === "approvals" && (request.method === "POST" || request.method === "DELETE")) {
    return approvals.approval(ctx, request, segments[2])
  }
  // Durable workflow surface (directive 35): start/resume/cancel/inspect
  if (segments[1] === "workflows" && request.method === "POST" && segments.length === 2) {
    return workflows.start(ctx, request)
  }
  if (segments[1] === "workflows" && segments[3] === "resume" && request.method === "POST") {
    return workflows.resume(ctx, request, segments[2])
  }
  if (segments[1] === "workflows" && segments[3] === "cancel" && request.method === "POST") {
    return workflows.cancel(ctx, request, segments[2])
  }
  if (segments[1] === "workflows" && request.method === "GET" && segments.length === 3) {
    return workflows.inspect(ctx, request, segments[2])
  }
  if (segments[1] === "trace" && request.method === "GET") {
    return approvals.auditPage(ctx, request, "trace")
  }
  if (segments[1] === "activity" && request.method === "GET") {
    return approvals.auditPage(ctx, request, "activity")
  }
  if (segments[1] === "artifacts" && segments[3] === "raw" && request.method === "GET") {
    return artifacts.artifactRaw(ctx, request, segments[2], segments.slice(4).join("/"), principal)
  }
  if (segments[1] === "artifacts" && segments[3] === "present" && request.method === "POST") {
    return artifactsPresent.artifactPresentLink(ctx, request, segments[2], principal)
  }
  if (segments[1] === "artifacts" && segments[3] === "history" && request.method === "GET") {
    return artifacts.artifactHistory(ctx, request, segments[2], principal)
  }
  if (segments[1] === "artifacts" && request.method === "GET") {
    return artifacts.artifactRead(ctx, request, segments[2], principal)
  }
  if (segments[1] === "artifacts" && segments[2] === "export" && request.method === "POST") {
    return artifacts.artifactExport(ctx, request, principal)
  }
  if (segments[1] === "artifacts" && request.method === "POST") {
    return artifacts.artifactWrite(ctx, request, principal)
  }
  if (segments[1] === "documents" && request.method === "GET") {
    return documents.documents(ctx, request, principal)
  }
  if (segments[1] === "specs" && segments[2] === "validate" && request.method === "POST") {
    return documents.specValidate(ctx, request, principal)
  }
  if (segments[1] === "browser" && request.method === "POST") {
    return automation.browserAction(ctx, request, segments[2], principal)
  }
  if (segments[1] === "desktop" && request.method === "POST") {
    return automation.desktopAction(ctx, request, segments[2], principal)
  }
  if (segments[1] === "workflows" && request.method === "POST") {
    return automation.workflowAction(ctx, request, segments[2], principal)
  }
  if (
    segments[1] === "memory" &&
    (request.method === "GET" || request.method === "POST" || request.method === "DELETE")
  ) {
    return memory.memoryAction(ctx, request, segments[2], principal)
  }
  if (segments[1] === "capabilities" && (request.method === "GET" || request.method === "POST")) {
    return capabilities.capabilityAction(ctx, request, segments[2], principal)
  }
  if (segments[1] === "ui" && segments[2] === "actions" && request.method === "POST") {
    return ui.uiAction(ctx, request, principal)
  }
  if (segments[1] === "ui" && segments[2] === "render" && request.method === "POST") {
    return ui.renderUi(ctx, request)
  }
  if (
    segments[1] === "skill-hub" &&
    (segments[2] === "search" || segments[2] === "install" || segments[2] === "update") &&
    ((request.method === "GET" && segments[2] === "search") || request.method === "POST")
  ) {
    return skillHub.skillHubAction(ctx, request, segments[2])
  }
  if (segments[1] === "design-skills" && request.method === "GET") {
    return skillHub.designSkillsAction(ctx, request, principal)
  }
  if (segments[1] === "github" && segments[2] === "status" && request.method === "GET") {
    return github.githubAction(ctx, request, "status", principal)
  }
  if (segments[1] === "github" && segments[2] === "device" && request.method === "POST") {
    return github.githubAction(ctx, request, segments[3] ?? "", principal)
  }
  if (segments[1] === "github" && segments[2] === "disconnect" && request.method === "POST") {
    return github.githubAction(ctx, request, "disconnect", principal)
  }
  if (segments[1] === "plugins" && request.method === "GET" && !segments[2]) {
    return plugins.pluginsList(ctx, request, principal)
  }
  if (segments[1] === "plugins" && segments[2] && request.method === "GET" && !segments[3]) {
    return plugins.pluginRead(ctx, request, segments[2], principal)
  }
  if (segments[1] === "plugins" && segments[2] === "install" && request.method === "POST" && segments[3]) {
    return plugins.pluginInstall(ctx, request, segments[3], principal)
  }
  if (segments[1] === "plugins" && segments[2] === "apply" && request.method === "POST" && segments[3]) {
    return plugins.pluginApply(ctx, request, segments[3], principal)
  }
  if (segments[1] === "plugins" && segments[2] && request.method === "DELETE" && !segments[3]) {
    return plugins.pluginDelete(ctx, request, segments[2], principal)
  }
  return ctx.deny(principal, "route.unknown", 404)
}
