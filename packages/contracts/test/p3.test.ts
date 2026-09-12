/* SPDX-License-Identifier: MIT */
import { describe, expect, it } from "vitest"
import {
  ApprovalBrokerDouble,
  CapabilityLifecycleDouble,
  ProvenanceGateDouble,
  RemoteTransportDouble,
  validateApprovalConfig,
} from "../src/p3.js"

const admissible = { sourceRepo: "unifia-fixtures", sourceCommit: "abc123", path: "pack/read", digest: "sha256:ok", license: "MIT" as const }

function expectDeny(result: { kind: string }, ruleId: string) {
  expect(result.kind).toBe("deny")
  expect(result).toMatchObject({ ruleId })
}

function expectAllow(result: { kind: string }) { expect(result.kind).toBe("allow") }

describe("P3 Lot 1 — ApprovalBroker C3", () => {
  it("C3-approval-timeout-deny", () => {
    let now = 100
    const broker = new ApprovalBrokerDouble(() => now)
    const request = broker.request("workspace.write", "/a", 200)
    now = 200
    expectDeny(broker.resolve(request.id, "allow", "operator"), "C3-timeout-deny")
  })

  it("C3-auto-rule-required", () => {
    expect(() => validateApprovalConfig({ mode: "auto" })).toThrow("global auto")
    expect(() => validateApprovalConfig({ mode: "allowlist" })).not.toThrow()
  })

  it("C3-approval-narrow-scope", () => {
    const broker = new ApprovalBrokerDouble(() => 100)
    const request = broker.request("workspace.write", "/a", 200)
    expectDeny(broker.resolve(request.id, "allow", "operator", "/b"), "C3-narrow-scope")
  })

  it("C3-approval-cancel-effective", () => {
    const broker = new ApprovalBrokerDouble(() => 100)
    const request = broker.request("workspace.write", "/a", 200)
    expectDeny(broker.cancel(request.id), "C3-cancel-effective")
    expectDeny(broker.resolve(request.id, "allow", "operator"), "C3-invalid-request")
  })
})

describe("P3 Lot 1 — ProvenanceRecord C4", () => {
  it("C4-anthropic-refused", () => expectDeny(new ProvenanceGateDouble().evaluate({ ...admissible, license: "RESTRICTED" }), "C4-license-refused"))
  it("C4-ee-refused", () => expectDeny(new ProvenanceGateDouble().evaluate({ ...admissible, path: "ee/tool" }), "C4-ee-refused"))
  it("C4-nested-wins", () => expectDeny(new ProvenanceGateDouble().evaluate({ ...admissible, nestedLicenses: ["RESTRICTED"] }), "C4-nested-wins"))
  it("C4-apache-attribution", () => expectDeny(new ProvenanceGateDouble().evaluate({ ...admissible, license: "Apache-2.0" }), "C4-apache-attribution"))
  it("C4-unknown-blocked", () => expectDeny(new ProvenanceGateDouble().evaluate({ ...admissible, license: "UNKNOWN" }), "C4-license-refused"))
})

describe("P3 Lot 1 — Capability lifecycle C5", () => {
  it("C5-install-not-enable", () => {
    const lifecycle = new CapabilityLifecycleDouble()
    expectAllow(lifecycle.install("sha256:one"))
    expect(lifecycle.inspect("sha256:one")).toEqual({ state: "registered", enabled: false })
  })

  it("C5-identity-is-digest", () => {
    const lifecycle = new CapabilityLifecycleDouble()
    expectAllow(lifecycle.install("sha256:a"))
    expectDeny(lifecycle.install("sha256:a"), "C5-no-overwrite")
    expectAllow(lifecycle.install("sha256:b"))
  })

  it("C5-no-overwrite", () => {
    const lifecycle = new CapabilityLifecycleDouble()
    expectAllow(lifecycle.install("sha256:one"))
    expectDeny(lifecycle.install("sha256:one"), "C5-no-overwrite")
  })

  it("C5-enable-needs-provenance", () => {
    const lifecycle = new CapabilityLifecycleDouble()
    expectAllow(lifecycle.install("sha256:one"))
    expectDeny(lifecycle.approve("sha256:one", { kind: "deny", ruleId: "C4-license-refused", reason: "restricted" }), "C5-enable-needs-provenance")
    expectAllow(lifecycle.approve("sha256:one", { kind: "allow", ruleId: "C4-admissible" }))
    expectAllow(lifecycle.materialize("sha256:one"))
    expectDeny(lifecycle.enable("sha256:one", { kind: "deny", ruleId: "C4-license-refused", reason: "restricted" }), "C5-enable-needs-provenance")
  })
})

describe("P3 Lot 1 — RemoteTransportPort C7", () => {
  it("C7-open-mode-refused", () => expect(() => new RemoteTransportDouble({ mode: "open" })).toThrow("open"))
  it("C7-websocket-no-creds-denied", () => expectDeny(new RemoteTransportDouble({ mode: "token" }).receive({ id: "m1" }), "C7-no-credentials"))
  it("C7-replay-denied", () => {
    const remote = new RemoteTransportDouble({ mode: "token" })
    expectAllow(remote.receive({ id: "m1", credential: "id-1" }))
    expectDeny(remote.receive({ id: "m1", credential: "id-1" }), "C7-replay-denied")
  })
  it("C7-revoke-effective", () => {
    const remote = new RemoteTransportDouble({ mode: "token" })
    remote.revoke("id-1")
    expectDeny(remote.receive({ id: "m1", credential: "id-1" }), "C7-revoked")
  })
})