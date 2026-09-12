/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { ApprovalBroker, KillSwitchRegistry } from "@unifia/contracts"
import { SlackRemoteAdapter } from "../src/remote-adapter.ts"

let now = 1_000
const audit: Array<{ type: string; identityId: string; reason?: string }> = []
const policy = { allowedChannels: ["C1"], allowedUsers: ["U1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10, readOnlyCommands: ["read"] }
const adapter = new SlackRemoteAdapter({ policy, audit: { record: (event) => audit.push(event) }, signatureVerifiedBy: "slack-bolt", now: () => now, approvals: new ApprovalBroker(() => now) })

assert.equal(adapter.authorize({ id: "M1", channelId: "C1", userId: "U1", text: "hello", timestamp: now }), true)
assert.equal(adapter.authorize({ id: "M1", channelId: "C1", userId: "U1", text: "hello", timestamp: now }), false)
assert.equal(adapter.authorize({ id: "M2", channelId: "C2", userId: "U1", text: "blocked", timestamp: now }), false)
assert.equal(audit.some((event) => event.type === "replay"), true)

// An unlisted sender is refused without ever being paired by its own traffic.
assert.equal(adapter.authorize({ id: "M3", channelId: "C1", userId: "ATTACKER", text: "hi", timestamp: now }), false)
assert.equal(audit.some((event) => event.type === "pair" && event.identityId === "slack:ATTACKER"), false)

// Mounting the adapter anywhere but behind Bolt has to be a deliberate lie.
assert.throws(() => new SlackRemoteAdapter({ policy, audit: { record: () => {} }, signatureVerifiedBy: "none" as never }))

// Revocation is local, synchronous, and comfortably inside the one-second budget.
const before = process.hrtime.bigint()
assert.equal(adapter.revoke("U1"), true)
assert.ok(Number(process.hrtime.bigint() - before) / 1e6 < 1000)
assert.equal(adapter.authorize({ id: "M4", channelId: "C1", userId: "U1", text: "hello", timestamp: now }), false)

// The transport disables on its own, and the global kill switch still wins.
const solo = new SlackRemoteAdapter({ policy, audit: { record: () => {} }, signatureVerifiedBy: "slack-bolt", now: () => now, approvals: new ApprovalBroker(() => now) })
solo.setEnabled(false)
assert.equal(solo.authorize({ id: "M5", channelId: "C1", userId: "U1", text: "hi", timestamp: now }), false)
solo.setEnabled(true)
assert.equal(solo.authorize({ id: "M5", channelId: "C1", userId: "U1", text: "hi", timestamp: now }), true)
const switches = new KillSwitchRegistry()
switches.engage("all-remote")
const killed = new SlackRemoteAdapter({ policy, audit: { record: () => {} }, signatureVerifiedBy: "slack-bolt", now: () => now, switches })
assert.equal(killed.authorize({ id: "M6", channelId: "C1", userId: "U1", text: "blocked", timestamp: now }), false)

// A command that declares nothing does not reach the runtime.
assert.equal(solo.authorizeCommand("U1", { id: "c-1", text: "rm -rf /", scope: "global" }).result, "capability-required")
assert.equal(solo.authorizeCommand("U1", { id: "c-2", text: "/read logs", scope: "session", metadata: { mode: "read-only", command: "read" } }).status, "accepted")
assert.equal(solo.authorizeCommand("U1", { id: "c-3", text: "prompt", scope: "session", metadata: { capability: "workspace.write" } }).status, "pending-approval")

console.log("SlackRemoteAdapter: 16/16 passed")
