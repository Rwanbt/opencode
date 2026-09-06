/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M1-05 throwaway capability-enforcer spike — Plan V2.3.1 §114, §195 + ADR-002 + ADR-020.
 *
 * Explicitly non-production. No stable persisted format. No public
 * compatibility promise. Discarded/migrated after the production
 * `@unifia/capability-runtime/src/enforcer.ts` is written.
 *
 * What this does: it proves the *design* of the Capability Authority
 * enforcer (C-AR-01, multi-review Medium finding) by exercising the
 * five refusal paths that the current verifier-only
 * `@unifia/capability-runtime/` cannot express.
 *
 * M0-06 spike established that `@unifia/capability-runtime/src/index.ts`
 * is a *verifier* (Ed25519 sign/verify) but not an *enforcer* (it
 * cannot refuse an execution). This spike adds the enforcer on top of
 * the verifier, and validates the contract before production code is
 * touched.
 *
 * Vectors (M1 plan §5.5):
 *   1. Happy path    — principal has capability, scope covered, trust OK
 *   2. Unsigned manifest → MANIFEST_UNSIGNED
 *   3. TrustClass too low → TRUSTCLASS_TOO_LOW
 *   4. Capability not in principal scope → CAPABILITY_NOT_IN_SCOPE (TM-T-01)
 *   5. Scope chain broken → SCOPE_CHAIN_BROKEN (TM-T-02)
 *
 * Order of checks (per M1 plan §3.8 + §5.5):
 *   (1) manifest signed  → MANIFEST_UNSIGNED
 *   (2) trustClass sufficient (per CAPABILITY_MIN_TRUST)  → TRUSTCLASS_TOO_LOW
 *   (3) principal has the capability IN the requested ownership scope
 *       → CAPABILITY_NOT_IN_SCOPE
 *   (4) principal.scopes[0] === requestedScope.ownershipScope
 *       → SCOPE_CHAIN_BROKEN
 *   (5) grant { capability, scope, grantedAt, expiresAt, bindingDigest }
 */

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto"
import { z } from "zod"

// ============================================================================
// Section A — Type definitions (design proposal, liftable to @unifia/contracts)
// ============================================================================

/**
 * 4 trust levels, ordered high → low. A capability demands a *minimum*
 * trust class; if the principal's trust class is below the floor, the
 * enforcer refuses with `TRUSTCLASS_TOO_LOW`.
 *
 * Why 4 (not 3, not 5): ADR-002 (manifest signed) + ADR-008 (TrustClass
 * in WorkerId) + ADR-020 (scope). The 4 levels separate the "compiled
 * into the runtime" (CORE) from the "downloaded from a marketplace
 * with code review" (REVIEWED_EXTENSION) from the "free-form
 * untrusted code" (UNTRUSTED_THIRD_PARTY) and the "user-pasted
 * runtime expression" (UNTRUSTED_RUNTIME). Each step down adds
 * progressively more isolation guarantees at the substrate level
 * (Native → WASM → container → gVisor).
 */
export const TrustClassSchema = z.enum([
  "CORE",
  "REVIEWED_EXTENSION",
  "UNTRUSTED_THIRD_PARTY",
  "UNTRUSTED_RUNTIME",
])
export type TrustClass = z.infer<typeof TrustClassSchema>

/** Numeric rank so we can compare "is trustClass >= minTrust". */
const TRUST_RANK: Record<TrustClass, number> = {
  CORE: 3,
  REVIEWED_EXTENSION: 2,
  UNTRUSTED_THIRD_PARTY: 1,
  UNTRUSTED_RUNTIME: 0,
}

/**
 * 6 representative capabilities (out of the 20 P3_CAPABILITIES from
 * M0-06) and the minimum trust class they require. The other 14
 * capabilities follow the same pattern in production.
 *
 * Selection rationale (security-critical capabilities spanning the
 * full trust ladder):
 *   - `workflow.run`        ≥ REVIEWED_EXTENSION  (auto-trigger)
 *   - `network.request`     ≥ REVIEWED_EXTENSION  (SSRF, M0-05)
 *   - `secret.read`         ≥ CORE                (ADR-010)
 *   - `terminal.run`        ≥ CORE                (shell, ADR-019)
 *   - `package.install`     ≥ CORE                (supply chain, C-AR-02)
 *   - `desktop.control`     ≥ CORE                (input injection, ADR-014)
 */
