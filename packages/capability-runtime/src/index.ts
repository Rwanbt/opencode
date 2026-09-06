/* SPDX-License-Identifier: MIT */
/**
 * `@unifia/capability-runtime` — public surface.
 *
 * - Verifier (M0-06): `Ed25519ManifestVerifier` + `signCapabilityManifest`
 * - Enforcer (M1-08 / C-M1-08): `enforce` + `requiredTrustClass` + `computeBindingDigest` + `CAPABILITY_MIN_TRUST`
 * - Registry (TM-CP-01): `createSecureCapabilityRegistry` — the unique
 *   public entry point for capability authorization
 *
 * Direct use of the verifier and the low-level enforcer is supported
 * (advanced users, tests), but production callers should go through
 * `createSecureCapabilityRegistry(verifier).check(...)` so the
 * revocation check is never bypassed.
 */
import { sign, verify } from "node:crypto"
import type { CapabilityManifest, ManifestVerifier } from "@unifia/contracts"
import { capabilitySignaturePayload } from "@unifia/contracts"

export class Ed25519ManifestVerifier implements ManifestVerifier {
  readonly #publicKey: string | Buffer
  constructor(publicKey: string | Buffer) { this.#publicKey = publicKey }
  verify(payload: string, signature: string): boolean { try { return verify(null, Buffer.from(payload), this.#publicKey, Buffer.from(signature, "base64")) } catch { return false } }
}
export function signCapabilityManifest(manifest: CapabilityManifest, privateKey: string | Buffer): string { return sign(null, Buffer.from(capabilitySignaturePayload(manifest)), privateKey).toString("base64") }

// Re-export the enforcer (C-M1-08) — production types + the pure
// `enforce()` function. The registry is the recommended entry point
// (see below); `enforce` is exported for tests and advanced callers
// that need to bypass the revocation layer.
export {
  CAPABILITY_MIN_TRUST,
  DEFAULT_GRANT_TTL_MS,
  computeBindingDigest,
  enforce,
  requiredTrustClass,
  type EnforceOptions,
  type SignedManifest,
} from "./enforcer.js"

// Re-export the registry (TM-CP-01 unique entry point).
export {
  createSecureCapabilityRegistry,
  type SecureCapabilityRegistry,
} from "./registry.js"
