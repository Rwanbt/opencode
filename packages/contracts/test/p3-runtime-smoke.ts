/* SPDX-License-Identifier: MIT */
import assert from "node:assert/strict"
import { AuditRuntimeDouble, KillSwitchDouble, QuotaDouble, SecretStoreDouble } from "../src/p3-runtime.ts"
import type { P3Capability } from "../src/p3.ts"
let passed = 0
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`) }

test("C8-every-decision-logged", () => { const audit = new AuditRuntimeDouble(() => 1); const first = audit.record("operator", "workspace.write", "allow"); const second = audit.record("agent", "terminal.run", "deny"); assert.equal(audit.events().length, 2); assert.equal(second.previousHash, first.hash) })
test("C8-audit-chain-is-append-only", () => { const audit = new AuditRuntimeDouble(); audit.record("operator", "network.request", "approval_required"); const copy = audit.events(); copy.pop(); assert.equal(audit.events().length, 1) })
test("C8-audit-page-uses-cursor-and-bound", () => { const audit = new AuditRuntimeDouble(() => 1); audit.record("a", "x", "allow"); audit.record("b", "y", "deny"); assert.equal(audit.page(1, 1).events[0]?.sequence, 2); assert.equal(audit.page(0, 1).nextCursor, 1) })
test("C9-secret-not-returned-to-agent-loop", () => { const store = new SecretStoreDouble(); store.put("API_TOKEN", "secret-value"); const handle = store.read("API_TOKEN", "sandbox-1"); assert.ok(handle); assert.notEqual(handle, "secret-value"); assert.equal(store.resolve(handle!, "sandbox-2"), undefined); assert.equal(store.resolve(handle!, "sandbox-1"), "secret-value") })
test("C9-quota-exceeded-deny", () => { const quota = new QuotaDouble(10); assert.equal(quota.consume(7), true); assert.equal(quota.consume(4), false); assert.equal(quota.remaining(), 3) })
test("C9-kill-switch-all-remote", () => { const switches = new KillSwitchDouble(); switches.engage("all-remote"); assert.equal(switches.isEngaged("all-remote"), true); assert.equal(switches.isEngaged("all-plugin-enable"), false) })
test("C9-kill-switch-global", () => { const switches = new KillSwitchDouble(); switches.engage("global"); assert.equal(switches.isEngaged("all-remote"), true); assert.equal(switches.isEngaged("all-plugin-enable"), true) })
assert.equal(passed, 7)
console.log(`P3 C8/C9: ${passed}/7 passed`)
import { KillSwitchRegistry, SecretStore } from "../src/p3-runtime.ts"
test("C9-secret-store-issues-scoped-expiring-handles", () => { let now = 1_000; const store = new SecretStore(() => now, 10); store.put({ name: "TOKEN", value: "value" }); const handle = store.issue("TOKEN", "sandbox-a"); assert.ok(handle); assert.equal(store.resolve(handle!, "sandbox-b"), undefined); assert.equal(store.resolve(handle!, "sandbox-a"), "value"); now = 1_011; assert.equal(store.resolve(handle!, "sandbox-a"), undefined) })
test("C9-kill-switch-registry-is-reversible-and-global", () => { const switches = new KillSwitchRegistry(); switches.engage("browser"); assert.equal(switches.isEngaged("browser"), true); assert.equal(switches.isEngaged("computer-use"), false); switches.engage("global"); assert.equal(switches.isEngaged("computer-use"), true); switches.release("global"); assert.equal(switches.isEngaged("computer-use"), false) })

// DA-AUD-01/02/03: the new AuditContext overload carries the full
// attribution (principalId, actorKind, action, authorizingCapability,
// resource, reason) and includes them in the hash chain.
test("C8-audit-context-overload-carries-principal-and-action", () => {
  const audit = new AuditRuntimeDouble(() => 1)
  const event = audit.record({ actor: "operator-1", actorKind: "user", principalId: "operator-1", action: "workflow.start", capability: "workflow.run", authorizingCapability: "workflow.run" as P3Capability, resource: "ws-1", reason: "broker.request" }, "approval_required")
  assert.equal(event.actor, "operator-1")
  assert.equal(event.actorKind, "user")
  assert.equal(event.principalId, "operator-1")
  assert.equal(event.action, "workflow.start")
  assert.equal(event.authorizingCapability, "workflow.run")
  assert.equal(event.resource, "ws-1")
  assert.equal(event.reason, "broker.request")
})
test("C8-audit-system-row-distinguishable-from-user-row", () => {
  const audit = new AuditRuntimeDouble(() => 1)
  const sys = audit.record({ actor: "system:workbench-server:handshake.accept", actorKind: "system", principalId: null, action: "handshake.accept", capability: "handshake.accept", authorizingCapability: null, resource: null, reason: null }, "allow")
  const usr = audit.record({ actor: "operator-1", actorKind: "user", principalId: "operator-1", action: "workflow.start", capability: "workflow.run", authorizingCapability: "workflow.run" as P3Capability, resource: "ws-1", reason: null }, "allow")
  assert.equal(sys.actorKind, "system")
  assert.equal(sys.principalId, null)
  assert.equal(usr.actorKind, "user")
  assert.equal(usr.principalId, "operator-1")
  // Hashes differ: any change in attribution must break the chain.
  assert.notEqual(sys.hash, usr.hash)
})
test("C8-audit-hash-evolves-with-attribution-fields", () => {
  // The same logical event written with different principal ids produces
  // a different hash — a row that disagrees on the actor must NOT verify.
  const a = new AuditRuntimeDouble(() => 1).record({ actor: "operator-1", actorKind: "user", principalId: "operator-1", action: "x", capability: "x", authorizingCapability: null, resource: null, reason: null }, "allow")
  const b = new AuditRuntimeDouble(() => 1).record({ actor: "operator-2", actorKind: "user", principalId: "operator-2", action: "x", capability: "x", authorizingCapability: null, resource: null, reason: null }, "allow")
  assert.notEqual(a.hash, b.hash)
  // Same context at the same chain position: identical hash. Two fresh
  // chains (sequence 1, GENESIS) writing the same context MUST agree.
  const sameA = new AuditRuntimeDouble(() => 1).record({ actor: "operator-1", actorKind: "user", principalId: "operator-1", action: "x", capability: "x", authorizingCapability: null, resource: null, reason: null }, "allow")
  const sameB = new AuditRuntimeDouble(() => 1).record({ actor: "operator-1", actorKind: "user", principalId: "operator-1", action: "x", capability: "x", authorizingCapability: null, resource: null, reason: null }, "allow")
  assert.equal(sameA.hash, sameB.hash)
})
