/* SPDX-License-Identifier: MIT */
/**
 * Credential references — Plan V2.3.1 §123, ADR-010.
 *
 * The four reference types in this module are the *only* shape in
 * which a workflow, an approval, or any other client of the executor
 * is allowed to name a secret. None of them carries secret material
 * — the value is resolved at the executor boundary by the key
 * manager (ADR-010). A reference in a log line is useless to an
 * attacker; the actual key bytes never leave the secure store.
 *
 * The four kinds are deliberately disjoint types rather than a
 * single union with a `kind` tag, because each has a different
 * resolution path and a different audit row. Splitting them at the
 * type level prevents a CredentialRef from being passed where a
 * SecretRef is expected (and vice versa) without a runtime check.
 *
 * All four carry an `OwnershipScope` (Plan V2.3.1 §44, ADR-020) so
 * the resolver can refuse a reference that targets the wrong org,
 * project, or workspace — the same boundary used for artifacts and
 * workflows.
 */
import { z } from "zod"
import { OwnershipScopeSchema } from "./scope.js"

/* ------------------------------------------------------------------ */
/* CredentialRef — a named credential in the platform's vault          */
/* ------------------------------------------------------------------ */

/**
 * A reference to a generic platform credential. The credential
 * itself lives in the secure store keyed by `credentialId`; this
 * type is the *address*. The executor resolves the address to a
 * value at the executor boundary — never inside a workflow node,
 * never inside a serialized IR.
 */
export const CredentialRefSchema = z.object({
  kind: z.literal("credential"),
  credentialId: z.string(),
  scope: OwnershipScopeSchema,
})

export type CredentialRef = z.infer<typeof CredentialRefSchema>

/* ------------------------------------------------------------------ */
/* SecretRef — a keychain / KMS handle                                 */
/* ------------------------------------------------------------------ */

/**
 * A reference to a "secret" in the lower-level sense (an API key,
 * a token, a private key). Distinct from CredentialRef so the
 * platform can apply a tighter audit trail to raw secret material:
 * every SecretRef resolution emits a dedicated audit row, while a
 * CredentialRef (which is itself a higher-level handle) does not.
 */
export const SecretRefSchema = z.object({
  kind: z.literal("secret"),
  secretId: z.string(),
  scope: OwnershipScopeSchema,
})

export type SecretRef = z.infer<typeof SecretRefSchema>

/* ------------------------------------------------------------------ */
/* OAuthConnectionRef — a connected third-party identity               */
/* ------------------------------------------------------------------ */

/**
 * A reference to a stored OAuth connection to a third-party
 * provider. The `provider` field is a stable string (e.g.
 * "github", "google", "slack") used by the audit log to make the
 * connection human-readable. The refresh-and-exchange dance is
 * done by the executor at resolution time; the reference carries
 * no tokens.
 */
export const OAuthConnectionRefSchema = z.object({
  kind: z.literal("oauth"),
  connectionId: z.string(),
  provider: z.string(),
  scope: OwnershipScopeSchema,
})

export type OAuthConnectionRef = z.infer<typeof OAuthConnectionRefSchema>

/* ------------------------------------------------------------------ */
/* BrowserAuthProfileRef — a stored browser session                    */
/* ------------------------------------------------------------------ */

/**
 * A reference to a stored browser-auth profile. The profile holds
 * the cookies, local storage, and TLS state needed to act as a
 * specific user on a specific site. Resolving the profile spins
 * up an isolated browser process (the executor boundary) and tears
 * it down on completion; the profile bytes never enter a workflow.
 */
export const BrowserAuthProfileRefSchema = z.object({
  kind: z.literal("browser-auth"),
  profileId: z.string(),
  scope: OwnershipScopeSchema,
})

export type BrowserAuthProfileRef = z.infer<typeof BrowserAuthProfileRefSchema>

/* ------------------------------------------------------------------ */
/* The union — for call sites that handle more than one kind           */
/* ------------------------------------------------------------------ */

/**
 * Discriminated union of the four reference kinds. Use this when
 * the call site can accept any kind; use the individual types
 * when the call site is specific. The `kind` discriminator is
 * required (z.literal, not z.string) so a typo in a producer
 * fails Zod validation.
 */
export const AnyCredentialRefSchema = z.discriminatedUnion("kind", [
  CredentialRefSchema,
  SecretRefSchema,
  OAuthConnectionRefSchema,
  BrowserAuthProfileRefSchema,
])

export type AnyCredentialRef = z.infer<typeof AnyCredentialRefSchema>
