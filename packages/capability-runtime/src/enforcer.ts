/* SPDX-License-Identifier: MIT */
/**
 * Capability Authority enforcer — Plan V2.3.1 §114, ADR-002, ADR-020, ADR-024.
 *
 * Production lift of the M1-05 spike design
 * (docs/automation-v2/spikes/m1-05-capability-enforcer.ts). The spike
 * proved the 5 refusal paths and the grant shape; this module is the
 * canonical, Zod-typed production implementation that the rest of the
 * platform depends on.
 *
 * Order of checks (per M1 plan §3.8 + M1-05 EVIDENCE §4.4):
 *   (1) manifest signed                  → MANIFEST_UNSIGNED
 *   (2) trustClass ≥ capability min trust → TRUSTCLASS_TOO_LOW
 *   (3) principal.capabilities ⊇ {capability}
 *       AND principal.scopes ⊇ requestedScope.ownershipScope
 *                                        → CAPABILITY_NOT_IN_SCOPE  (TM-T-01)
 *   (4) principal.scopes[0] === requestedScope.ownershipScope
 *                                        → SCOPE_CHAIN_BROKEN      (TM-T-02)
 *   (5) mint grant { capability, scope, grantedAt, expiresAt, bindingDigest }
 *
 * Why this order (per M1-05 EVIDENCE §4.4):
 *   - Signature first (provenance / ADR-002): without a signature we
 *     cannot say anything meaningful.
 *   - TrustClass before capability: an `UNTRUSTED_RUNTIME` claiming
 *     `secret.read` is refused *before* a capability lookup, so a
 *     forged `principal.capabilities` cannot mask the attack under a
 *     `CAPABILITY_NOT_IN_SCOPE`.
 *   - Capability in scope: runtime-side authorization (TM-T-01).
 *   - Scope chain: structural invariant (TM-T-02).
 *   - Grant: short-lived, auditable, replay-protected.
 */
import { createHash } from "node:crypto"
import type {
  CapabilityGrant,
  DeploymentScope,
  EnforcementResult,
  OwnershipScope,
  TrustClass,
  WorkerId,
  DenialReason,
} from "@unifia/contracts"

/** Default grant TTL — 5 minutes, per M1 plan §3.8 (f). */
export const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1_000

/** Numeric rank for the 4 trust classes. Higher = more trusted. */
const TRUST_RANK: Record<TrustClass, number> = {
  CORE: 3,
  REVIEWED_EXTENSION: 2,
  UNTRUSTED_THIRD_PARTY: 1,
  UNTRUSTED_RUNTIME: 0,
}

/**
 * The minimum trust class for each of the 6 representative capabilities
 * from M1-05 EVIDENCE §6.2. Capabilities not in this map fall back to
 * `REVIEWED_EXTENSION` (read-class default). The 14 other P3 capabilities
 * from M0-06 follow the same extrapolation rule; an unknown capability
 * id is refused with `TRUSTCLASS_TOO_LOW` (no fallback rank).
 */
export const CAPABILITY_MIN_TRUST: Record<string, TrustClass> = {
  "workflow.run": "REVIEWED_EXTENSION",
  "network.request": "REVIEWED_EXTENSION",
  "secret.read": "CORE",
  "terminal.run": "CORE",
  "package.install": "CORE",
  "desktop.control": "CORE",
}

/**
 * Resolve the minimum trust class for a given capability id.
 * Returns `undefined` for unknown capabilities (no fallback rank), which
 * the enforcer treats as `TRUSTCLASS_TOO_LOW`.
 */
export function requiredTrustClass(capability: string): TrustClass | undefined {
  return CAPABILITY_MIN_TRUST[capability] ?? defaultMinTrustForUnknown(capability)
}

/**
 * Map any capability id outside the 6-capability matrix to the
 * conservative default. Production extension point: replace this with
 * a registry lookup once M0-06's full P3 capability set is wired in
 * (see M1-05 EVIDENCE §6.2 — "the 14 other P3 capabilities inherit
 * the same mapping by extrapolation").
 */
function defaultMinTrustForUnknown(_capability: string): TrustClass | undefined {
  // Closed default: unknown capability => no trust class is acceptable.
  // Returning `undefined` forces `enforce()` to refuse with
  // `TRUSTCLASS_TOO_LOW`, which is fail-closed. The registry lookup that
  // will replace this body is an ADR-024 extension point; until it exists,
  // refusing is the only safe answer.
  return undefined
}

/**
 * A signed manifest. The signature is whatever the runtime chooses
 * (Ed25519 in the spike, but the enforcer only checks presence — the
 * verifier, M0-06, is upstream).
 */
export interface SignedManifest {
  /** The capability being claimed. */
  capability: string
  /** The trust class the manifest asserts for itself. */
  trustClass: TrustClass
  /** Canonical payload the signature was computed over. */
  payload: string
  /** Ed25519 signature of `payload`, base64. Required for the enforcer to grant. */
  signature?: string
}

