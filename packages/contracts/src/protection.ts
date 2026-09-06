/* SPDX-License-Identifier: MIT */
/**
 * At-rest protection envelope — Plan V2.3.1 §74, ADR-005 + ADR-010.
 *
 * The AtRestProtectionEnvelope is the durable record that an
 * artifact (or other secret-bearing object) was encrypted at rest,
 * and the metadata a key-resolver needs to decrypt it. The envelope
 * travels with the ciphertext; without it, the bytes are opaque.
 *
 * Three protection schemes are supported:
 *   - `envelope`    : the artifact is encrypted with a fresh DEK,
 *                     which is itself wrapped by a KEK identified
 *                     by `keyRef`. The wrapped DEK is in
 *                     `wrappedDataKey`.
 *   - `DEK-wrapped` : same as envelope, but the DEK is named
 *                     directly in `keyRef` (no KEK indirection).
 *   - `OS-keyring`  : the encryption key is held in the OS
 *                     keyring (DPAPI / Keychain / libsecret). The
 *                     `keyRef` is a stable string the keyring
 *                     understands. `wrappedDataKey` is absent.
 *
 * The `aadDomain` field binds the ciphertext to a logical
 * application (e.g. "artifact-content", "credential-material",
 * "audit-row") so a ciphertext for one use cannot be replayed as
 * a ciphertext for another. The AAD is part of the GCM tag, so
 * the platform's primitive (AES-256-GCM, ADR-010) refuses the
 * swap automatically.
 *
 * `version: 1` is the schema version of the envelope shape. A new
 * field is added by bumping the version, not by overloading an
 * existing one.
 */
import { z } from "zod"

/**
 * Symmetric encryption algorithm. AES-256-GCM is the only
 * algorithm currently defined; AES-GCM gives us both confidentiality
 * and authenticity (the GCM tag is the authenticity proof).
 */
export const EncryptionAlgorithmSchema = z.enum(["AES-256-GCM"])

export type EncryptionAlgorithm = z.infer<typeof EncryptionAlgorithmSchema>

/**
 * The protection scheme the envelope describes. The scheme
 * determines which fields are required (envelope and DEK-wrapped
 * need `wrappedDataKey`; OS-keyring does not) and which key the
 * runtime uses to decrypt.
 */
export const ProtectionSchemeSchema = z.enum(["envelope", "DEK-wrapped", "OS-keyring"])

export type ProtectionScheme = z.infer<typeof ProtectionSchemeSchema>

/**
 * The AAD domains the platform recognizes. Adding a new domain is
 * an ADR because it must be matched on both the encrypt and the
 * decrypt path — a typo here is a silent bug, since GCM's tag
 * would still verify.
 *
 * M1-07 alignment (plan §7.2 + M1-07-EVIDENCE.md §4) : the
 * `secret-broker` scaffold hard-codes the same 6 domains as this
 * contract (`artifact-content`, `credential-material`, `audit-row`,
 * `oauth-token`, `browser-auth-profile`, `sensitive-runtime-state`,
 * `packages/secret-broker/src/index.ts:171-177`). M1-06 extended
 * this contract from 3 → 5 (added `oauth-token` and
 * `browser-auth-profile`); M1-07 extends it from 5 → 6 by adding
 * `sensitive-runtime-state`. The two ends now agree on the full
 * 6-domain set, eliminating the GCM-tag typo class of bug
 * (silent collision across a misspelled domain literal).
 *
 * Plan V2.3.1 §76 names exactly these 6 domains. Adding a 7th is
 * an ADR (changes the parse-time domain set on every call site).
 */
export const AadDomainSchema = z.enum([
  "artifact-content",
  "credential-material",
  "audit-row",
  "oauth-token",
  "browser-auth-profile",
  "sensitive-runtime-state",
])

export type AadDomain = z.infer<typeof AadDomainSchema>

export const AtRestProtectionEnvelopeSchema = z.object({
  /** Schema version of the envelope shape itself. */
  version: z.literal(1),
  /** Which protection scheme the ciphertext was produced under. */
  protectionScheme: ProtectionSchemeSchema,
  /** Symmetric encryption algorithm. */
  encryptionAlgorithm: EncryptionAlgorithmSchema,
  /**
   * Typed reference to the key that can decrypt the artifact.
   * Interpretation depends on `protectionScheme`:
   *   - `envelope`    : a KEK id (ADR-010).
   *   - `DEK-wrapped` : a DEK id.
   *   - `OS-keyring`  : a keyring-recognizable string.
   */
  keyRef: z.string(),
  /** Optional key version (e.g. KMS key rotation generation). */
  keyVersion: z.string().optional(),
  /**
   * The wrapped DEK, base64-encoded. Required for `envelope` and
   * `DEK-wrapped`; absent for `OS-keyring`.
   */
  wrappedDataKey: z.string().optional(),
  /**
   * The IV / nonce, base64-encoded. 12 bytes (96 bits) for
   * AES-256-GCM as recommended by NIST SP 800-38D.
   */
  nonceOrIV: z.string(),
  /**
   * The AAD domain the ciphertext was bound to. The decrypt path
   * MUST verify the same domain, or GCM will refuse the tag.
   */
  aadDomain: AadDomainSchema,
})

export type AtRestProtectionEnvelope = z.infer<typeof AtRestProtectionEnvelopeSchema>
