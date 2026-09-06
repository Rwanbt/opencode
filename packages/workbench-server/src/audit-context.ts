/* SPDX-License-Identifier: MIT */
/**
 * Audit helpers — the `#allow`/`#deny`/`#buildAuditContext` family.
 *
 * WHY extracted: every route handler calls one of these, and the
 * AuditContext shape is the contract the audit runtime consumes. Keeping
 * the construction logic here means the rest of the server never builds
 * an `AuditContext` by hand — a future audit-port change (extra fields,
 * PII redaction) lands in one file.
 */
import type { AuditContext, P3Capability, RuntimeDecision } from "@unifia/contracts"
import type { Principal } from "./auth.js"
import { json } from "./http.js"
import type { ServerContext } from "./server-context.js"

type AuditOpts = {
  authorizingCapability?: P3Capability | null
  resource?: string | null
  reason?: string | null
  capability?: string
}

/**
 * Build the full AuditContext. A null principal means a system-driven row
 * (pre-auth handshake, anonymous rejection, shutdown); the actor is then a
 * stable `system:workbench-server:<action>` string so a downstream reader
 * can tell system-driven from user-driven even when the principal is null.
 */
export function buildAuditContext(
  principal: Principal | null,
  action: string,
  opts: AuditOpts,
): AuditContext {
  const isSystem = principal === null
  const authorizingCapability = opts.authorizingCapability ?? null
  // The legacy `capability` slot is the gate's input (authorising
  // capability) when set, else the route label. This keeps
  // `event.capability` queries like the bootstrap test's
  // `entry.capability === "workspace.register"` and
  // `entry.capability === "auth.principal"` working unchanged.
  const capability = authorizingCapability ?? opts.capability ?? action
  return {
    actor: isSystem ? `system:workbench-server:${action}` : principal!.id,
    actorKind: isSystem ? "system" : "user",
    principalId: isSystem ? null : principal!.id,
    action,
    capability,
    authorizingCapability,
    resource: opts.resource ?? null,
    reason: opts.reason ?? null,
  }
}

/** One-shot helper for the pre-auth cases where no principal is in scope
 * (catch in fetch, handshake, shutdown). */
export function systemAudit(
  ctx: ServerContext,
  action: string,
  decision: RuntimeDecision,
  opts: { reason?: string; resource?: string } = {},
): void {
  ctx.audit.record(
    buildAuditContext(null, action, { reason: opts.reason ?? null, resource: opts.resource ?? null }),
    decision,
  )
}

/** Helper for the post-auth cases that have a principal in scope. */
export function userAudit(
  ctx: ServerContext,
  principal: Principal,
  action: string,
  decision: RuntimeDecision,
  opts: AuditOpts = {},
): void {
  ctx.audit.record(buildAuditContext(principal, action, opts), decision)
}

/** Record an `allow` decision and return nothing. */
export function allow(
  ctx: ServerContext,
  principal: Principal | null,
  action: string,
  opts: AuditOpts = {},
): void {
  ctx.audit.record(buildAuditContext(principal, action, opts), "allow")
}

/**
 * Record a `deny` decision and return a JSON error response carrying the
 * gate's capability when one was set, so clients that parse
 * `{"error":"denied","capability":"..."}` continue to see the broker's
 * input rather than the route label.
 */
export function deny(
  ctx: ServerContext,
  principal: Principal | null,
  action: string,
  status: number,
  opts: AuditOpts = {},
): Response {
  ctx.audit.record(buildAuditContext(principal, action, opts), "deny")
  return json(status, { error: "denied", capability: opts.capability ?? opts.authorizingCapability ?? action })
}
