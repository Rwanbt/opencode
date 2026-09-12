/* SPDX-License-Identifier: MIT */

/**
 * Phase 9.4 — signed, short-lived artifact "present" links.
 *
 * Deliberately NOT `ScopedTokenIssuer` (auth.ts): that class is
 * documented as a "native-only authority boundary; never expose this
 * port to the WebView" — it mints tokens for the desktop app's own
 * native process to hand its own WebView, a different trust model from
 * "generate a link a user can paste anywhere to let someone else view
 * one artifact". Reusing it here would blur a boundary drawn on
 * purpose. This is a separate, narrower primitive: two-part (payload +
 * signature, no header) rather than three-part JWS, single claim shape
 * (artifactId + workspaceId + expiry), no revocation/rotation/lease —
 * a present link is meant to expire on its own, not be managed.
 *
 * Reuses `BASE64URL` and `signaturesMatch` from auth.ts rather than
 * redefining "what base64url looks like" and "constant-time signature
 * comparison" a second time for the same threat model.
 */

import { createHmac } from "node:crypto"
import { BASE64URL, signaturesMatch } from "./auth.js"

export type PresentLinkClaims = {
  readonly artifactId: string
  readonly workspaceId: string
  readonly expiresAt: number
}

export class PresentLinkSigner {
  readonly #key: Buffer
  readonly #ttlMs: number
  readonly #now: () => number

  constructor(key: string | Uint8Array, ttlMs: number, now: () => number = Date.now) {
    const material = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key)
    if (material.length < 32) throw new Error("present link signing key must be at least 32 bytes")
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("present link ttl must be a positive integer")
    this.#key = material
    this.#ttlMs = ttlMs
    this.#now = now
  }

  sign(artifactId: string, workspaceId: string): { token: string; expiresAt: number } {
    const expiresAt = this.#now() + this.#ttlMs
    const claims: PresentLinkClaims = { artifactId, workspaceId, expiresAt }
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
    const signature = createHmac("sha256", this.#key).update(payload).digest("base64url")
    return { token: `${payload}.${signature}`, expiresAt }
  }

  verify(token: string): PresentLinkClaims | undefined {
    const parts = token.split(".")
    if (parts.length !== 2) return undefined
    const [payload, signature] = parts
    if (!payload || !signature || !BASE64URL.test(payload) || !BASE64URL.test(signature)) return undefined
    const expected = createHmac("sha256", this.#key).update(payload).digest()
    const supplied = Buffer.from(signature, "base64url")
    if (!signaturesMatch(expected, supplied)) return undefined
    let claims: PresentLinkClaims
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PresentLinkClaims
    } catch {
      return undefined
    }
    if (typeof claims.artifactId !== "string" || !claims.artifactId) return undefined
    if (typeof claims.workspaceId !== "string" || !claims.workspaceId) return undefined
    if (!Number.isSafeInteger(claims.expiresAt)) return undefined
    if (this.#now() >= claims.expiresAt) return undefined
    return claims
  }
}
