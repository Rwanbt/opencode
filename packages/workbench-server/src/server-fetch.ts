/* SPDX-License-Identifier: MIT */
/**
 * The `WorkbenchServer.fetch` request envelope.
 *
 * Why extracted: the method is short (origin check, OPTIONS passthrough,
 * dispatch, catch-all audit), but bundling it with the class definition
 * would push the class file past the 200-LOC ceiling. It is a pure
 * function of the request and the ServerContext.
 */
import { addSecurityHeaders, checkRequestOrigin } from "./security.js"
import { json } from "./http.js"
import { systemAudit as systemAuditFn } from "./audit-context.js"
import { dispatch } from "./server-dispatch.js"
import type { ServerContext } from "./server-context.js"

/**
 * WHY the router is awaited in a separate method: this method used to inline
 * the if-chain and `return ctx.handler(...)` without awaiting. In an async
 * function a returned promise settles *outside* the try block, so the catch
 * below never saw a handler rejection — the error path was dead for every
 * route, and a failing handler escaped as an unhandled rejection instead of
 * an audited 400. In-memory tests never rejected, so nothing revealed it.
 */
export async function fetch(ctx: ServerContext, request: Request): Promise<Response> {
  // WHY hoisted above the try: SEC-002 — a handler that throws after origin
  // validation (e.g. a malformed JSON body) must still get nosniff and
  // access-control-allow-origin on its error response, or a fetch from an
  // allowed origin fails opaquely in the browser instead of surfacing the
  // real 400.
  let origin: ReturnType<typeof checkRequestOrigin> | undefined
  try {
    origin = checkRequestOrigin(request.headers.get("origin"), ctx.allowedOrigins)
    if (!origin.allowed) return addSecurityHeaders(json(403, { error: "origin not allowed" }))
    if (request.method === "OPTIONS") return addSecurityHeaders(new Response(null, { status: 204 }), origin.origin)
    return addSecurityHeaders(await dispatch(ctx, request), origin.origin)
  } catch (error) {
    systemAuditFn(ctx, "request.error", "deny", {
      reason: error instanceof Error ? error.message : "request failed",
    })
    return addSecurityHeaders(
      json(400, { error: error instanceof Error ? error.message : "request failed" }),
      origin?.allowed ? origin.origin : undefined,
    )
  }
}
