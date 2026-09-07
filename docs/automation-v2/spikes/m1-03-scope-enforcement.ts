/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M1-03 throwaway scope-enforcement spike — Plan V2.3.1 §195, §44-46
 * + ADR-020 + THREAT_MODEL TM-T-01, TM-T-02.
 *
 * Explicitly non-production. No stable persisted format. No public
 * compatibility promise. Discarded/migrated after the adapters pick up
 * the `ensureScope` helper in their real implementations.
 *
 * What this does: it validates that 5 different adapter layers refuse
 * cross-tenant operations using the OwnershipScope triple defined in
 * `packages/contracts/src/scope.ts` (ADR-020). The pattern comes from
 * the secret-broker's `ensureScope` (lines 230-236 in
 * `packages/secret-broker/src/index.ts`) and is documented in the
 * EVIDENCE file as a reusable adapter-side helper.
 *
 * Tests (plan §5.3):
 *   1. secret-broker.resolveCredential (existing 4 multi-tenant tests,
 *      re-run for evidence — TenantMismatchError)
 *   2. ArtifactStore stub (15 LOC) — `create({...ownershipScope: A},
 *      principalScopeB)` throws
 *   3. CapabilityRegistry stub — `check(capability, principalA, scopeB)`
 *      returns `{allow: false, reason: "SCOPE_CHAIN_BROKEN"}`
 *   4. audit.emit stub — throws on cross-tenant emit
 *   5. 8 cross-multi-tenant vectors on the 3-field OwnershipScope
 *      (org-A-vs-org-B, project-1-vs-project-2, ws-1-vs-ws-2, missing
 *      fields, empty workspaceId, etc.)
 *
 * Acceptance: 5 PASS, 0 PARTIAL, 0 FAIL, 0 MISSING.
 */

import { OwnershipScopeSchema, type OwnershipScope } from "@unifia/contracts"
import {
  createInMemoryBroker,
  TenantMismatchError,
  type CredentialRef,
  type OwnershipScope as BrokerScope,
} from "@unifia/secret-broker"

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "MISSING"

interface Result {
  name: string
  verdict: Verdict
  evidence: string
}

const results: Result[] = []

function record(name: string, verdict: Verdict, evidence: string): void {
  results.push({ name, verdict, evidence })
  console.log(`[${verdict.padEnd(7)}] ${name} — ${evidence}`)
}

// ---------------------------------------------------------------------------
// Canonical scopes used across all 5 tests. The 3-field shape comes from
// `packages/contracts/src/scope.ts:29-33` (ADR-020): organizationId is
// mandatory, projectId is optional, workspaceId is the leaf.
//
//   SCOPE_A         = org-A, no project, ws-1     (flat org pool)
//   SCOPE_A_PROJ    = org-A, project p-1, ws-1    (project subdivision)
//   SCOPE_B         = org-B, no project, ws-2     (different org, cross-tenant)
//   SCOPE_A_WS2     = org-A, no project, ws-2     (same org, different workspace)
//   SCOPE_A_PROJ2   = org-A, project p-2, ws-1    (same org, different project)
// ---------------------------------------------------------------------------
const SCOPE_A: OwnershipScope = { organizationId: "org-A", workspaceId: "ws-1" }
const SCOPE_A_PROJ: OwnershipScope = { organizationId: "org-A", projectId: "p-1", workspaceId: "ws-1" }
const SCOPE_B: OwnershipScope = { organizationId: "org-B", workspaceId: "ws-2" }
const SCOPE_A_WS2: OwnershipScope = { organizationId: "org-A", workspaceId: "ws-2" }
const SCOPE_A_PROJ2: OwnershipScope = { organizationId: "org-A", projectId: "p-2", workspaceId: "ws-1" }

// Broker's 2-field shape (legacy local type, ADR-010 scaffold).
const BROKER_A: BrokerScope = { organizationId: "org-A", workspaceId: "ws-1" }
const BROKER_B: BrokerScope = { organizationId: "org-B", workspaceId: "ws-2" }

