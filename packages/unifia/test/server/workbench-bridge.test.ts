/* SPDX-License-Identifier: MIT */
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createWorkbenchBridge } from "../../src/server/workbench"
import { test } from "bun:test"

test('workbench-bridge.test', async () => {

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-workbench-bridge-"))
const previousPassword = process.env.UNIFIA_SERVER_PASSWORD
const previousToken = process.env.UNIFIA_KEYCHAIN_TOKEN
const previousAuditLog = process.env.UNIFIA_WORKBENCH_AUDIT_LOG
process.env.UNIFIA_SERVER_PASSWORD = "unifia-workbench-bridge-password-0123456789"
// D12 (§9.4 Lane D4) — the sidecar now decodes the IPC bearer
// through `tryDecodeWorkbenchIpcBearer`, which requires a 64-char
// lowercase hex string. The legacy "private-ipc-token" value (17
// chars) was a TestConventions-style placeholder; the production
// Tauri shell mints 256 bits as two concatenated UUIDv4 `simple()`
// strings (auth_storage.rs:282-283), and the test now mirrors that
// shape so the bearer round-trips through the typed boundary.
const ipcBearer = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
process.env.UNIFIA_KEYCHAIN_TOKEN = ipcBearer
process.env.UNIFIA_WORKBENCH_AUDIT_LOG = path.join(root, "workbench-audit.jsonl")

try {
  const bridge = createWorkbenchBridge()
  if (!bridge) throw new Error("private Workbench bridge did not initialize")
  const workspacePath = path.join(root, "workspace")
  await mkdir(workspacePath)
  const nativeHeaders = { "x-unifia-keychain-token": ipcBearer, "content-type": "application/json" }

  const opened = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: nativeHeaders,
    body: JSON.stringify({ action: "open", workspacePath }),
  }))
  if (opened.status !== 200) throw new Error(`native workspace open failed: ${opened.status}`)
  const workspace = await opened.json() as { workspaceId?: string; instanceId?: string }
  if (!workspace.workspaceId || !workspace.instanceId) throw new Error("native open did not return opaque workspace metadata")

  const issued = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: nativeHeaders,
    body: JSON.stringify({ action: "issue", workspaceId: workspace.workspaceId, capabilities: ["workspace.read"] }),
  }))
  if (issued.status !== 200) throw new Error(`native token issue failed: ${issued.status}`)
  const lease = await issued.json() as { token?: string; instanceId?: string; workspaceId?: string }
  if (!lease.token || lease.instanceId !== workspace.instanceId || lease.workspaceId !== workspace.workspaceId) throw new Error("native lease metadata was not bound to the opened workspace")

  const listed = await bridge.fetch(new Request(`http://127.0.0.1/workbench/v1/files/list?workspaceId=${encodeURIComponent(workspace.workspaceId)}`, {
    headers: { "x-unifia-file-session": lease.token },
  }))
  if (listed.status !== 200) throw new Error(`native lease was not accepted by the mounted Workbench route: ${listed.status} ${await listed.text()}`)

  const rotated = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: nativeHeaders,
    body: JSON.stringify({ action: "rotate", workspaceId: workspace.workspaceId, capabilities: ["workspace.read"] }),
  }))
  if (rotated.status !== 200) throw new Error(`native token rotation failed: ${rotated.status}`)
  const rotation = await rotated.json() as { token?: string; previousToken?: string | null; gracePeriodMs?: number }
  if (!rotation.token || rotation.previousToken !== lease.token || !rotation.gracePeriodMs) throw new Error("native rotation did not return the previous token grace lease")

  const previousStillWorks = await bridge.fetch(new Request(`http://127.0.0.1/workbench/v1/files/list?workspaceId=${encodeURIComponent(workspace.workspaceId)}`, {
    headers: { "x-unifia-file-session": rotation.previousToken },
  }))
  if (previousStillWorks.status !== 200) throw new Error(`previous native token was not accepted during grace: ${previousStillWorks.status}`)

  const revoked = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: nativeHeaders,
    body: JSON.stringify({ action: "revoke", workspaceId: workspace.workspaceId }),
  }))
  if (revoked.status !== 200) throw new Error(`native token revocation failed: ${revoked.status}`)
  const revokedLease = await bridge.fetch(new Request(`http://127.0.0.1/workbench/v1/files/list?workspaceId=${encodeURIComponent(workspace.workspaceId)}`, {
    headers: { "x-unifia-file-session": rotation.token },
  }))
  if (revokedLease.status === 200) throw new Error("revoked native token remained usable")

  const denied = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: { ...nativeHeaders, "x-unifia-keychain-token": "wrong" },
    body: JSON.stringify({ action: "issue", workspaceId: workspace.workspaceId }),
  }))
  if (denied.status !== 401) throw new Error(`invalid native IPC token was accepted: ${denied.status}`)

  // SEC-001/C2-3: readInput() checks capability names against
  // P3_CAPABILITIES, not just "is it an array of strings".
  const unknownCapability = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: nativeHeaders,
    body: JSON.stringify({ action: "issue", workspaceId: workspace.workspaceId, capabilities: ["workspace.read", "not-a-real-capability"] }),
  }))
  if (unknownCapability.status !== 400) throw new Error(`an unknown capability name was accepted: ${unknownCapability.status}`)
  const unknownBody = await unknownCapability.json() as { error?: string }
  if (!unknownBody.error?.includes("not-a-real-capability")) throw new Error(`error did not name the rejected capability: ${unknownBody.error}`)

  await bridge.app.server.shutdown()
  console.log("WorkbenchNativeBridge: 9/9 passed")
} finally {
  if (previousPassword === undefined) delete process.env.UNIFIA_SERVER_PASSWORD
  else process.env.UNIFIA_SERVER_PASSWORD = previousPassword
  if (previousToken === undefined) delete process.env.UNIFIA_KEYCHAIN_TOKEN
  else process.env.UNIFIA_KEYCHAIN_TOKEN = previousToken
  if (previousAuditLog === undefined) delete process.env.UNIFIA_WORKBENCH_AUDIT_LOG
  else process.env.UNIFIA_WORKBENCH_AUDIT_LOG = previousAuditLog
  await rm(root, { recursive: true, force: true })
}
})
