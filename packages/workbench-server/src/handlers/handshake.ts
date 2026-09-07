/* SPDX-License-Identifier: MIT */
/**
 * POST /v1/handshake — wire-protocol version negotiation.
 *
 * Pre-auth route, so the only thing it returns is whether the requested
 * `protocolVersion` is the one this server speaks. A refusal emits the
 * supported list; an accept echoes the negotiated version. Both are
 * audited as system events (no principal in scope).
 */
import { WIRE_PROTOCOL_VERSION, parseHandshakeRequest } from "@unifia/contracts/workbench-wire"
import { body, json } from "../http.js"
import { systemAudit } from "../audit-context.js"
import type { ServerContext } from "../server-context.js"

export async function handshake(ctx: ServerContext, request: Request): Promise<Response> {
  const input = parseHandshakeRequest(await body(request))
  const supported =
    input.protocolVersion === WIRE_PROTOCOL_VERSION && input.supportedVersions.includes(WIRE_PROTOCOL_VERSION)
  if (!supported) {
    systemAudit(ctx, "handshake.unsupported-version", "deny", { reason: "unsupported-version" })
    return json(200, {
      kind: "workbench.handshake.refused",
      accepted: false,
      protocolVersion: null,
      supportedVersions: [WIRE_PROTOCOL_VERSION],
      instanceId: ctx.instanceId,
      reason: "unsupported-version",
    })
  }
  systemAudit(ctx, "handshake.accept", "allow")
  return json(200, {
    kind: "workbench.handshake.accepted",
    accepted: true,
    protocolVersion: WIRE_PROTOCOL_VERSION,
    supportedVersions: [WIRE_PROTOCOL_VERSION],
    instanceId: ctx.instanceId,
  })
}