// ---------------------------------------------------------------------------
// Reusable adapter-side helper — the recommended `ensureScope` pattern,
// evolved from `packages/secret-broker/src/index.ts:230-236` to honour
// the 3-field OwnershipScope (orgId + projectId? + workspaceId).
//
//   - Strict on orgId and workspaceId (mandatory, must match).
//   - Strict on projectId: if either side declares a project, both must
//     match. This prevents the "project drift" edge case where the same
//     org has two parallel projects and a ref from project-1 is read
//     from a project-2 principal (TM-T-01).
// ---------------------------------------------------------------------------
function ensureScope(actual: OwnershipScope, requested: OwnershipScope, what: string): void {
  if (actual.organizationId !== requested.organizationId) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: org ${actual.organizationId} != ${requested.organizationId}`,
    )
  }
  if (actual.workspaceId !== requested.workspaceId) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: workspace ${actual.workspaceId} != ${requested.workspaceId}`,
    )
  }
  const aProj = actual.projectId ?? ""
  const rProj = requested.projectId ?? ""
  if (aProj !== rProj) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: project '${aProj}' != '${rProj}'`,
    )
  }
}

// ---------------------------------------------------------------------------
// Stub adapters (each <30 LOC, the spike is throwaway — see EVIDENCE §3).
// ---------------------------------------------------------------------------

// --- Test 2: ArtifactStore stub ---
interface ArtifactInput {
  bytes: Uint8Array
  mediaType: string
  ownershipScope: OwnershipScope
}
interface ArtifactStore {
  create(input: ArtifactInput, principalScope: OwnershipScope): { artifactId: string }
}
function createStubArtifactStore(): ArtifactStore {
  return {
    create(input, principalScope) {
      ensureScope(input.ownershipScope, principalScope, `artifact-store.create(${input.mediaType})`)
      return { artifactId: `art-${input.mediaType}-${Date.now()}` }
    },
  }
}

// --- Test 3: CapabilityRegistry stub ---
type CapabilityDecision =
  | { allow: true; grant: { capability: string; expiresAt: number } }
  | { allow: false; reason: "SCOPE_CHAIN_BROKEN" | "CAPABILITY_NOT_IN_SCOPE" | "MANIFEST_UNSIGNED" | "TRUSTCLASS_TOO_LOW" }
interface CapabilityRegistry {
  check(capability: string, principalScope: OwnershipScope, requestedScope: OwnershipScope): CapabilityDecision
}
function createStubCapabilityRegistry(): CapabilityRegistry {
  return {
    check(capability, principalScope, requestedScope) {
      try {
        ensureScope(principalScope, requestedScope, `capability-registry.check(${capability})`)
      } catch {
        return { allow: false, reason: "SCOPE_CHAIN_BROKEN" }
      }
      return { allow: true, grant: { capability, expiresAt: Date.now() + 5 * 60_000 } }
    },
  }
}

// --- Test 4: audit.emit stub ---
interface AuditSink {
  emit(event: { scope: OwnershipScope; actor: string; action: string }, principalScope: OwnershipScope): void
}
function createStubAuditSink(): AuditSink {
  return {
    emit(event, principalScope) {
      ensureScope(event.scope, principalScope, `audit.emit(${event.action})`)
    },
  }
}

// ---------------------------------------------------------------------------
// 5 tests.
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  // ===========================================================================
  // Test 1 — secret-broker.resolveCredential cross-tenant (TM-T-02, ADR-010,
  // ADR-020, plan §226). Re-runs the existing 4 multi-tenant tests from
  // `packages/secret-broker/test/secret-broker.test.ts:133-167` to gather
  // evidence that the production path still rejects cross-tenant access.
  // ===========================================================================
  {
    const testName = "secret-broker.resolveCredential rejects cross-tenant (4 vectors)"
    const broker = createInMemoryBroker(new Uint8Array(32).fill(0x42))
    const refB: CredentialRef = { kind: "credential", credentialId: "cred-b", scope: BROKER_B }
    let allPass = true
    const lines: string[] = []
    try {
      // --- vector 1: A tries to resolve B's credential ---
      broker.storeCredential(refB, "B's secret", "credential-material")
      try {
        await broker.resolveCredential(refB, BROKER_A)
        allPass = false
        lines.push("v1 did not throw")
      } catch (e) {
        if (e instanceof TenantMismatchError) {
          lines.push("v1 TenantMismatchError OK")
        } else {
          allPass = false
          lines.push(`v1 wrong error: ${e instanceof Error ? e.constructor.name : "?"}`)
        }
      }
      // --- vector 2: same id in two tenants does not collide (both PASS) ---
      await broker.storeCredential({ kind: "credential", credentialId: "shared-id", scope: BROKER_A }, "A's value", "credential-material")
      await broker.storeCredential({ kind: "credential", credentialId: "shared-id", scope: BROKER_B }, "B's value", "credential-material")
      const aValue = new TextDecoder("utf-8", { fatal: true }).decode(
        (await broker.resolveCredential({ kind: "credential", credentialId: "shared-id", scope: BROKER_A }, BROKER_A)) as Uint8Array,
      )
      const bValue = new TextDecoder("utf-8", { fatal: true }).decode(
        (await broker.resolveCredential({ kind: "credential", credentialId: "shared-id", scope: BROKER_B }, BROKER_B)) as Uint8Array,
      )
      if (aValue !== "A's value" || bValue !== "B's value") {
        allPass = false
        lines.push(`v2 values wrong: A=${aValue} B=${bValue}`)
      } else {
        lines.push("v2 same-id isolation OK")
      }
      // --- vector 3: mismatched workspace on same org ---
      const refA: CredentialRef = { kind: "credential", credentialId: "cred-1", scope: BROKER_A }
      await broker.storeCredential(refA, "value", "credential-material")
      try {
        await broker.resolveCredential(refA, { organizationId: "org-A", workspaceId: "ws-2" })
        allPass = false
        lines.push("v3 did not throw on workspace mismatch")
      } catch (e) {
        if (e instanceof TenantMismatchError) lines.push("v3 workspace mismatch TenantMismatchError OK")
        else {
          allPass = false
          lines.push(`v3 wrong error: ${e instanceof Error ? e.constructor.name : "?"}`)
        }
      }
      // --- vector 4: oauth + browser profile are also scope-isolated ---
      const oauthB = { kind: "oauth" as const, connectionId: "gh-b", scope: BROKER_B }
      await broker.storeOAuthConnection(oauthB, { accessToken: "x", expiresAt: 0, scopes: [] }, "oauth-token")
      try {
        await broker.resolveOAuthConnection(oauthB, BROKER_A)
        allPass = false
        lines.push("v4 oauth did not throw")
      } catch (e) {
        if (e instanceof TenantMismatchError) lines.push("v4 oauth TenantMismatchError OK")
        else {
          allPass = false
          lines.push(`v4 oauth wrong error: ${e instanceof Error ? e.constructor.name : "?"}`)
        }
      }
    } catch (e) {
      allPass = false
      lines.push(`unexpected throw: ${e instanceof Error ? e.message : "?"}`)
    }
    record(testName, allPass ? "PASS" : "FAIL", `${lines.length} vectors, ${lines.filter((l) => l.includes("OK")).length} OK — ${lines.join("; ")}`)
  }

  // ===========================================================================
  // Test 2 — ArtifactStore stub rejects cross-tenant create (TM-T-01, ADR-005,
  // ADR-020, plan §71).
  // ===========================================================================
  {
    const testName = "ArtifactStore stub rejects cross-tenant create"
    const store = createStubArtifactStore()
    let allPass = true
    const lines: string[] = []
    // vector 1: A creates with principal A — should pass
    try {
      store.create({ bytes: new Uint8Array([1, 2, 3]), mediaType: "text/plain", ownershipScope: SCOPE_A }, SCOPE_A)
      lines.push("v1 self-access OK")
    } catch (e) {
      allPass = false
      lines.push(`v1 self-access threw: ${e instanceof Error ? e.message : "?"}`)
    }
    // vector 2: artifact owned by A, principal is B — must throw
    try {
      store.create({ bytes: new Uint8Array([1, 2, 3]), mediaType: "text/plain", ownershipScope: SCOPE_A }, SCOPE_B)
      allPass = false
      lines.push("v2 cross-tenant did NOT throw")
    } catch (e) {
      if (e instanceof TenantMismatchError) lines.push("v2 cross-tenant TenantMismatchError OK")
      else {
        allPass = false
        lines.push(`v2 wrong error: ${e instanceof Error ? e.constructor.name : "?"}`)
      }
    }
    // vector 3: project drift — artifact in p-1, principal in p-2 — must throw
    try {
      store.create({ bytes: new Uint8Array([1, 2, 3]), mediaType: "text/plain", ownershipScope: SCOPE_A_PROJ }, SCOPE_A_PROJ2)
      allPass = false
      lines.push("v3 project drift did NOT throw")
    } catch (e) {
      if (e instanceof TenantMismatchError) lines.push("v3 project drift TenantMismatchError OK")
      else {
        allPass = false
        lines.push(`v3 wrong error: ${e instanceof Error ? e.constructor.name : "?"}`)
      }
    }
    record(testName, allPass ? "PASS" : "FAIL", `${lines.length} vectors — ${lines.join("; ")}`)
  }

  // ===========================================================================
  // Test 3 — CapabilityRegistry.check rejects cross-tenant (TM-T-01, TM-T-02,
  // ADR-002 §114, plan §5.3 C-M1-04 acceptance (c)). Returns a structured
  // {allow: false, reason: "SCOPE_CHAIN_BROKEN"} decision, not a throw,
  // because the call site (workflow kernel) branches on the decision.
  // ===========================================================================
  {
    const testName = "CapabilityRegistry stub returns SCOPE_CHAIN_BROKEN on cross-tenant"
    const reg = createStubCapabilityRegistry()
    let allPass = true
    const lines: string[] = []
    // vector 1: same scope — allow:true
    const ok = reg.check("network.request", SCOPE_A, SCOPE_A)
    if (ok.allow) lines.push("v1 same-scope allow:true OK")
    else {
      allPass = false
      lines.push(`v1 same-scope denied: ${ok.reason}`)
    }
    // vector 2: cross-org — SCOPE_CHAIN_BROKEN
    const deny = reg.check("network.request", SCOPE_A, SCOPE_B)
    if (!deny.allow && deny.reason === "SCOPE_CHAIN_BROKEN") lines.push("v2 cross-org SCOPE_CHAIN_BROKEN OK")
    else {
      allPass = false
      lines.push(`v2 wrong decision: ${JSON.stringify(deny)}`)
    }
    // vector 3: cross-workspace — SCOPE_CHAIN_BROKEN
    const denyWs = reg.check("network.request", SCOPE_A, SCOPE_A_WS2)
    if (!denyWs.allow && denyWs.reason === "SCOPE_CHAIN_BROKEN") lines.push("v3 cross-workspace SCOPE_CHAIN_BROKEN OK")
    else {
      allPass = false
      lines.push(`v3 wrong decision: ${JSON.stringify(denyWs)}`)
    }
    // vector 4: project drift — SCOPE_CHAIN_BROKEN
    const denyProj = reg.check("network.request", SCOPE_A_PROJ, SCOPE_A_PROJ2)
    if (!denyProj.allow && denyProj.reason === "SCOPE_CHAIN_BROKEN") lines.push("v4 project-drift SCOPE_CHAIN_BROKEN OK")
    else {
      allPass = false
      lines.push(`v4 wrong decision: ${JSON.stringify(denyProj)}`)
    }
    record(testName, allPass ? "PASS" : "FAIL", `${lines.length} vectors — ${lines.join("; ")}`)
  }

  // ===========================================================================
  // Test 4 — audit.emit stub rejects cross-tenant writes. The audit log
  // is the durable record of who did what; a cross-tenant audit row
  // would forge accountability (TM-T-01 information disclosure).
  // ===========================================================================
  {
    const testName = "audit.emit stub rejects cross-tenant"
    const audit = createStubAuditSink()
    let allPass = true
    const lines: string[] = []
    // vector 1: self-emit OK
    try {
      audit.emit({ scope: SCOPE_A, actor: "user-1", action: "workflow.start" }, SCOPE_A)
      lines.push("v1 self-emit OK")
    } catch (e) {
      allPass = false
      lines.push(`v1 self-emit threw: ${e instanceof Error ? e.message : "?"}`)
    }
    // vector 2: cross-org emit throws
    try {
      audit.emit({ scope: SCOPE_A, actor: "user-1", action: "credential.read" }, SCOPE_B)
      allPass = false
      lines.push("v2 cross-org did NOT throw")
    } catch (e) {
      if (e instanceof TenantMismatchError) lines.push("v2 cross-org TenantMismatchError OK")
      else {
        allPass = false
        lines.push(`v2 wrong error: ${e instanceof Error ? e.constructor.name : "?"}`)
      }
    }
    // vector 3: cross-workspace emit throws
    try {
      audit.emit({ scope: SCOPE_A, actor: "user-1", action: "artifact.create" }, SCOPE_A_WS2)
      allPass = false
      lines.push("v3 cross-workspace did NOT throw")
    } catch (e) {
      if (e instanceof TenantMismatchError) lines.push("v3 cross-workspace TenantMismatchError OK")
      else {
        allPass = false
        lines.push(`v3 wrong error: ${e instanceof Error ? e.constructor.name : "?"}`)
      }
    }
    record(testName, allPass ? "PASS" : "FAIL", `${lines.length} vectors — ${lines.join("; ")}`)
  }

  // ===========================================================================
  // Test 5 — 8 cross-multi-tenant vectors exercising the 3-field
  // OwnershipScope (orgId + projectId? + workspaceId). This is the
  // "structural" coverage called for in plan §226 (ADR-020 C-4).
  //
  //   v1: A vs B               (different org)               -> REJECT
  //   v2: A vs A_WS2           (same org, diff workspace)    -> REJECT
  //   v3: A_PROJ vs A_PROJ2    (same org, diff project)      -> REJECT
  //   v4: A vs A_PROJ          (no project vs project)       -> REJECT
  //   v5: A_PROJ vs A          (project vs no project)       -> REJECT
  //   v6: A vs A               (identical)                   -> ACCEPT
  //   v7: empty workspaceId    (invalid field)               -> REJECT
  //   v8: missing organizationId (invalid field)             -> REJECT
  // ===========================================================================
  {
    const testName = "8 cross-multi-tenant vectors on 3-field OwnershipScope"
    type Vec = { name: string; actual: OwnershipScope; requested: OwnershipScope; expectThrow: boolean }
    const vectors: Vec[] = [
      { name: "v1 A vs B (different org)", actual: SCOPE_A, requested: SCOPE_B, expectThrow: true },
      { name: "v2 A vs A_WS2 (same org, diff ws)", actual: SCOPE_A, requested: SCOPE_A_WS2, expectThrow: true },
      { name: "v3 A_PROJ vs A_PROJ2 (diff project)", actual: SCOPE_A_PROJ, requested: SCOPE_A_PROJ2, expectThrow: true },
      { name: "v4 A vs A_PROJ (no project vs project)", actual: SCOPE_A, requested: SCOPE_A_PROJ, expectThrow: true },
      { name: "v5 A_PROJ vs A (project vs no project)", actual: SCOPE_A_PROJ, requested: SCOPE_A, expectThrow: true },
      { name: "v6 A vs A (identical)", actual: SCOPE_A, requested: SCOPE_A, expectThrow: false },
      { name: "v7 empty workspaceId", actual: SCOPE_A, requested: { organizationId: "org-A", workspaceId: "" }, expectThrow: true },
      { name: "v8 missing organizationId", actual: SCOPE_A, requested: { organizationId: "", workspaceId: "ws-1" }, expectThrow: true },
    ]
    let allPass = true
    const lines: string[] = []
    for (const v of vectors) {
      try {
        ensureScope(v.actual, v.requested, v.name)
        if (v.expectThrow) {
          allPass = false
          lines.push(`${v.name} FAIL (expected throw, none)`)
        } else {
          lines.push(`${v.name} OK (no throw, as expected)`)
        }
      } catch (e) {
        if (v.expectThrow) {
          if (e instanceof TenantMismatchError) lines.push(`${v.name} OK (TenantMismatchError)`)
          else {
            allPass = false
            lines.push(`${v.name} FAIL (wrong error: ${e instanceof Error ? e.constructor.name : "?"})`)
          }
        } else {
          allPass = false
          lines.push(`${v.name} FAIL (unexpected throw: ${e instanceof Error ? e.message : "?"})`)
        }
      }
    }
    record(testName, allPass ? "PASS" : "FAIL", `${vectors.length} vectors, ${lines.filter((l) => l.includes("OK")).length} OK — ${lines.join("; ")}`)
  }
}

runTests().then(() => {
const pass = results.filter((r) => r.verdict === "PASS").length
const partial = results.filter((r) => r.verdict === "PARTIAL").length
const fail = results.filter((r) => r.verdict === "FAIL").length
const missing = results.filter((r) => r.verdict === "MISSING").length

console.log("")
console.log("M1-03 spike summary")
console.log("===================")
console.log(`PASS     ${pass}`)
console.log(`PARTIAL  ${partial}`)
console.log(`FAIL     ${fail}`)
console.log(`MISSING  ${missing}`)
console.log("")

if (fail === 0 && partial === 0 && missing === 0 && pass === 5) {
  console.log("Verdict: 5/5 PASS — every adapter layer rejects cross-tenant access.")
  console.log("The `ensureScope` pattern from `packages/secret-broker/src/index.ts:230-236`")
  console.log("extends cleanly to the 3-field OwnershipScope (ADR-020) and is a")
  console.log("reusable adapter-side helper. See M1-03-EVIDENCE.md for the pattern")
  console.log("documentation and the rejection-reason taxonomy.")
} else {
  console.log("Verdict: at least one adapter accepts a cross-tenant operation.")
  console.log("Review the FAIL/PARTIAL/MISSING evidence above before promoting")
  console.log("this spike to a durable M1 contract (plan §5.3 C-M1-04).")
}

// Smoke-test: confirm the Zod schema accepts a 3-field scope and rejects garbage.
{
  const ok = OwnershipScopeSchema.safeParse(SCOPE_A_PROJ)
  const garbage = OwnershipScopeSchema.safeParse({ organizationId: "org-A" })
  if (ok.success && !garbage.success) {
    console.log("")
    console.log(`Zod smoke: OwnershipScopeSchema accepts ${JSON.stringify(SCOPE_A_PROJ)}, rejects {organizationId only}.`)
  } else {
    console.log("")
    console.log(`Zod smoke FAILED: ok=${ok.success} garbage=${garbage.success}`)
  }
}
})
