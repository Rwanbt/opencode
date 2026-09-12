/* SPDX-License-Identifier: MIT */

/**
 * Principal authentication and request rate limiting for the Workbench server.
 *
 * WHY this exists: before this module the token-minting routes
 * (`POST /v1/workspaces/register` and `POST /v1/workspaces/:id/open`) accepted
 * anonymous callers. Anyone able to reach the port could register a workspace
 * rooted at an arbitrary filesystem path and mint a file-session token with
 * read and write access. Authentication is therefore a constructor requirement
 * of WorkbenchServer, not an option: omitting it must be impossible, and
 * disabling it must be an explicit, visible act.
 *
 * Scope of this module: local verification of detached HMAC-signed bearer
 * tokens (HS256, JWT-shaped). Obtaining those tokens from an external identity
 * provider (OAuth authorization-code flow, OIDC discovery, JWKS rotation) is
 * deliberately NOT implemented here — it needs an external IdP and cannot be
 * proven locally. See docs/autonomy/reports/GATE-C-STATUS-2026-08-03.md.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { P3_CAPABILITIES } from "@unifia/contracts"

export type Principal = {
  readonly id: string
  readonly scopes: ReadonlySet<string>
  /** `"*"` grants every workspace; a set restricts the principal to those ids. */
  readonly workspaces: "*" | ReadonlySet<string>
}

export type PrincipalAuthenticator = {
  authenticate(request: Request): Promise<Principal | undefined>
}

export type ScopedTokenRequest = {
  readonly principalId: string
  readonly workspaceId: string
  readonly instanceId: string
  readonly capabilities: readonly string[]
}

export type ScopedToken = ScopedTokenRequest & {
  readonly token: string
  readonly tokenId: string
  readonly issuedAt: number
  readonly expiresAt: number
}

type ScopedTokenClaims = ScopedTokenRequest & {
  readonly kind: "unifia-workbench"
  readonly tokenId: string
  readonly issuedAt: number
  readonly expiresAt: number
}

type TokenLease = {
  current: ScopedTokenClaims
  previous?: { claims: ScopedTokenClaims; acceptedUntil: number }
}

export type RateLimiter = {
  /** Returns false when the caller exceeded its budget for this window. */
  take(key: string): boolean
}

/**
 * Mints short-lived, workspace-scoped bearer tokens while keeping the signing
 * key inside the native/server process. Rotation accepts the previous token
 * only during the explicit grace period; closing a scope revokes both tokens.
 */
export class ScopedTokenIssuer {
  readonly #key: Buffer
  readonly #ttlMs: number
  readonly #gracePeriodMs: number
  readonly #now: () => number
  readonly #leases = new Map<string, TokenLease>()

  constructor(key: string | Uint8Array, ttlMs: number, gracePeriodMs: number, now: () => number = Date.now) {
    const material = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key)
    if (material.length < 32) throw new Error("signing key must be at least 32 bytes")
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("token ttl must be a positive integer")
    if (!Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 0) throw new Error("token grace period must be a non-negative integer")
    this.#key = material
    this.#ttlMs = ttlMs
    this.#gracePeriodMs = gracePeriodMs
    this.#now = now
  }

  issue(request: ScopedTokenRequest): ScopedToken {
    const claims = this.#claims(request)
    this.#leases.set(this.#scope(request), { current: claims })
    return this.#public(claims)
  }

  rotate(request: ScopedTokenRequest): { token: ScopedToken; previousToken: string | null; gracePeriodMs: number } {
    const scope = this.#scope(request)
    const previous = this.#leases.get(scope)?.current
    const claims = this.#claims(request)
    this.#leases.set(scope, { current: claims, previous: previous ? { claims: previous, acceptedUntil: claims.issuedAt + this.#gracePeriodMs } : undefined })
    return { token: this.#public(claims), previousToken: previous ? this.#encode(previous) : null, gracePeriodMs: this.#gracePeriodMs }
  }

  verify(token: string): ScopedToken | undefined {
    const claims = this.#decode(token)
    if (!claims) return undefined
    const now = this.#now()
    if (now >= claims.expiresAt) return undefined
    const lease = this.#leases.get(this.#scope(claims))
    if (!lease || lease.current.tokenId === claims.tokenId) return lease?.current.tokenId === claims.tokenId ? this.#public(claims) : undefined
    if (lease.previous?.claims.tokenId !== claims.tokenId || now >= lease.previous.acceptedUntil) return undefined
    return this.#public(claims)
  }

  revoke(request: Pick<ScopedTokenRequest, "workspaceId" | "instanceId">): void {
    this.#leases.delete(this.#scope(request))
  }

  #claims(request: ScopedTokenRequest): ScopedTokenClaims {
    if (!request.principalId || !request.workspaceId || !request.instanceId) throw new Error("token scope identifiers are required")
    const issuedAt = this.#now()
    return { ...request, capabilities: [...new Set(request.capabilities)], kind: "unifia-workbench", tokenId: randomUUID(), issuedAt, expiresAt: issuedAt + this.#ttlMs }
  }

  #scope(value: Pick<ScopedTokenRequest, "workspaceId" | "instanceId">): string {
    return `${value.workspaceId}\u0000${value.instanceId}`
  }

  #public(claims: ScopedTokenClaims): ScopedToken {
    return { ...claims, token: this.#encode(claims) }
  }

  #encode(claims: ScopedTokenClaims): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
    const data = `${header}.${payload}`
    return `${data}.${createHmac("sha256", this.#key).update(data).digest("base64url")}`
  }

  #decode(token: string): ScopedTokenClaims | undefined {
    const parts = token.split(".")
    if (parts.length !== 3 || !BASE64URL.test(parts[0]) || !BASE64URL.test(parts[1]) || !BASE64URL.test(parts[2])) return undefined
    const supplied = Buffer.from(parts[2], "base64url")
    const expected = createHmac("sha256", this.#key).update(`${parts[0]}.${parts[1]}`).digest()
    if (!signaturesMatch(expected, supplied)) return undefined
    try {
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: unknown; typ?: unknown }
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as ScopedTokenClaims
      if (header.alg !== "HS256" || header.typ !== "JWT" || claims.kind !== "unifia-workbench") return undefined
      if (typeof claims.tokenId !== "string" || typeof claims.workspaceId !== "string" || typeof claims.instanceId !== "string" || typeof claims.principalId !== "string") return undefined
      if (!Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) || !Array.isArray(claims.capabilities) || !claims.capabilities.every((capability) => typeof capability === "string")) return undefined
      return claims
    } catch { return undefined }
  }
}

