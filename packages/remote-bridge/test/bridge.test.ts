/* SPDX-License-Identifier: MIT */

/**
 * The five §22 exit criteria, each exercised rather than asserted.
 */

import { createHash, createHmac } from "node:crypto"
import { ApprovalBroker, KillSwitchRegistry, SecretStore, type RemoteAudit, type RemoteBridgePolicy, type RemoteMessage } from "@unifia/contracts"
import { RemoteBridge, constantTimeEquals, verifySlackSignature, type Ingress } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

let now = 1_700_000_000_000
const seconds = (): string => String(Math.floor(now / 1000))

const SLACK_SECRET = "slack-signing-secret-value"
const FEISHU_KEY = "feishu-encrypt-key-value"
const store = new SecretStore(() => now)
store.put({ name: "slack.signing_secret", value: SLACK_SECRET })
store.put({ name: "feishu.encrypt_key", value: FEISHU_KEY })

const audit: Array<{ type: string; identityId: string; reason?: string }> = []
const sink: RemoteAudit = { record: (event) => audit.push(event) }

const policy: RemoteBridgePolicy = {
  allowedChannels: ["C1", "chat-1"],
  allowedUsers: ["U1", "user-1"],
  maxMessageAgeMs: 30_000,
  maxAttachmentBytes: 1_000,
  maxMessagesPerMinute: 10,
  readOnlyCommands: ["status"],
}

const switches = new KillSwitchRegistry()
const approvals = new ApprovalBroker(() => now)
const bridge = new RemoteBridge({
  policy,
  audit: sink,
  switches,
  approvals,
  now: () => now,
  secrets: {
    slack: { store, name: "slack.signing_secret", scope: "remote.slack" },
    feishu: { store, name: "feishu.encrypt_key", scope: "remote.feishu" },
  },
})

// --- Signatures are the schemes the providers publish ----------------------------
const slackBody = JSON.stringify({ event: { text: "hello" } })
const slackSignature = (body: string, ts: string, secret = SLACK_SECRET): string =>
  `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`
const feishuSignature = (body: string, ts: string, nonce: string, key = FEISHU_KEY): string =>
  createHash("sha256").update(`${ts}${nonce}${key}${body}`).digest("hex")

const slackMessage = (id: string): RemoteMessage => ({ id, channelId: "C1", userId: "U1", text: "hello", timestamp: now })
const slackIngress = (id: string, over: Partial<Ingress["request"]> = {}): Ingress => ({
  provider: "slack",
  message: slackMessage(id),
  request: { rawBody: slackBody, timestamp: seconds(), signature: slackSignature(slackBody, seconds()), ...over },
  nonce: id,
})

check(constantTimeEquals("abc", "abc") && !constantTimeEquals("abc", "abd") && !constantTimeEquals("ab", "abc"), "constant-time compare disagrees with equality")

// --- Criterion 4: transports disable separately ------------------------------------
check(!bridge.transports.isEnabled("slack"), "a transport was enabled before anyone turned it on")
bridge.transports.enable("slack")
bridge.transports.enable("feishu")
bridge.pair({ id: "slack:U1", providerId: "slack", userId: "U1", scopes: ["read"], expiresAt: now + 600_000 })
bridge.pair({ id: "feishu:user-1", providerId: "feishu", userId: "user-1", scopes: ["read"], expiresAt: now + 600_000 })

bridge.transports.disable("slack")
const slackOff = bridge.ingest(slackIngress("m-off"), "slack:U1")
check(!slackOff.accepted && slackOff.refusal.kind === "transport-disabled", "disabling Slack did not refuse Slack traffic")
check(bridge.transports.isEnabled("feishu"), "disabling Slack also disabled Feishu")

const feishuNonce = "n-1"
const feishuBody = JSON.stringify({ event_id: "e-1" })
const feishuIngress: Ingress = {
  provider: "feishu",
  message: { id: "e-1", channelId: "chat-1", userId: "user-1", text: "hi", timestamp: now },
  request: { rawBody: feishuBody, timestamp: seconds(), nonce: feishuNonce, signature: feishuSignature(feishuBody, seconds(), feishuNonce) },
}
check(bridge.ingest(feishuIngress, "feishu:user-1").accepted, "Feishu was refused while it was still enabled")
bridge.transports.enable("slack")

// The global kill switch still wins over both, and is a separate control.
switches.engage("all-remote")
check(bridge.transports.state("slack") === "killed" && bridge.transports.state("feishu") === "killed", "the global kill switch left a transport reachable")
switches.release("all-remote")
check(bridge.transports.isEnabled("slack"), "releasing the kill switch did not restore an enabled transport")

// --- A forged or stale signature never reaches the identity check --------------------
const forged = bridge.ingest(slackIngress("m-forged", { signature: slackSignature(slackBody, seconds(), "wrong-secret") }), "slack:U1")
check(!forged.accepted && forged.refusal.kind === "signature" && forged.refusal.reason === "bad-signature", "a forged Slack signature was accepted")
const tampered = bridge.ingest(slackIngress("m-tampered", { rawBody: `${slackBody} ` }), "slack:U1")
check(!tampered.accepted && tampered.refusal.kind === "signature", "a tampered body kept its signature valid")
const stale = bridge.ingest(slackIngress("m-stale", { timestamp: String(Math.floor(now / 1000) - 3600), signature: slackSignature(slackBody, String(Math.floor(now / 1000) - 3600)) }), "slack:U1")
check(!stale.accepted && stale.refusal.kind === "signature" && stale.refusal.reason === "stale-timestamp", "an hour-old signed request was accepted")
check(!bridge.ingest(slackIngress("m-bad-ts", { timestamp: "not-a-number" }), "slack:U1").accepted, "a malformed timestamp was accepted")
const wrongVersion = bridge.ingest(slackIngress("m-v1", { signature: "v1=deadbeef" }), "slack:U1")
check(!wrongVersion.accepted && wrongVersion.refusal.kind === "signature" && wrongVersion.refusal.reason === "unsupported-version", "an unknown signature version was not refused")