const CAPABILITY_MIN_TRUST: Record<string, TrustClass> = {
  "workflow.run": "REVIEWED_EXTENSION",
  "network.request": "REVIEWED_EXTENSION",
  "secret.read": "CORE",
  "terminal.run": "CORE",
  "package.install": "CORE",
  "desktop.control": "CORE",
}

/** Minimal WorkerId shape (subset of @unifia/contracts WorkerIdSchema). */
const WorkerIdSchema = z.object({
  workerId: z.string(),
  identityProof: z.string(),
  version: z.string(),
  platform: z.string(),
  capabilities: z.array(z.string()).readonly(),
  executionProfiles: z.array(z.string()).readonly(),
  resourceClass: z.string(),
})
type WorkerId = z.infer<typeof WorkerIdSchema>

/** Minimal OwnershipScope (subset of @unifia/contracts OwnershipScopeSchema). */
const OwnershipScopeSchema = z.object({
  organizationId: z.string(),
  projectId: z.string().optional(),
  workspaceId: z.string(),
})
type OwnershipScope = z.infer<typeof OwnershipScopeSchema>

/** Minimal DeploymentScope (subset of @unifia/contracts DeploymentScopeSchema). */
const DeploymentScopeSchema = z.object({
  ownershipScope: OwnershipScopeSchema,
  environmentId: z.string(),
})
type DeploymentScope = z.infer<typeof DeploymentScopeSchema>

/**
 * PrincipalIdentity — design proposal.
 *
 * The current `@unifia/contracts/src/identity.ts` `WorkerIdSchema` does
 * NOT carry the principal's authorized ownership scopes. For the
 * enforcer to make an authorization decision, it needs to know *which
 * workspaces this worker is allowed to operate in*. The proposal
 * (to be added in C-M1-08 production code) is to extend WorkerId with
 * a `scopes: readonly OwnershipScope[]` field, where `scopes[0]` is
 * the "primary" scope (the home workspace) and additional entries
 * are delegations.
 *
 * This is the **single finding** the spike produces for the contracts
 * team: add `scopes: readonly OwnershipScope[]` to `WorkerIdSchema`.
 */
const PrincipalIdentitySchema = WorkerIdSchema.extend({
  scopes: z.array(OwnershipScopeSchema).readonly(),
})
type PrincipalIdentity = z.infer<typeof PrincipalIdentitySchema>

/** Signed manifest — the principal's claim to use a capability. */
interface SignedManifest {
  /** The capability being claimed. */
  capability: string
  /** The trust class the manifest asserts for itself. */
  trustClass: TrustClass
  /** Ed25519 signature of canonical(payload), base64. */
  signature?: string
  /** Canonical payload (whatever the production canonicalization decides). */
  payload: string
}

/**
 * Grant — the receipt returned on a successful enforcement.
 *
 * `bindingDigest` is a SHA-256 over (principal, capability, scope,
 * grantedAt) so that the grant is bound to a specific invocation and
 * cannot be replayed for a different (principal, capability, scope)
 * triple. Plan §114 calls this "audit binding".
 */
const GrantSchema = z.object({
  capability: z.string(),
  scope: DeploymentScopeSchema,
  grantedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  bindingDigest: z.string(),
})
type Grant = z.infer<typeof GrantSchema>

/** Denial reason — closed enum (4 values, per M1 plan §5.5). */
export const DenialReasonSchema = z.enum([
  "MANIFEST_UNSIGNED",
  "TRUSTCLASS_TOO_LOW",
  "CAPABILITY_NOT_IN_SCOPE",
  "SCOPE_CHAIN_BROKEN",
])
export type DenialReason = z.infer<typeof DenialReasonSchema>

/**
 * EnforcementResult — the liftable contract.
 *
 * Production form (proposed): `z.discriminatedUnion("kind", [GrantSchema, DenialSchema])`.
 * Spike form (this file): `{allow: true, grant: ...} | {allow: false, reason: ...}`.
 *
 * The spike form is the literal test contract from M1 plan §3.8; the
 * production form is a refactor that adds a discriminator for
 * exhaustive `switch` in callers. See M1-05-EVIDENCE.md §4 for the
 * migration sketch.
 */
