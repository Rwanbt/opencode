/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */
/**
 * C-M1-08 — Capability Authority enforcer tests.
 *
 * Plan V2.3.1 §114 + §195 (M1 gate) + ADR-002 + ADR-020 + ADR-024.
 * Multi-review C-AR-01 (Medium). Threat model TM-T-01, TM-T-02, TM-CP-01.
 *
 * Production lift of the M1-05 spike
 * (docs/automation-v2/spikes/m1-05-capability-enforcer.ts). Each test
 * here maps to a numbered M1-05 vector or to a production-only edge
 * case the spike did not exercise.
 */
import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign as edSign } from "node:crypto"
import type {
  DeploymentScope,
  OwnershipScope,
  WorkerId,
} from "@unifia/contracts"
import {
  CAPABILITY_MIN_TRUST,
  DEFAULT_GRANT_TTL_MS,
  computeBindingDigest,
  createSecureCapabilityRegistry,
  enforce,
  requiredTrustClass,
  type SignedManifest,
} from "../src/index.ts"

// ============================================================================
// Test fixtures
// ============================================================================

const { privateKey } = generateKeyPairSync("ed25519")
const privPem = privateKey.export({ type: "pkcs8", format: "pem" })

const scopeA: OwnershipScope = { organizationId: "org-acme", projectId: "proj-1", workspaceId: "ws-alpha" }
const scopeB: OwnershipScope = { organizationId: "org-acme", projectId: "proj-1", workspaceId: "ws-beta" }
const scopeOtherOrg: OwnershipScope = { organizationId: "org-evil", projectId: "proj-1", workspaceId: "ws-alpha" }
const scopeC: OwnershipScope = { organizationId: "org-acme", projectId: "proj-1", workspaceId: "ws-gamma" }
const scopeProjA: OwnershipScope = { organizationId: "org-acme", projectId: "proj-A", workspaceId: "ws-alpha" }
const scopeProjB: OwnershipScope = { organizationId: "org-acme", projectId: "proj-B", workspaceId: "ws-alpha" }

const deploymentA: DeploymentScope = { ownershipScope: scopeA, environmentId: "prod" }
const deploymentB: DeploymentScope = { ownershipScope: scopeB, environmentId: "prod" }
const deploymentC: DeploymentScope = { ownershipScope: scopeC, environmentId: "prod" }
const deploymentProjB: DeploymentScope = { ownershipScope: scopeProjB, environmentId: "prod" }

const principalInA: WorkerId = {
  workerId: "w-1",
  identityProof: "proof-w-1",
  version: "1",
  platform: "linux-x64",
  capabilities: ["workspace.read", "network.request", "workflow.run", "secret.read", "terminal.run"],
  executionProfiles: ["docker"],
  resourceClass: "medium",
  scopes: [scopeA],
}
const principalInAB: WorkerId = {
  ...principalInA,
  workerId: "w-2",
  identityProof: "proof-w-2",
  scopes: [scopeA, scopeB],
}
const principalFromOtherOrg: WorkerId = {
  ...principalInA,
  workerId: "w-3",
  identityProof: "proof-w-3",
  scopes: [scopeOtherOrg],
}
const principalProjA: WorkerId = {
  ...principalInA,
  workerId: "w-pa",
  identityProof: "proof-w-pa",
  scopes: [scopeProjA],
}
const principalNoNetwork: WorkerId = {
  ...principalInA,
  workerId: "w-nonet",
  identityProof: "proof-w-nonet",
  capabilities: ["workspace.read", "workflow.run"],
  scopes: [scopeA],
}

const FROZEN = 1_700_000_000_000
const clock = () => FROZEN

function sign(payload: string, capability: string, trustClass: SignedManifest["trustClass"]): SignedManifest {
  const sig = edSign(null, Buffer.from(payload, "utf8"), privPem).toString("base64")
  return { capability, trustClass, payload, signature: sig }
}

const signedNetworkRE: SignedManifest = sign("unifia.capability-manifest.v1\nnetwork.request", "network.request", "REVIEWED_EXTENSION")

// ============================================================================
// Test suite
// ============================================================================

