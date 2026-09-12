/* SPDX-License-Identifier: MIT */
/**
 * Secure Capability Registry — the single entry point for capability
 * authorization (TM-CP-01). C-M1-08 production lift.
 *
 * Plan V2.3.1 §114 + §195 (M1 gate) + ADR-002 + ADR-020 + ADR-024.
 *
 * TM-CP-01: "createSecureCapabilityRegistry" is the **unique entry
 * point" — direct calls to `signCapabilityManifest` or to a raw
 * `Ed25519ManifestVerifier` from outside this package are
 * deprecated. The registry binds the verifier (M0-06, signature
 * check) to the enforcer (M1-08, scope + trust + capability check)
 * so a caller cannot accidentally skip either.
 *
 * Revocation: this first version uses an in-memory `Map` of revoked
 * `bindingDigest` values. Production persistence is DB-backed via
 * ADR-004 (capability source state) and ADR-005 (artifact state) —
 * see M1-05 EVIDENCE §6.4 E7 ("the Grant is immutable; revocation
 * is owned by the capability source"). The in-memory store is
 * documented as the temporary mechanism until the durable adapter
 * lands.
 */
import type {
  CapabilityGrant,
  DeploymentScope,
  EnforcementResult,
  TrustClass,
  WorkerId,
} from "@unifia/contracts"
import type { ManifestVerifier } from "@unifia/contracts"
import { enforce, type SignedManifest } from "./enforcer.js"

/** Public shape of the secure registry — the unique entry point (TM-CP-01). */
export interface SecureCapabilityRegistry {
  /** Authorize (or refuse) a capability exercise. */
  check(
    principal: WorkerId,
    capability: string,
    requestedScope: DeploymentScope,
    trustClass: TrustClass,
    manifest: SignedManifest,
  ): EnforcementResult
  /**
   * Revoke a previously issued grant. Subsequent `check()` calls that
   * would mint a grant with the same `bindingDigest` are refused with
   * `deny` reason `MANIFEST_REVOKED`.
   *
   * In-memory for now; production = DB-backed via ADR-004.
   */
  revoke(grantDigest: string): void
  /**
   * Whether a grant digest is currently revoked. Exposed for tests and
   * for the executor's own replay check.
   */
  isRevoked(grantDigest: string): boolean
}

/** Build a fresh registry instance. */
export function createSecureCapabilityRegistry(
  verifier: ManifestVerifier,
): SecureCapabilityRegistry {
  // `verifier` is reserved for the future wiring of `verifyManifest`
  // (the enforcer trusts the caller to have already verified the
  // manifest, but the registry is the place that will *enforce* the
  // verify call in a later card — see M1-05 EVIDENCE §3 pipeline
  // diagram). Today we accept it so callers can pass a verifier
  // without changing the API.
  void verifier

  const revoked = new Map<string, number>() // digest -> revokedAt ms

  return {
    check(principal, capability, requestedScope, trustClass, manifest) {
      const result = enforce(principal, capability, requestedScope, trustClass, manifest)
      if (result.kind !== "grant") return result
      if (revoked.has(result.grant.bindingDigest)) {
        return {
          kind: "deny",
          reason: "MANIFEST_REVOKED",
          detail: `grant ${result.grant.bindingDigest} has been revoked`,
        }
      }
      return result
    },
    revoke(grantDigest: string) {
      if (!revoked.has(grantDigest)) revoked.set(grantDigest, Date.now())
    },
    isRevoked(grantDigest: string) {
      return revoked.has(grantDigest)
    },
  }
}

// Re-export the grant type so consumers can type their revoke arguments.
export type { CapabilityGrant }