const EnforcementResultSchema = z.union([
  z.object({ allow: z.literal(true), grant: GrantSchema }),
  z.object({ allow: z.literal(false), reason: DenialReasonSchema, detail: z.string().optional() }),
])
export type EnforcementResult = z.infer<typeof EnforcementResultSchema>

// ============================================================================
// Section B — Enforcer implementation (throwaway)
// ============================================================================

/** Default grant TTL — 5 minutes, per M1 plan §3.8 (f). */
const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1_000

/** Optional clock injection for testing. */
type Clock = () => number
const defaultClock: Clock = () => Date.now()

/**
 * enforce(principal, capability, requestedScope, trustClass, manifest) — the enforcer.
 *
 * Order of checks (per M1 plan §3.8):
 *   (1) manifest signed                  → MANIFEST_UNSIGNED
 *   (2) trustClass >= capability min     → TRUSTCLASS_TOO_LOW
 *   (3) principal.capabilities ⊇ {capability}
 *       AND principal.scopes ⊇ requestedScope.ownershipScope
 *                                         → CAPABILITY_NOT_IN_SCOPE
 *   (4) principal.scopes[0] === requestedScope.ownershipScope
 *                                         → SCOPE_CHAIN_BROKEN
 *   (5) grant (TTL 5 min, binding digest)
 */
function enforce(
  principal: PrincipalIdentity,
  capability: string,
  requestedScope: DeploymentScope,
  trustClass: TrustClass,
  manifest: SignedManifest,
  options: { now?: Clock; ttlMs?: number } = {},
): EnforcementResult {
  const now = options.now ?? defaultClock
  const ttlMs = options.ttlMs ?? DEFAULT_GRANT_TTL_MS

  // (1) Manifest must be signed.
  if (manifest.signature === undefined || manifest.signature.length === 0) {
    return { allow: false, reason: "MANIFEST_UNSIGNED", detail: "manifest.signature is missing or empty" }
  }

  // (2) TrustClass must meet the capability's minimum.
  const minTrust = CAPABILITY_MIN_TRUST[capability]
  if (minTrust === undefined) {
    return { allow: false, reason: "TRUSTCLASS_TOO_LOW", detail: `capability "${capability}" is not in the trust matrix (unknown capability)` }
  }
  if (TRUST_RANK[trustClass] < TRUST_RANK[minTrust]) {
    return {
      allow: false,
      reason: "TRUSTCLASS_TOO_LOW",
      detail: `capability "${capability}" requires >= ${minTrust}, got ${trustClass}`,
    }
  }

  // (3) Principal must have the capability AND own the requested scope.
  if (!principal.capabilities.includes(capability)) {
    return {
      allow: false,
      reason: "CAPABILITY_NOT_IN_SCOPE",
      detail: `principal "${principal.workerId}" does not hold capability "${capability}"`,
    }
  }
  const scopeCovered = principal.scopes.some(
    (s) =>
      s.organizationId === requestedScope.ownershipScope.organizationId &&
      s.workspaceId === requestedScope.ownershipScope.workspaceId &&
      (s.projectId ?? null) === (requestedScope.ownershipScope.projectId ?? null),
  )
  if (!scopeCovered) {
    return {
      allow: false,
      reason: "CAPABILITY_NOT_IN_SCOPE",
      detail: `requested scope ${formatScope(requestedScope.ownershipScope)} is not in principal.scopes`,
    }
  }

  // (4) Scope chain — principal.scopes[0] is the primary scope;
  //     requested deployment must be owned by that primary scope.
  //     (This is the structural invariant that TM-T-02 protects.)
  const primary = principal.scopes[0]
  if (
    primary.organizationId !== requestedScope.ownershipScope.organizationId ||
    primary.workspaceId !== requestedScope.ownershipScope.workspaceId ||
    (primary.projectId ?? null) !== (requestedScope.ownershipScope.projectId ?? null)
  ) {
    return {
      allow: false,
      reason: "SCOPE_CHAIN_BROKEN",
      detail: `principal.scopes[0] is ${formatScope(primary)}, requested deployment is ${formatScope(requestedScope.ownershipScope)}`,
    }
  }

  // (5) Allow — mint a short-lived grant.
  const grantedAt = now()
  const expiresAt = grantedAt + ttlMs
  const bindingDigest = createHash("sha256")
    .update(`${principal.workerId}|${capability}|${requestedScope.ownershipScope.organizationId}/${requestedScope.ownershipScope.workspaceId}|${grantedAt}`)
    .digest("hex")
  const grant: Grant = {
    capability,
    scope: requestedScope,
    grantedAt,
    expiresAt,
    bindingDigest,
  }
  return { allow: true, grant }
}

