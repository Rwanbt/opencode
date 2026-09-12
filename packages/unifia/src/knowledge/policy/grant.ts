/* SPDX-License-Identifier: MIT */
/**
 * Declassification grants (ADR-KNOW-0006 §3, R-0015).
 *
 * Portable restrictions can only restrict. That rule is what makes a `deny`
 * trustworthy — and it also made the ADR's own legitimate case impossible:
 * deliberately sharing one note with one destination, once, with consent.
 * Until now nothing could widen a `deny`, so the only way to share a
 * restricted note was to edit the note, which is a permanent change made for
 * a momentary purpose.
 *
 * A grant is the narrow, audited exception the ADR describes:
 *
 * - **bound to a content hash** — it authorises *that* content, not the note.
 *   Edit the note and the grant no longer applies, which is the point: a
 *   grant must not silently cover text the granter never saw.
 * - **bound to one destination** — consent to send something to a local model
 *   is not consent to send it to a cloud provider.
 * - **time-limited** — a grant that never expires is a restriction removed.
 * - **one-shot** — consumed by the first egress it authorises, so a single
 *   act of consent cannot become a standing permission.
 *
 * Everything a grant does is recorded: it is the one path that widens, so it
 * is the one that most needs a trail.
 */

import { randomUUID } from "node:crypto"
import { KnowledgeFailure } from "../domain/errors.js"

/** Default life of a grant. Short: consent is for an act, not a period. */
export const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000

/** A grant may not outlive this, whatever the caller asks for. */
export const MAX_GRANT_TTL_MS = 60 * 60 * 1000

export interface DeclassificationGrant {
  id: string
  /** sha256 of the exact content this authorises. */
  contentHash: string
  /** The one destination, qualified: `provider:x` or `provider:x:remote`. */
  destination: string
  /** Who granted it, for the trail. */
  grantedBy: string
  /** Why, for the trail. Required: a grant with no stated reason is a hole. */
  reason: string
  grantedAt: string
  expiresAt: string
  /** Set when the grant has been spent. */
  consumedAt: string | null
}

export interface IssueGrantInput {
  contentHash: string
  destination: string
  grantedBy: string
  reason: string
  ttlMs?: number
}

/**
 * In-process store of declassification grants.
 *
 * Deliberately not persisted: a grant is consent for an act happening now,
 * and consent that survives a restart is a standing permission wearing a
 * grant's name. A caller that wants a durable exception should edit the
 * note's restrictions, which is visible in the vault and in git.
 */
export class GrantRegistry {
  private readonly grants = new Map<string, DeclassificationGrant>()

  issue(input: IssueGrantInput): DeclassificationGrant {
    if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
      throw KnowledgeFailure.mutationRefused(
        "a grant must name the exact content hash it authorises",
      )
    }
    if (input.destination.trim().length === 0) {
      throw KnowledgeFailure.mutationRefused("a grant must name one destination")
    }
    if (input.reason.trim().length === 0) {
      // A grant is the one mechanism that widens; an unexplained one is
      // indistinguishable from a mistake when read back a month later.
      throw KnowledgeFailure.mutationRefused("a grant must carry a reason")
    }

    const ttl = input.ttlMs ?? DEFAULT_GRANT_TTL_MS
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw KnowledgeFailure.mutationRefused(`ttlMs must be positive, got ${String(input.ttlMs)}`)
    }
    if (ttl > MAX_GRANT_TTL_MS) {
      throw KnowledgeFailure.mutationRefused(
        `ttlMs ${ttl} exceeds the ${MAX_GRANT_TTL_MS} ms maximum for a grant`,
      )
    }

    const now = Date.now()
    const grant: DeclassificationGrant = {
      id: `grant_${randomUUID()}`,
      contentHash: input.contentHash,
      destination: input.destination,
      grantedBy: input.grantedBy,
      reason: input.reason,
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      consumedAt: null,
    }
    this.grants.set(grant.id, grant)
    return grant
  }

  /**
   * Spend a grant for this exact content and destination.
   *
   * Returns the grant when it applied, null otherwise. Consumption is part of
   * the lookup on purpose: a caller cannot check a grant, act, and forget to
   * mark it used.
   */
  consume(
    contentHash: string,
    destination: string,
    now: number = Date.now(),
  ): DeclassificationGrant | null {
    for (const grant of this.grants.values()) {
      if (grant.consumedAt !== null) continue
      if (grant.contentHash !== contentHash) continue
      if (grant.destination !== destination) continue
      if (now >= Date.parse(grant.expiresAt)) continue
      grant.consumedAt = new Date(now).toISOString()
      return grant
    }
    return null
  }

  /** Revoke before it is spent. */
  revoke(id: string): void {
    const grant = this.grants.get(id)
    if (grant === undefined) throw KnowledgeFailure.mutationRefused(`unknown grant: ${id}`)
    if (grant.consumedAt === null) grant.consumedAt = new Date().toISOString()
  }

  /** Grants still usable right now. */
  active(now: number = Date.now()): DeclassificationGrant[] {
    return [...this.grants.values()].filter(
      (g) => g.consumedAt === null && now < Date.parse(g.expiresAt),
    )
  }

  get(id: string): DeclassificationGrant | null {
    return this.grants.get(id) ?? null
  }
}