// --- Pairing is explicit; an unknown sender allocates nothing ------------------------
const unknown = bridge.ingest(slackIngress("m-unknown"), "slack:ATTACKER")
check(!unknown.accepted && unknown.refusal.kind === "not-paired", "an unpaired sender was not refused")
check(!bridge.isPaired("slack:ATTACKER"), "an unpaired sender was recorded as paired by its own traffic")
check(!audit.some((event) => event.type === "pair" && event.identityId === "slack:ATTACKER"), "inbound traffic wrote a pair event for a sender nobody paired")

// --- Criterion 2: a replayed message is refused -------------------------------------
const first = slackIngress("m-1")
check(bridge.ingest(first, "slack:U1").accepted, "a well-formed signed message was refused")
const replay = bridge.ingest(first, "slack:U1")
check(!replay.accepted && replay.refusal.kind === "policy", "the same signed request was accepted twice")
check(audit.some((event) => event.type === "replay"), "the replay was not audited as a replay")

// --- Criterion 1: revocation takes effect locally in well under a second --------------
const before = process.hrtime.bigint()
check(bridge.revoke("slack:U1"), "revoking a paired identity reported no change")
const elapsedMs = Number(process.hrtime.bigint() - before) / 1e6
check(elapsedMs < 1000, `revocation took ${elapsedMs.toFixed(3)} ms, over the one-second budget`)
const afterRevoke = bridge.ingest(slackIngress("m-2"), "slack:U1")
check(!afterRevoke.accepted && afterRevoke.refusal.kind === "not-paired", "a revoked identity was still accepted")
check(!bridge.isPaired("slack:U1"), "a revoked identity is still reported as paired")
bridge.pair({ id: "slack:U1", providerId: "slack", userId: "U1", scopes: ["read"], expiresAt: now + 600_000 })

// --- Criterion 5: secrets live in SecretStore, and revoking one stops verification -----
check(store.names().includes("slack.signing_secret"), "the Slack signing secret is not held by SecretStore")
check(verifySlackSignature({ request: { rawBody: slackBody, timestamp: seconds(), signature: slackSignature(slackBody, seconds()) }, secret: { store, name: "slack.signing_secret", scope: "remote.slack" }, now, maxSkewMs: 300_000 }).ok, "a valid Slack signature failed to verify")
store.revoke("slack.signing_secret")
const noSecret = bridge.ingest(slackIngress("m-3"), "slack:U1")
check(!noSecret.accepted && noSecret.refusal.kind === "signature" && noSecret.refusal.reason === "missing-secret", "revoking the signing secret did not stop verification")
store.put({ name: "slack.signing_secret", value: SLACK_SECRET })
check(bridge.ingest(slackIngress("m-4"), "slack:U1").accepted, "restoring the secret did not restore verification")

// --- Criterion 3: no command path bypasses the ApprovalBroker --------------------------
const undeclared = bridge.authorizeCommand("slack:U1", { id: "c-1", text: "rm -rf /", scope: "global" })
check(undeclared.status === "denied" && undeclared.result === "capability-required", "a command declaring nothing was accepted")
const write = bridge.authorizeCommand("slack:U1", { id: "c-2", text: "edit", scope: "workspace", metadata: { capability: "workspace.write" } })
check(write.status === "pending-approval", "a write command did not go through the ApprovalBroker")
const approvalId = write.result && typeof write.result === "object" && "approvalId" in write.result ? String(write.result.approvalId) : ""
check(approvals.get(approvalId)?.status === "pending", "the approval request is not pending on the host broker")
check(bridge.resolveApproval(approvalId, "deny", "host-user") !== undefined, "resolving the approval returned nothing")
check(approvals.get(approvalId)?.status === "deny", "a denied approval was not recorded as denied")

check(bridge.authorizeCommand("slack:U1", { id: "c-3", text: "status", scope: "session", metadata: { mode: "read-only", command: "status" } }).status === "accepted", "an allowlisted read-only command was refused")
check(bridge.authorizeCommand("slack:U1", { id: "c-4", text: "deploy", scope: "session", metadata: { mode: "read-only", command: "deploy" } }).status === "denied", "an unlisted verb passed by claiming read-only")

// A disabled transport also closes the command path, not just ingestion.
bridge.transports.disable("slack")
check(bridge.authorizeCommand("slack:U1", { id: "c-5", text: "status", scope: "session", metadata: { mode: "read-only", command: "status" } }).result === "transport-disabled", "a disabled transport still accepted commands")
bridge.transports.enable("slack")
check(bridge.authorizeCommand("slack:UNKNOWN", { id: "c-6", text: "status", scope: "session", metadata: { mode: "read-only", command: "status" } }).result === "not-paired", "an unpaired identity reached the command path")

console.log(`RemoteBridge: ${checks}/${checks} passed`)
