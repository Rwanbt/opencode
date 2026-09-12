/* SPDX-License-Identifier: MIT */

import { WorkbenchCleanupError, WorkbenchLifecycle } from "../src/lifecycle.js"
import { test } from "bun:test"

test('lifecycle.test', async () => {

const lifecycle = new WorkbenchLifecycle()
const phases: string[] = []
lifecycle.subscribe((state) => phases.push(state.phase))

let releaseIssue!: () => void
const issueGate = new Promise<void>((resolve) => { releaseIssue = resolve })
let issued = 0
let revoked = 0
const connect = lifecycle.connect("instance-1/workspace-1", async ({ setPhase, acquire }) => {
  setPhase("opening")
  setPhase("issuing")
  issued += 1
  acquire(async () => { revoked += 1 })
  await issueGate
  setPhase("handshaking")
  return { instanceId: "instance-1", workspaceId: "workspace-1" }
})
const duplicate = lifecycle.connect("instance-1/workspace-1", async () => { throw new Error("duplicate flight") })
if (connect !== duplicate || issued !== 1) throw new Error("lifecycle did not enforce single-flight")
releaseIssue()
await connect
if (!phases.includes("ready") || revoked !== 0) throw new Error("lifecycle did not reach ready without cleanup")
await lifecycle.retry("instance-1/workspace-1")
if (revoked !== 1) throw new Error("retry did not wait for and perform cleanup")

let handshakeRejected = false
try {
  await lifecycle.connect("instance-2/workspace-1", async ({ setPhase, acquire }) => {
    setPhase("issuing")
    acquire(async () => { revoked += 1 })
    setPhase("handshaking")
    throw new Error("handshake rejected")
  })
} catch { handshakeRejected = true }
if (!handshakeRejected || revoked !== 2) throw new Error("handshake failure did not rollback the lease")

let cleanupFailed = false
try {
  await lifecycle.connect("instance-3/workspace-1", async ({ acquire }) => {
    acquire(async () => { throw new Error("revoke rejected") })
    throw new Error("primary failure")
  })
} catch (error) { cleanupFailed = error instanceof WorkbenchCleanupError }
if (!cleanupFailed || lifecycle.state("instance-3/workspace-1")?.phase !== "cleanup_failed") throw new Error("cleanup failure was not terminal")

console.log("WorkbenchLifecycle: 4/4 passed")
})