function formatScope(s: OwnershipScope): string {
  return `${s.organizationId}/${s.projectId ?? "_"}/${s.workspaceId}`
}

// ============================================================================
// Section C — Test harness
// ============================================================================

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "MISSING"

/** Plan §5.5 5-test distribution (counted in the summary). */
const planResults: { name: string; verdict: Verdict; evidence: string }[] = []
/** Supplementary output (not counted in the §5.5 distribution). */
const supplementary: { name: string; verdict: Verdict; evidence: string }[] = []

function record(name: string, verdict: Verdict, evidence: string, supplementaryOnly = false): void {
  const bucket = supplementaryOnly ? supplementary : planResults
  bucket.push({ name, verdict, evidence })
  console.log(`[${verdict.padEnd(7)}] ${name} — ${evidence}`)
}

/** Sign a manifest payload with the test private key (Ed25519). */
function signManifest(payload: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]): string {
  return edSign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64")
}

/** Verify a manifest signature (used only for sanity, the enforcer trusts the caller). */
function verifyManifestSignature(payload: string, signature: string, publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]): boolean {
  try {
    return edVerify(null, Buffer.from(payload, "utf8"), publicKey, Buffer.from(signature, "base64"))
  } catch {
    return false
  }
}

function runTests() {
  // ----- Shared fixtures -----
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")

  const scopeA: OwnershipScope = { organizationId: "org-acme", projectId: "proj-1", workspaceId: "ws-alpha" }
  const scopeB: OwnershipScope = { organizationId: "org-acme", projectId: "proj-1", workspaceId: "ws-beta" }
  const scopeOtherOrg: OwnershipScope = { organizationId: "org-evil", projectId: "proj-1", workspaceId: "ws-alpha" }
  const deploymentA: DeploymentScope = { ownershipScope: scopeA, environmentId: "prod" }
  const deploymentB: DeploymentScope = { ownershipScope: scopeB, environmentId: "prod" }
  const deploymentOtherOrg: DeploymentScope = { ownershipScope: scopeOtherOrg, environmentId: "prod" }

  const principalInA: PrincipalIdentity = {
    workerId: "w-1",
    identityProof: "proof-w-1",
    version: "1",
    platform: "linux-x64",
    capabilities: ["workspace.read", "network.request", "workflow.run"],
    executionProfiles: ["docker"],
    resourceClass: "medium",
    scopes: [scopeA],
  }
  // principalInB has scopeB in its scopes[] but scopes[0] = scopeA (primary), so a request
  // for scopeB will hit the SCOPE_CHAIN_BROKEN path (test 5).
  const principalInB: PrincipalIdentity = {
    workerId: "w-2",
    identityProof: "proof-w-2",
    version: "1",
    platform: "linux-x64",
    capabilities: ["workspace.read", "network.request", "workflow.run"],
    executionProfiles: ["docker"],
    resourceClass: "medium",
    scopes: [scopeA, scopeB],
  }
  // principalFromOtherOrg: same capability, but its scope is org-evil (not org-acme).
  const principalFromOtherOrg: PrincipalIdentity = {
    workerId: "w-3",
    identityProof: "proof-w-3",
    version: "1",
    platform: "linux-x64",
    capabilities: ["network.request", "workflow.run"],
    executionProfiles: ["docker"],
    resourceClass: "medium",
    scopes: [scopeOtherOrg],
  }

  const manifestPayload = "unifia.capability-manifest.v1\nnetwork.request"
  const signedManifest: SignedManifest = {
    capability: "network.request",
    trustClass: "REVIEWED_EXTENSION",
    payload: manifestPayload,
    signature: signManifest(manifestPayload, privateKey),
  }

  // Sanity check the test fixture itself — if the signing round-trip
  // fails, every other test result is meaningless. M0-06 already
  // proved Ed25519 sign+verify, so a regression here would point to
  // a test harness bug.
  if (!verifyManifestSignature(manifestPayload, signedManifest.signature!, publicKey)) {
    record("Test harness — Ed25519 round-trip", "FAIL", "signature did not verify; aborting all tests")
    return
  }

  // Frozen clock for deterministic TTL checks.
  const FROZEN = 1_700_000_000_000
  const clock = () => FROZEN

  // -----------------------------------------------------------------
  // Test 1 — Happy path
  // -----------------------------------------------------------------
  {
    const result = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedManifest, { now: clock })
    const okAllow = result.allow === true
    const okGrant = okAllow && (result as { grant?: Grant }).grant !== undefined
    const okCapability = okGrant && (result as { grant: Grant }).grant.capability === "network.request"
    const okFuture = okGrant && (result as { grant: Grant }).grant.expiresAt > (result as { grant: Grant }).grant.grantedAt
    const okDigest = okGrant && /^[0-9a-f]{64}$/.test((result as { grant: Grant }).grant.bindingDigest)
    if (okAllow && okGrant && okCapability && okFuture && okDigest) {
      record("Test 1 — happy path (signed, REVIEWED_EXTENSION, scope match)", "PASS", "allow=true, grant.expiresAt > grantedAt, bindingDigest is 64 hex")
    } else {
      record("Test 1 — happy path", "FAIL", JSON.stringify(result))
    }
  }

  // -----------------------------------------------------------------
  // Test 2 — Unsigned manifest
  // -----------------------------------------------------------------
  {
    const unsigned: SignedManifest = { ...signedManifest, signature: undefined }
    const result = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", unsigned, { now: clock })
    if (!result.allow && result.reason === "MANIFEST_UNSIGNED") {
      record("Test 2 — unsigned manifest", "PASS", `deny reason=MANIFEST_UNSIGNED, detail="${result.detail ?? ""}"`)
    } else {
      record("Test 2 — unsigned manifest", "FAIL", JSON.stringify(result))
    }
  }

  // -----------------------------------------------------------------
  // Test 3 — TrustClass too low
  // -----------------------------------------------------------------
  {
    const lowTrustManifest: SignedManifest = { ...signedManifest, trustClass: "UNTRUSTED_THIRD_PARTY" }
    const result = enforce(principalInA, "network.request", deploymentA, "UNTRUSTED_THIRD_PARTY", lowTrustManifest, { now: clock })
    if (!result.allow && result.reason === "TRUSTCLASS_TOO_LOW") {
      record("Test 3 — trustClass too low (UNTRUSTED_THIRD_PARTY for network.request)", "PASS", `deny reason=TRUSTCLASS_TOO_LOW, detail="${result.detail ?? ""}"`)
    } else {
      record("Test 3 — trustClass too low", "FAIL", JSON.stringify(result))
    }
  }

  // -----------------------------------------------------------------
  // Test 4 — Capability not in principal scope (TM-T-01)
  //   principalFromOtherOrg has the capability, but its scopes[0]
  //   is org-evil/ws-alpha, which is not the requested scopeA
  //   (org-acme/ws-alpha).
  // -----------------------------------------------------------------
  {
    const result = enforce(principalFromOtherOrg, "network.request", deploymentA, "REVIEWED_EXTENSION", signedManifest, { now: clock })
    if (!result.allow && result.reason === "CAPABILITY_NOT_IN_SCOPE") {
      record("Test 4 — capability not in principal scope (TM-T-01)", "PASS", `deny reason=CAPABILITY_NOT_IN_SCOPE, detail="${result.detail ?? ""}"`)
    } else {
      record("Test 4 — capability not in principal scope (TM-T-01)", "FAIL", JSON.stringify(result))
    }
  }

  // -----------------------------------------------------------------
  // Test 5 — Scope chain broken (TM-T-02)
  //   principalInB has scopeB in its scopes[] (so check 3 passes),
  //   but scopes[0] = scopeA ≠ scopeB, so check 4 fails with
  //   SCOPE_CHAIN_BROKEN.
  // -----------------------------------------------------------------
  {
    const result = enforce(principalInB, "network.request", deploymentB, "REVIEWED_EXTENSION", signedManifest, { now: clock })
    if (!result.allow && result.reason === "SCOPE_CHAIN_BROKEN") {
      record("Test 5 — scope chain broken (TM-T-02)", "PASS", `deny reason=SCOPE_CHAIN_BROKEN, detail="${result.detail ?? ""}"`)
    } else {
      record("Test 5 — scope chain broken (TM-T-02)", "FAIL", JSON.stringify(result))
    }
  }

  // -----------------------------------------------------------------
  // Bonus — Grant TTL + bindingDigest uniqueness (production sanity)
  //   Not counted in the 5-test plan distribution, but logged for
  //   future debugging. Skipped from summary.
  // -----------------------------------------------------------------
  {
    const r1 = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedManifest, { now: clock })
    const r2 = enforce(principalInA, "network.request", deploymentA, "REVIEWED_EXTENSION", signedManifest, { now: () => FROZEN + 1 })
    if (r1.allow && r2.allow && r1.grant.bindingDigest !== r2.grant.bindingDigest) {
      record("Bonus — grant bindingDigest varies with grantedAt (replay protection)", "PASS", "two grants at t and t+1 have different digests", /* supplementaryOnly */ true)
    } else {
      record("Bonus — grant bindingDigest varies with grantedAt", "FAIL", "digests collides or one grant denied", /* supplementaryOnly */ true)
    }
  }

  // -----------------------------------------------------------------
  // Sanity — known verifier-only path is still MISSING in production
  //   This finding is what motivated the spike. The production
  //   `@unifia/capability-runtime/src/index.ts` does not yet export
  //   an `enforce` function (only `signCapabilityManifest`,
  //   `createSecureCapabilityRegistry`, `Ed25519ManifestVerifier`).
  //   Logged as supplementary (not in the §5.5 distribution).
  // -----------------------------------------------------------------
  {
    record(
      "Production `@unifia/capability-runtime` exposes `enforce`",
      "MISSING",
      "verifier-only today (M0-06). This spike defines the production API. To be added in C-M1-08.",
      /* supplementaryOnly */ true,
    )
  }
}

