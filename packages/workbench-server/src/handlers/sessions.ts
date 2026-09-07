/* SPDX-License-Identifier: MIT */
/**
 * Per-session routes: the single-session SSE event stream, prompt
 * dispatch, and the operation-cancel route that wraps a runtime
 * cancel. The multi-session merged stream (FUNC-001/C2-2) is its own
 * file: `./workspace-events-stream.ts`.
 */
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import { sseFrame } from "../workspace-events.js"
import type { ServerContext } from "../server-context.js"

/** GET /v1/sessions/:id/events — single-session SSE stream. */
export async function events(
  ctx: ServerContext,
  request: Request,
  sessionId: string,
  principal: Principal,
): Promise<Response> {
  const workspaceId = ctx.sessionOwners.get(sessionId)
  if (!workspaceId || !ctx.authorize(request, workspaceId)) {
    return ctx.deny(principal, "session.events.scope", 403, { resource: sessionId })
  }
  const eventGate = await ctx.checkCapability("workspace.watch", workspaceId, principal)
  if (eventGate) return eventGate
  const requestedCursor = Number(
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? "0",
  )
  const afterSequence = Number.isSafeInteger(requestedCursor) && requestedCursor > 0 ? requestedCursor : 0
  const iterator = ctx.runtime.subscribeEvents({ sessionId, afterSequence })[Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // WHY an immediate comment frame: without any byte on the wire the
      // client can stall waiting for headers to flush, and an idle connection
      // is a candidate for proxy and server idle timeouts before the first
      // real event ever arrives. A comment line is ignored by SSE parsers.
      controller.enqueue(encoder.encode(": unifia stream open\n\n"))
    },
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(sseFrame(next.value)))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
  ctx.allow(principal, "session.events", { resource: workspaceId })
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" },
  })
}

/** POST /v1/sessions/:id/prompt — fire-and-forget prompt dispatch. */
export async function prompt(ctx: ServerContext, request: Request, sessionId: string): Promise<Response> {
  const workspaceId = ctx.sessionOwners.get(sessionId)
  const token = workspaceId ? ctx.authorize(request, workspaceId) : undefined
  if (!token || !workspaceId) return ctx.deny(null, "session.prompt.scope", 403, { resource: sessionId })
  const principal = await ctx.authenticate(request)
  if (!principal) return ctx.deny(null, "session.prompt.principal", 401)
  const input = await body(request)
  if (typeof input.prompt !== "string") {
    return ctx.deny(principal, "session.prompt", 400, { resource: workspaceId })
  }
  const operation = ctx.operations.start(
    workspaceId,
    sessionId,
    typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined,
  )
  if (operation.state === "completed") {
    return json(202, { accepted: true, workspaceId, operationId: operation.id })
  }
  void runPrompt(ctx, operation.id, sessionId, input.prompt)
  ctx.allow(principal, "session.prompt", { resource: workspaceId })
  return json(202, { accepted: true, workspaceId, operationId: operation.id })
}

async function runPrompt(ctx: ServerContext, operationId: string, sessionId: string, prompt: string): Promise<void> {
  try {
    await ctx.runtime.sendPrompt({ sessionId, prompt })
    ctx.operations.complete(operationId)
  } catch (error) {
    ctx.operations.fail(operationId, error)
  }
}

/** POST /v1/operations/:id/cancel — cancel an in-flight prompt. */
export async function cancelOperation(
  ctx: ServerContext,
  request: Request,
  operationId: string,
  principal: Principal,
): Promise<Response> {
  const operation = ctx.operations.get(operationId)
  if (!operation || !ctx.authorize(request, operation.workspaceId)) {
    return ctx.deny(principal, "operation.cancel.scope", 403, { resource: operationId })
  }
  const gate = await ctx.checkCapability("workspace.watch", operation.workspaceId, principal)
  if (gate) return gate
  const cancelled = ctx.operations.cancel(operationId)
  if (!cancelled) return ctx.deny(principal, "operation.cancel", 409, { resource: operationId })
  await ctx.runtime.cancelSession(operation.sessionId)
  ctx.allow(principal, "operation.cancel", { resource: operation.workspaceId })
  return json(200, { operation: cancelled })
}