/** Optional clock + TTL injection for tests. */
export interface EnforceOptions {
  now?: () => number
  ttlMs?: number
}

/**
 * enforce(principal, capability, requestedScope, trustClass, manifest) — the enforcer.
 *
 * Returns a discriminated `EnforcementResult`:
 *   - `{kind: "grant", grant}` on success
 *   - `{kind: "deny", reason, detail?}` on refusal
 */
export function enforce(
  principal: WorkerId,
  capability: string,
  requestedScope: DeploymentScope,
  trustClass: TrustClass,
  manifest: SignedManifest,
  options: EnforceOptions = {},
): EnforcementResult {
  const now = options.now ?? (() => Date.now())
  const ttlMs = options.ttlMs ?? DEFAULT_GRANT_TTL_MS

  // (1) Manifest must be signed.
  if (manifest.signature === undefined || manifest.signature.length === 0) {
    return deny("MANIFEST_UNSIGNED", `manifest.signature is missing or empty for capability "${capability}"`)
  }

  // (2) TrustClass must meet the capability's minimum.
  const minTrust = requiredTrustClass(capability)
  if (minTrust === undefined) {
    return deny("TRUSTCLASS_TOO_LOW", `capability "${capability}" is not in the trust matrix (unknown capability)`)
  }
  if (TRUST_RANK[trustClass] < TRUST_RANK[minTrust]) {
    return deny(
      "TRUSTCLASS_TOO_LOW",
      `capability "${capability}" requires >= ${minTrust}, got ${trustClass}`,
    )
  }

  // (3) Principal must hold the capability AND own the requested scope.
  if (!principal.capabilities.includes(capability)) {
    return deny(
      "CAPABILITY_NOT_IN_SCOPE",
      `principal "${principal.workerId}" does not hold capability "${capability}"`,
    )
  }
  if (!principal.scopes.some((s) => scopeEquals(s, requestedScope.ownershipScope))) {
    return deny(
      "CAPABILITY_NOT_IN_SCOPE",
      `requested scope ${formatScope(requestedScope.ownershipScope)} is not in principal.scopes`,
    )
  }

  // (4) Scope chain — primary scope must own the requested deployment.
  //     This is the structural invariant TM-T-02 protects: an attacker
  //     who can register scopes on a principal cannot shift the
  //     "home" workspace.
  const primary = principal.scopes[0]
  if (primary === undefined || !scopeEquals(primary, requestedScope.ownershipScope)) {
    return deny(
      "SCOPE_CHAIN_BROKEN",
      primary === undefined
        ? `principal "${principal.workerId}" has no primary scope (scopes[] is empty)`
        : `principal.scopes[0] is ${formatScope(primary)}, requested deployment is ${formatScope(requestedScope.ownershipScope)}`,
    )
  }

  // (5) Allow — mint a short-lived, audit-bound grant.
  const grantedAt = now()
  const expiresAt = grantedAt + ttlMs
  const bindingDigest = computeBindingDigest(
    principal.workerId,
    capability,
    requestedScope.ownershipScope,
    grantedAt,
  )
  const grant: CapabilityGrant = {
    capability,
    scope: requestedScope,
    grantedAt,
    expiresAt,
    bindingDigest,
  }
  return { kind: "grant", grant }
}

/** Construct a deny result. */
function deny(reason: DenialReason, detail: string): EnforcementResult {
  return { kind: "deny", reason, detail }
}

/** Two ownership scopes are equal when the (org, project?, workspace) triple matches. */
function scopeEquals(a: OwnershipScope, b: OwnershipScope): boolean {
  return (
    a.organizationId === b.organizationId &&
    a.workspaceId === b.workspaceId &&
    (a.projectId ?? null) === (b.projectId ?? null)
  )
}

/** Format an ownership scope for human-readable diagnostics. */
function formatScope(s: OwnershipScope): string {
  return `${s.organizationId}/${s.projectId ?? "_"}/${s.workspaceId}`
}

/**
 * bindingDigest — SHA-256 over (workerId, capability, scope, grantedAt).
 *
 * The digest is the audit binding: a grant cannot be replayed for a
 * different (principal, capability, scope) triple, and two grants at
 * different `grantedAt` always produce different digests (replay
 * protection, M1-05 EVIDENCE §4.3 + §6.4 E5).
 */
export function computeBindingDigest(
  workerId: string,
  capability: string,
  scope: OwnershipScope,
  grantedAt: number,
): string {
  return createHash("sha256")
    .update(`${workerId}|${capability}|${scope.organizationId}/${scope.projectId ?? "_"}/${scope.workspaceId}|${grantedAt}`)
    .digest("hex")
}