describe("C-M1-08 — Capability Authority enforcer", () => {
  test("(a) happy path — signed, REVIEWED_EXTENSION, scope match → grant", () => {
    const result = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    if (result.kind !== "grant") throw new Error(`expected grant, got ${result.kind}: ${result.reason}`)
    expect(result.grant.capability).toBe("network.request")
    expect(result.grant.scope).toEqual(deploymentA)
    expect(result.grant.expiresAt).toBeGreaterThan(result.grant.grantedAt)
    expect(result.grant.bindingDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  test("(b) unsigned manifest → MANIFEST_UNSIGNED", () => {
    const unsigned: SignedManifest = { ...signedNetworkRE, signature: undefined }
    const result = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", unsigned, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("MANIFEST_UNSIGNED")
  })

  test("(c) UNTRUSTED_THIRD_PARTY for network.request → TRUSTCLASS_TOO_LOW", () => {
    const lowTrust: SignedManifest = { ...signedNetworkRE, trustClass: "UNTRUSTED_THIRD_PARTY" }
    const result = enforce(principalInA, "network.request", deploymentA, "UNTRUSTED_THIRD_PARTY", lowTrust, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("TRUSTCLASS_TOO_LOW")
  })

  test("(d) principal lacks capability → CAPABILITY_NOT_IN_SCOPE (no capability match)", () => {
    const result = enforce(principalNoNetwork, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("CAPABILITY_NOT_IN_SCOPE")
  })

  test("(e) principal scope does not include requested scope → CAPABILITY_NOT_IN_SCOPE (TM-T-01)", () => {
    const result = enforce(principalFromOtherOrg, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("CAPABILITY_NOT_IN_SCOPE")
  })

  test("(f) DeploymentScope.ownershipScope ≠ primary scope → SCOPE_CHAIN_BROKEN (TM-T-02)", () => {
    // principalInAB has scopeB in its scopes[] (so check 3 passes),
    // but scopes[0] = scopeA ≠ scopeB, so check 4 fails.
    const result = enforce(principalInAB, "network.request", deploymentB, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("SCOPE_CHAIN_BROKEN")
  })

  test("(g) grant TTL is exactly 5 minutes", () => {
    const result = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    if (result.kind !== "grant") throw new Error(`expected grant, got ${result.kind}`)
    expect(result.grant.expiresAt - result.grant.grantedAt).toBe(DEFAULT_GRANT_TTL_MS)
    expect(result.grant.expiresAt - result.grant.grantedAt).toBe(5 * 60 * 1000)
  })

  test("(h) bindingDigest is exactly 64 lowercase hex characters", () => {
    const result = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    if (result.kind !== "grant") throw new Error(`expected grant, got ${result.kind}`)
    expect(result.grant.bindingDigest).toHaveLength(64)
    expect(result.grant.bindingDigest).toMatch(/^[0-9a-f]{64}$/)
    // Also reachable via the exported helper.
    const direct = computeBindingDigest(principalInA.workerId, "network.request", scopeA, FROZEN)
    expect(direct).toBe(result.grant.bindingDigest)
  })

  test("(i) replay protection — two grants at different grantedAt produce different digests", () => {
    const clock1 = () => FROZEN
    const clock2 = () => FROZEN + 1
    const r1 = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock1 })
    const r2 = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock2 })
    if (r1.kind !== "grant" || r2.kind !== "grant") throw new Error("both must grant")
    expect(r1.grant.bindingDigest).not.toBe(r2.grant.bindingDigest)
  })

  test("(j) revoke(bindingDigest) then check → MANIFEST_REVOKED", () => {
    const registry = createSecureCapabilityRegistry({ verify: () => true })
    const first = registry.check(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE)
    if (first.kind !== "grant") throw new Error(`expected grant, got ${first.kind}: ${first.reason}`)
    expect(registry.isRevoked(first.grant.bindingDigest)).toBe(false)
    registry.revoke(first.grant.bindingDigest)
    expect(registry.isRevoked(first.grant.bindingDigest)).toBe(true)
    // The enforcer would still grant (it's not the enforcer's job to know
    // about revocations); the registry's check() is what refuses.
    const after = registry.check(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedNetworkRE)
    expect(after.kind).toBe("deny")
    if (after.kind !== "deny") return
    expect(after.reason).toBe("MANIFEST_REVOKED")
  })

  test("(k) createSecureCapabilityRegistry is the unique entry; enforce() is also exported", () => {
    // Both are public: the registry for production callers, the
    // bare enforcer for tests + advanced callers.
    expect(typeof createSecureCapabilityRegistry).toBe("function")
    expect(typeof enforce).toBe("function")
    const registry = createSecureCapabilityRegistry({ verify: () => true })
    expect(typeof registry.check).toBe("function")
    expect(typeof registry.revoke).toBe("function")
    expect(typeof registry.isRevoked).toBe("function")
  })

  test("(l) trust matrix: terminal.run requires CORE, fails with UNTRUSTED_RUNTIME", () => {
    const signed: SignedManifest = sign("unifia.capability-manifest.v1\nterminal.run", "terminal.run", "UNTRUSTED_RUNTIME")
    const result = enforce(principalInA, "terminal.run", deploymentA, "UNTRUSTED_RUNTIME", signed, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("TRUSTCLASS_TOO_LOW")
    // And the matrix says CORE is the minimum.
    expect(CAPABILITY_MIN_TRUST["terminal.run"]).toBe("CORE")
    expect(requiredTrustClass("terminal.run")).toBe("CORE")
  })

  test("(m) workspace-level scope check: principal in org-1/ws-alpha cannot act in org-1/ws-gamma", () => {
    // Same organization, different workspace. principalInA only has scopeA.
    const result = enforce(principalInA, "network.request", deploymentC, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("CAPABILITY_NOT_IN_SCOPE")
  })

  test("(n) project-level scope check: principal in org-1/proj-A cannot act in org-1/proj-B", () => {
    // Same org and workspace, different project. principalProjA only has scopeProjA.
    const result = enforce(principalProjA, "network.request", deploymentProjB, "REVIEWED_EXTENSION", signedNetworkRE, { now: clock })
    expect(result.kind).toBe("deny")
    if (result.kind !== "deny") return
    expect(result.reason).toBe("CAPABILITY_NOT_IN_SCOPE")
  })
})
