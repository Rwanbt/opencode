/* SPDX-License-Identifier: MIT */
/**
 * Durable workflow surface (directive 35, E2E layer): POST /v1/workflows
 * (start from a canonical definition), POST /v1/workflows/:id/resume,
 * POST /v1/workflows/:id/cancel, GET /v1/workflows/:id — all through
 * the injected substrate-backed NativeWorkflowRuntimePort. No second
 * authority: the port IS the native durable kernel boundary.
 */
import { body, json } from "../http.js"
import { userAudit } from "../audit-context.js"
import type { ServerContext } from "../server-context.js"
import type { WorkflowDefinitionPort } from "../workflow-port.js"

export async function start(ctx: ServerContext, request: Request): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const input = (await body(request)) as WorkflowDefinitionPort
  // fail-closed: a workflow with no steps is meaningless (no entry node)
  if (!input?.id || !Array.isArray(input?.steps) || input.steps.length === 0) return ctx.deny(principal, "workflow.definition", 400)
  const state = await ctx.workflow.start(input)
  userAudit(ctx, principal, "workflow.start", "allow", { workflowId: input.id, status: state.status })
  return json(201, state)
}

export async function resume(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const state = await ctx.workflow.resume(id)
  userAudit(ctx, principal, "workflow.resume", "allow", { workflowId: id, status: state.status })
  return json(200, state)
}

export async function cancel(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const state = await ctx.workflow.cancel(id)
  userAudit(ctx, principal, "workflow.cancel", "deny", { workflowId: id, status: state.status })
  return json(200, state)
}

export async function inspect(ctx: ServerContext, request: Request, id: string): Promise<Response> {
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "workflow.principal", 401)
  if (!ctx.workflow) return ctx.deny(principal, "workflow.unavailable", 501)
  const state = await ctx.workflow.resume(id)
  // Directive 37: the diagnosis surface is the READ-ONLY durable journal.
  const events = (await ctx.workflow.history?.(id)) ?? []
  return json(200, { ...state, events })
}
