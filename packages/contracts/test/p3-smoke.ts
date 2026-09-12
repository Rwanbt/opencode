/* SPDX-License-Identifier: MIT */
import assert from "node:assert/strict"
import { ApprovalBrokerDouble, CapabilityLifecycleDouble, ProvenanceGateDouble, RemoteTransportDouble, validateApprovalConfig } from "../src/p3.ts"

let passed = 0
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`) }
function deny(value: { kind: string; ruleId: string }, ruleId: string) { assert.equal(value.kind, "deny"); assert.equal(value.ruleId, ruleId) }
function allow(value: { kind: string }) { assert.equal(value.kind, "allow") }
const base = { sourceRepo: "fixture", sourceCommit: "abc", path: "pack/read", digest: "sha256:ok", license: "MIT" as const }

test("C3-approval-timeout-deny", () => { let now = 100; const b = new ApprovalBrokerDouble(() => now); const r = b.request("workspace.write", "/a", 200); now = 200; deny(b.resolve(r.id, "allow", "operator"), "C3-timeout-deny") })
test("C3-auto-rule-required", () => { assert.throws(() => validateApprovalConfig({ mode: "auto" })); validateApprovalConfig({ mode: "allowlist" }) })
test("C3-approval-narrow-scope", () => { const b = new ApprovalBrokerDouble(() => 100); const r = b.request("workspace.write", "/a", 200); deny(b.resolve(r.id, "allow", "operator", "/b"), "C3-narrow-scope") })
test("C3-approval-cancel-effective", () => { const b = new ApprovalBrokerDouble(() => 100); const r = b.request("workspace.write", "/a", 200); deny(b.cancel(r.id), "C3-cancel-effective"); deny(b.resolve(r.id, "allow", "operator"), "C3-invalid-request") })

test("C4-anthropic-refused", () => deny(new ProvenanceGateDouble().evaluate({ ...base, license: "RESTRICTED" }), "C4-license-refused"))
test("C4-ee-refused", () => deny(new ProvenanceGateDouble().evaluate({ ...base, path: "ee/tool" }), "C4-ee-refused"))
test("C4-nested-wins", () => deny(new ProvenanceGateDouble().evaluate({ ...base, nestedLicenses: ["RESTRICTED"] }), "C4-nested-wins"))
test("C4-apache-attribution", () => deny(new ProvenanceGateDouble().evaluate({ ...base, license: "Apache-2.0" }), "C4-apache-attribution"))
test("C4-unknown-blocked", () => deny(new ProvenanceGateDouble().evaluate({ ...base, license: "UNKNOWN" }), "C4-license-refused"))

test("C5-install-not-enable", () => { const l = new CapabilityLifecycleDouble(); allow(l.install("sha256:one")); assert.deepEqual(l.inspect("sha256:one"), { state: "registered", enabled: false }) })
test("C5-identity-is-digest", () => { const l = new CapabilityLifecycleDouble(); allow(l.install("sha256:a")); deny(l.install("sha256:a"), "C5-no-overwrite"); allow(l.install("sha256:b")) })
test("C5-no-overwrite", () => { const l = new CapabilityLifecycleDouble(); allow(l.install("sha256:one")); deny(l.install("sha256:one"), "C5-no-overwrite") })
test("C5-enable-needs-provenance", () => { const l = new CapabilityLifecycleDouble(); allow(l.install("sha256:one")); deny(l.approve("sha256:one", { kind: "deny", ruleId: "C4-license-refused", reason: "restricted" }), "C5-enable-needs-provenance"); allow(l.approve("sha256:one", { kind: "allow", ruleId: "C4-admissible" })); allow(l.materialize("sha256:one")); deny(l.enable("sha256:one", { kind: "deny", ruleId: "C4-license-refused", reason: "restricted" }), "C5-enable-needs-provenance") })

test("C7-open-mode-refused", () => assert.throws(() => new RemoteTransportDouble({ mode: "open" })))
test("C7-websocket-no-creds-denied", () => deny(new RemoteTransportDouble({ mode: "token" }).receive({ id: "m1" }), "C7-no-credentials"))
test("C7-replay-denied", () => { const r = new RemoteTransportDouble({ mode: "token" }); allow(r.receive({ id: "m1", credential: "id-1" })); deny(r.receive({ id: "m1", credential: "id-1" }), "C7-replay-denied") })
test("C7-revoke-effective", () => { const r = new RemoteTransportDouble({ mode: "token" }); r.revoke("id-1"); deny(r.receive({ id: "m1", credential: "id-1" }), "C7-revoked") })

assert.equal(passed, 17)
console.log(`P3 Lot 1: ${passed}/17 passed`)