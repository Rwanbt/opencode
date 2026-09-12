/* SPDX-License-Identifier: MIT */

/**
 * Webhook signature verification for the remote transports — Plan V3 §22.
 *
 * §22 asks for "signature de webhook" and "anti-replay nonce/timestamp". Both
 * schemes below are the ones the providers actually publish, not a stand-in:
 * a placeholder that compares against a constant string type-checks, passes a
 * green test, and verifies nothing — which is how `signature: "bolt-verified"`
 * survived in the tree until this audit.
 *
 * Secrets never arrive here as plain strings. The caller passes a
 * `SecretReference`, so `SecretStore.revoke()` disables verification at once
 * and the key is not retained on any long-lived object.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import type { SecretStore } from "@unifia/contracts"

export type SecretReference = { store: SecretStore; name: string; scope: string }

export type SignatureRefusal =
  | "missing-secret"
  | "malformed-timestamp"
  | "stale-timestamp"
  | "unsupported-version"
  | "bad-signature"

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureRefusal }

export type SignedRequest = {
  rawBody: string
  /** Provider timestamp, in seconds, as it appeared on the wire. */
  timestamp: string
  nonce?: string
  signature: string
}

const REFUSE = (reason: SignatureRefusal): SignatureResult => ({ ok: false, reason })

/**
 * Compares two hex digests without leaking the position of the first
 * difference. Length is compared first because `timingSafeEqual` throws on
 * mismatched lengths, and a length mismatch is already public information.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Reads a secret through a freshly issued handle; revoking the secret fails here. */
export function resolveSecret(reference: SecretReference): string | undefined {
  const handle = reference.store.issue(reference.name, reference.scope)
  if (!handle) return undefined
  return reference.store.resolve(handle, reference.scope)
}

function timestampSkewMs(timestamp: string, now: number): number | undefined {
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || timestamp.trim() === "") return undefined
  return Math.abs(now - seconds * 1000)
}

/**
 * Slack request signing: `v0=` + hex HMAC-SHA256 over `v0:{timestamp}:{body}`.
 *
 * The timestamp is inside the signed string, so the skew check is what stops a
 * captured-and-replayed request: the signature itself stays valid forever.
 */
export function verifySlackSignature(input: { request: SignedRequest; secret: SecretReference; now: number; maxSkewMs: number }): SignatureResult {
  const secret = resolveSecret(input.secret)
  if (!secret) return REFUSE("missing-secret")
  const skew = timestampSkewMs(input.request.timestamp, input.now)
  if (skew === undefined) return REFUSE("malformed-timestamp")
  if (skew > input.maxSkewMs) return REFUSE("stale-timestamp")
  if (!input.request.signature.startsWith("v0=")) return REFUSE("unsupported-version")
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${input.request.timestamp}:${input.request.rawBody}`).digest("hex")}`
  return constantTimeEquals(expected, input.request.signature.trim().toLowerCase()) ? { ok: true } : REFUSE("bad-signature")
}

/**
 * Feishu/Lark callback signing: hex SHA-256 over
 * `{timestamp}{nonce}{encryptKey}{body}`.
 *
 * The nonce is part of the signed string but does not make the request
 * single-use on its own — the bridge still has to remember it, which is why
 * `RemoteBridge` keeps the nonce window rather than trusting this check.
 */
export function verifyFeishuSignature(input: { request: SignedRequest; secret: SecretReference; now: number; maxSkewMs: number }): SignatureResult {
  const encryptKey = resolveSecret(input.secret)
  if (!encryptKey) return REFUSE("missing-secret")
  const skew = timestampSkewMs(input.request.timestamp, input.now)
  if (skew === undefined) return REFUSE("malformed-timestamp")
  if (skew > input.maxSkewMs) return REFUSE("stale-timestamp")
  const expected = createHash("sha256").update(`${input.request.timestamp}${input.request.nonce ?? ""}${encryptKey}${input.request.rawBody}`).digest("hex")
  return constantTimeEquals(expected, input.request.signature.trim().toLowerCase()) ? { ok: true } : REFUSE("bad-signature")
}