runTests()

// ============================================================================
// Section D — Summary
// ============================================================================

const pass = planResults.filter((r) => r.verdict === "PASS").length
const partial = planResults.filter((r) => r.verdict === "PARTIAL").length
const fail = planResults.filter((r) => r.verdict === "FAIL").length
const missing = planResults.filter((r) => r.verdict === "MISSING").length

const supPass = supplementary.filter((r) => r.verdict === "PASS").length
const supMissing = supplementary.filter((r) => r.verdict === "MISSING").length

console.log("")
console.log("M1-05 spike summary (plan §5.5 distribution)")
console.log("============================================")
console.log(`PASS     ${pass}`)
console.log(`PARTIAL  ${partial}`)
console.log(`FAIL     ${fail}`)
console.log(`MISSING  ${missing}`)
console.log("")
console.log(`Supplementary: ${supPass} PASS, ${supMissing} MISSING (not in plan distribution)`)
console.log("")

if (fail === 0 && partial === 0 && missing === 0 && pass === 5) {
  console.log("Verdict: the enforcer design is sound. All 5 refusal paths are")
  console.log("reachable, the happy path mints a short-lived grant with a")
  console.log("replay-resistant bindingDigest. The supplementary MISSING")
  console.log("(production export of `enforce`) is C-M1-08 work, lifted")
  console.log("from this spike into")
  console.log("`@unifia/capability-runtime/src/enforcer.ts`.")
  process.exit(0)
} else {
  console.log("Verdict: the enforcer design has gaps. Inspect the FAILs above")
  console.log("and update the spike before promoting to C-M1-08.")
  process.exit(1)
}
