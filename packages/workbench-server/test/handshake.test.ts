/* SPDX-License-Identifier: MIT */

import { WIRE_PROTOCOL_VERSION } from "@unifia/contracts/workbench-wire"
import { UnauthenticatedPrincipal } from "../src/auth.js"
import { ScopedTokenIssuer } from "../src/auth.js"
import { WorkbenchServer } from "../src/index.js"

const audit: string[] = []
const server = new WorkbenchServer({
  auth: new UnauthenticatedPrincipal(),
  instanceId: "server-instance-1",
  tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 60_000, 30_000),
  workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }), close: async () => undefined } as never,
  runtime: {} as never,
  audit: { record: (context) => { audit.push(context.action) } },
  capability: { check: async () => "allow" },
})

const request = (body: unknown) => server.fetch(new Request("http://127.0.0.1/v1/handshake", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}))

const accepted = await request({
  kind: "workbench.handshake",
  protocolVersion: WIRE_PROTOCOL_VERSION,
  supportedVersions: [WIRE_PROTOCOL_VERSION],
  clientInstanceId: "client-instance-1",
})
if (accepted.status !== 200) throw new Error(`accepted handshake returned ${accepted.status}`)
const acceptedBody = await accepted.json() as Record<string, unknown>
if (acceptedBody.accepted !== true || acceptedBody.instanceId !== "server-instance-1") throw new Error("accepted handshake response was not authoritative")

const refused = await request({
  kind: "workbench.handshake",
  protocolVersion: 99,
  supportedVersions: [99],
  clientInstanceId: "client-instance-1",
})
if (refused.status !== 200) throw new Error(`unsupported handshake returned ${refused.status}`)
const refusedBody = await refused.json() as Record<string, unknown>
if (refusedBody.accepted !== false || refusedBody.reason !== "unsupported-version") throw new Error("unsupported handshake was not refused explicitly")

const invalid = await request({ kind: "not-a-handshake" })
if (invalid.status !== 400) throw new Error(`invalid handshake returned ${invalid.status}`)
if (!audit.includes("handshake.accept") || !audit.includes("handshake.unsupported-version")) throw new Error("handshake decisions were not audited")

const issued = await server.issueNativeScopedToken({ principalId: "client-1", workspaceId: "workspace-1", capabilities: ["workspace.read"] })
if (issued.instanceId !== "server-instance-1" || server.openFileSessions !== 1) throw new Error("native token issue did not bind the server instance")
const rotation = await server.rotateNativeScopedToken({ principalId: "client-1", workspaceId: "workspace-1", capabilities: ["workspace.read"] })
if (!rotation.previousToken || rotation.gracePeriodMs !== 30_000) throw new Error("native token rotation did not preserve the grace contract")
await server.revokeNativeScopedToken("workspace-1")
if (Number(server.openFileSessions) !== 0) throw new Error("native token revoke did not close the scoped session")

const nativeServer = new WorkbenchServer({
  auth: { authenticate: async () => undefined },
  instanceId: "native-instance-1",
  tokenIssuer: new ScopedTokenIssuer("y".repeat(32), 60_000, 30_000),
  workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }), close: async () => undefined, list: async () => [] } as never,
  runtime: {} as never,
  audit: { record: () => undefined },
  capability: { check: async () => "allow" },
})
const nativeToken = await nativeServer.issueNativeScopedToken({ principalId: "native-client", workspaceId: "workspace-2", capabilities: ["workspace.read"] })
const nativeRead = await nativeServer.fetch(new Request("http://127.0.0.1/v1/files/list?workspaceId=workspace-2", {
  headers: { "x-unifia-file-session": nativeToken.token },
}))
if (nativeRead.status !== 200) throw new Error(`native scoped token was not accepted by the server: ${nativeRead.status}`)

console.log("WorkbenchServer handshake: 5/5 passed")
