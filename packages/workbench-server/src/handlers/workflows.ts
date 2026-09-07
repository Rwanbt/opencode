/* SPDX-License-Identifier: MIT */
/**
 * Durable workflow surface (directive 35, E2E layer): POST /v1/workflows
 * (start from a canonical definition), POST /v1/workflows/:id/resume,
 * POST /v1/workflows/:id/cancel, GET /v1/workflows/:id — all through
 * the injected substrate-backed NativeWorkflowRuntimePort. No second
 * authority: the port IS the native durable kernel boundary.
 */
import { AuthorityError } from "@unifia/workflow-runtime"
import { body, json, workflowAuthority } from "../http.js"
import { userAudit } from "../audit-context.js"
import type { ServerContext } from "../server-context.js"
import type { WorkflowDefinitionPort } from "../workflow-port.js"
// WHY a typed 409 instead of the generic 500 catch-all: a superseded
// authority token is an expected fencing outcome (#47), not a server
// fault - callers must be able to distinguish it from transport failure.
function staleAuthorityResponse(error: unknown): Response | undefined {
  if (error instanceof AuthorityError && error.code === "STALE_AUTHORITY") return json(409, { error: "STALE_AUTHORITY" })
  return undefined
}

export async function start(ctx: ServerContext, request: Request): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const input = (await body(request)) as WorkflowDefinitionPort
  // fail-closed: a workflow with no steps is meaningless (no entry node)
  if (!input?.id || !Array.isArray(input?.steps) || input.steps.length === 0) return ctx.deny(principal, "workflow.definition", 400)
  const state = await ctx.workflow.start(input, principal.id)
  userAudit(ctx, principal, "workflow.start", "allow", { resource: input.id, reason: state.status })
  return json(201, state)
}

export async function resume(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try { const state = await ctx.workflow.resume(token)
  userAudit(ctx, principal, "workflow.resume", "allow", { resource: id, reason: state.status })
  return json(200, state) } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}

export async function cancel(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try { const state = await ctx.workflow.cancel(token)
  userAudit(ctx, principal, "workflow.cancel", "deny", { resource: id, reason: state.status })
  return json(200, state) } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}

export async function inspect(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
  const state = await ctx.workflow.inspect(token)
  // Directive 37: the diagnosis surface is the READ-ONLY durable journal.
  const events = await ctx.workflow.history(token)
  return json(200, { ...state, events }) } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}

export async function runWorkflow(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
    const state = await ctx.workflow.run(token)
    userAudit(ctx, principal, "workflow.run", "allow", { resource: id, reason: state.status })
    return json(200, state)
  } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}

export async function listWorkflows(ctx: ServerContext, request: Request): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const workflows = await ctx.workflow.listWorkflows()
  return json(200, { workflows })
}

export async function nodeDetails(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const token = workflowAuthority(request)
  if (!token || token.workflowRunId !== id) return ctx.deny(principal, "workflow.authority", 400)
  try {
    const nodes = await ctx.workflow.executionNodes(token)
    return json(200, { nodes })
  } catch (error) { const stale = staleAuthorityResponse(error); if (stale) return stale; throw error }
}
