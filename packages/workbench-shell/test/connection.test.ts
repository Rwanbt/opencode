/* SPDX-License-Identifier: MIT */

import { WIRE_PROTOCOL_VERSION } from "@unifia/contracts/workbench-wire"
import { connectWorkbench } from "../src/client.js"
import { test } from "bun:test"

test('connection.test', async () => {

const encode = (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const instanceId = "native-instance-1"
const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${encode({ instanceId, workspaceId: "workspace-1" })}.signature`
let revoked = 0
const connection = await connectWorkbench({
  baseUrl: "http://127.0.0.1:7444",
  bridge: {
    issue: async () => ({ token, instanceId, workspaceId: "workspace-1", expiresAt: Date.now() + 60_000 }),
    rotate: async () => ({ token, instanceId, workspaceId: "workspace-1", expiresAt: Date.now() + 60_000 }),
    revoke: async () => { revoked += 1 },
  },
  tokenRequest: { workspaceId: "workspace-1", capabilities: ["workspace.read"] },
  fetchImpl: async (_input, init) => {
    if (init?.method !== "POST") throw new Error("connection test expected handshake POST")
    return new Response(JSON.stringify({ kind: "workbench.handshake.accepted", accepted: true, protocolVersion: WIRE_PROTOCOL_VERSION, supportedVersions: [WIRE_PROTOCOL_VERSION], instanceId }), { status: 200, headers: { "content-type": "application/json" } })
  },
})
if (connection.instanceId !== instanceId || connection.workspaceId !== "workspace-1") throw new Error("connection did not preserve native scope")
await connection.revoke()
if (revoked !== 1) throw new Error("connection did not revoke its native lease")
console.log("WorkbenchConnection: 2/2 passed")

let handshakeRevoked = 0
let rejected = false
try {
  await connectWorkbench({
    baseUrl: "http://127.0.0.1:7444",
    bridge: {
      issue: async () => ({ token, instanceId, workspaceId: "workspace-1", expiresAt: Date.now() + 60_000 }),
      rotate: async () => ({ token, instanceId, workspaceId: "workspace-1", expiresAt: Date.now() + 60_000 }),
      revoke: async () => { handshakeRevoked += 1 },
    },
    tokenRequest: { workspaceId: "workspace-1", capabilities: ["workspace.read"] },
    fetchImpl: async () => new Response(JSON.stringify({ kind: "workbench.handshake.rejected", accepted: false, protocolVersion: WIRE_PROTOCOL_VERSION, supportedVersions: [WIRE_PROTOCOL_VERSION], instanceId }), { status: 200 }),
  })
} catch { rejected = true }
if (!rejected || handshakeRevoked !== 1) throw new Error("handshake rejection did not revoke the issued lease")
console.log("WorkbenchConnection: rollback passed")
})