/** Native-only authority boundary; never expose this port to the WebView. */
export type ScopedTokenAuthority = Pick<ScopedTokenIssuer, "issue" | "rotate" | "verify" | "revoke">

export function principalCanRegister(principal: Principal): boolean {
  return principal.scopes.has("workspace.register")
}

export function principalCanOpen(principal: Principal, workspaceId: string): boolean {
  if (!principal.scopes.has("workspace.open")) return false
  return principal.workspaces === "*" || principal.workspaces.has(workspaceId)
}

/** Exported for reuse by other HMAC-signed-token modules in this package (e.g. present-link.ts) — one definition of "what base64url looks like", not a second copy. */
export const BASE64URL = /^[A-Za-z0-9_-]+$/

function decodeSegment(segment: string): unknown {
  if (!BASE64URL.test(segment)) throw new Error("token segment is not base64url")
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))
}

function signingInput(token: string): { data: string; signature: Buffer } {
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("token is not a three-part JWS")
  if (!BASE64URL.test(parts[2])) throw new Error("token signature is not base64url")
  return { data: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") }
}

/** Exported for the same reason as BASE64URL above. */
export function signaturesMatch(expected: Buffer, supplied: Buffer): boolean {
  // WHY: timingSafeEqual throws on length mismatch, so the length is compared
  // first — but only after both buffers exist, to keep the comparison constant
  // time for equal-length forgeries.
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

type TokenClaims = {
  sub?: unknown
  iss?: unknown
  aud?: unknown
  exp?: unknown
  nbf?: unknown
  scopes?: unknown
  workspaces?: unknown
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every((entry) => typeof entry === "string") ? (value as readonly string[]) : undefined
}

/**
 * Thrown by `HmacTokenAuthenticator.sign` (DA-CAP-03) when a principal carries
 * a scope that is neither a registered P3 capability nor one of the local
 * control scopes. The error is typed so call sites can branch on it
 * specifically without string-matching a generic `Error`.
 */
export class UnknownPrincipalScopeError extends Error {
  readonly #scope: string
  constructor(scope: string) {
    super(`unknown scope in principal.scopes: ${JSON.stringify(scope)} (not in P3_CAPABILITIES and not a known control scope)`)
    this.name = "UnknownPrincipalScopeError"
    this.#scope = scope
  }
  get scope(): string { return this.#scope }
}

/**
 * DA-CAP-03: the closure of names that may legally appear in a minted token's
 * `scopes` claim.
 *
 * - P3_CAPABILITIES (ADR-1034, ADR-1038) is the broker's universe; every
 *   capability gated by `#checkCapability` belongs to this set.
 * - `workspace.register` / `workspace.open` are the local authority's gating
 *   strings (see `principalCanRegister` / `principalCanOpen` below). They are
 *   checked by route handlers, never reach the broker, and have no
 *   capability-side alias.
 *
 * Anything outside this closure is a typo, a stale name from a removed
 * capability, or an injection — none of which `sign()` should ever honour.
 */
const KNOWN_PRINCIPAL_SCOPES: ReadonlySet<string> = new Set([
  ...P3_CAPABILITIES,
  "workspace.register",
  "workspace.open",
])

/**
 * Verifies detached HS256 bearer tokens minted by a trusted local issuer.
 *
 * @thread-safety stateless after construction; safe for concurrent requests.
 */
export class HmacTokenAuthenticator implements PrincipalAuthenticator {
  readonly #key: Buffer
  readonly #issuer: string
  readonly #audience: string
  readonly #now: () => number

  constructor(key: string | Uint8Array, issuer: string, audience: string, now: () => number = Date.now) {
    const material = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key)
    if (material.length < 32) throw new Error("signing key must be at least 32 bytes")
    this.#key = material
    this.#issuer = issuer
    this.#audience = audience
    this.#now = now
  }

  /** Mints a token for the given principal. Test and local-bootstrap use only. */
  sign(principal: Principal, expiresAt: number, notBefore = 0): string {
    // DA-CAP-03 issuance defense: refuse to mint a token whose principal carries
    // a scope name outside KNOWN_PRINCIPAL_SCOPES. The alternative — silently
    // embedding an unknown string — lets a misconfigured caller smuggle
    // arbitrary identifiers into a signed token, and the verifier will hand
    // them back to whichever route handler later consumes the claim.
    for (const scope of principal.scopes) {
      if (!KNOWN_PRINCIPAL_SCOPES.has(scope)) throw new UnknownPrincipalScopeError(scope)
    }
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const claims = {
      sub: principal.id,
      iss: this.#issuer,
      aud: this.#audience,
      exp: expiresAt,
      nbf: notBefore,
      scopes: [...principal.scopes],
      workspaces: principal.workspaces === "*" ? "*" : [...principal.workspaces],
    }
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
    const data = `${header}.${payload}`
    return `${data}.${createHmac("sha256", this.#key).update(data).digest("base64url")}`
  }

  async authenticate(request: Request): Promise<Principal | undefined> {
    const header = request.headers.get("authorization")
    if (!header?.startsWith("Bearer ")) return undefined
    try {
      return this.#verify(header.slice(7))
    } catch {
      return undefined
    }
  }

  #verify(token: string): Principal | undefined {
    const { data, signature } = signingInput(token)
    const expected = createHmac("sha256", this.#key).update(data).digest()
    if (!signaturesMatch(expected, signature)) return undefined
    const head = decodeSegment(data.split(".")[0]) as { alg?: unknown; typ?: unknown }
    // WHY: pinning alg rejects the "alg: none" and algorithm-confusion families
    // outright instead of trusting the token to name its own verification.
    if (head.alg !== "HS256" || head.typ !== "JWT") return undefined
    return this.#principalFromClaims(decodeSegment(data.split(".")[1]) as TokenClaims)
  }

  #principalFromClaims(claims: TokenClaims): Principal | undefined {
    if (typeof claims.sub !== "string" || claims.sub.length === 0) return undefined
    if (claims.iss !== this.#issuer || claims.aud !== this.#audience) return undefined
    if (typeof claims.exp !== "number" || typeof claims.nbf !== "number") return undefined
    const now = this.#now()
    if (now >= claims.exp || now < claims.nbf) return undefined
    const scopes = readStringArray(claims.scopes)
    if (!scopes) return undefined
    const workspaces = claims.workspaces === "*" ? "*" : readStringArray(claims.workspaces)
    if (!workspaces) return undefined
    return {
      id: claims.sub,
      scopes: new Set(scopes),
      workspaces: workspaces === "*" ? "*" : new Set(workspaces),
    }
  }
}

/**
 * Fixed-window request limiter keyed by principal.
 *
 * A fixed window admits up to 2x the budget across a window boundary. That is
 * accepted here: this limiter exists to bound abuse and accidental loops, not
 * to meter billing. A sliding window would be required for the latter.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  readonly #budget: number
  readonly #windowMs: number
  readonly #now: () => number
  readonly #counters = new Map<string, { windowStart: number; count: number }>()

  constructor(budget: number, windowMs: number, now: () => number = Date.now) {
    if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error("rate limit budget must be a positive integer")
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error("rate limit window must be a positive integer")
    this.#budget = budget
    this.#windowMs = windowMs
    this.#now = now
  }

  take(key: string): boolean {
    const now = this.#now()
    const counter = this.#counters.get(key)
    if (!counter || now - counter.windowStart >= this.#windowMs) {
      this.#counters.set(key, { windowStart: now, count: 1 })
      return true
    }
    if (counter.count >= this.#budget) return false
    counter.count += 1
    return true
  }
}

/**
 * Accepts every caller as a fixed principal.
 *
 * WHY it is a named, exported class rather than an `auth?: ...` default:
 * disabling authentication must appear at the call site and be greppable.
 * Never construct this in a process reachable from a network interface.
 */
export class UnauthenticatedPrincipal implements PrincipalAuthenticator {
  readonly #principal: Principal

  constructor(id = "anonymous", scopes: readonly string[] = ["workspace.register", "workspace.open"]) {
    this.#principal = { id, scopes: new Set(scopes), workspaces: "*" }
  }

  async authenticate(): Promise<Principal> {
    return this.#principal
  }
}
