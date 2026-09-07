/* SPDX-License-Identifier: MIT */
/**
 * Egress policy.
 *
 * See ADR-KNOW-0006. The egress decision is the heart of the
 * Sovereign Core: a single function that decides whether a
 * `ContextItem` is allowed to flow to a given provider.
 *
 * Rules (mirroring the ADR):
 * 1. Portable restrictions can only restrict (default deny for
 *    `remoteModel` on UNCLASSIFIED).
 * 2. UNCLASSIFIED, unverified provenance, fallback cloud = DENY
 *    EXTERNAL.
 * 3. The most restrictive ancestor wins (heritage).
 * 4. ProviderPlan overrides may further restrict but never widen.
 *
 * V1 scope, honestly stated:
 * - Rules 1, 2 and 4 are enforced by `decideEgress` below.
 * - Rule 3 (heritage across summaries/translations/embeddings) is NOT
 *   implemented; there is no transformation lineage to inherit from yet.
 * - `DeclassificationGrant` (ADR-KNOW-0006 §3) is implemented, but only on
 *   `clearForEgress`: spending a grant mutates it, and `decideEgress` is
 *   pure. See `./grant.ts`.
 * - Callers must still emit the `egress.decision` audit event (§6); this
 *   function stays pure.
 * See R-0012 for the tracking of the unimplemented parts.
 */

import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"

export type EgressDecision = "allow" | "deny"

/**
 * The one thing this module needs from a grant store.
 *
 * A port rather than an import of `GrantRegistry`: the guard must not grow a
 * dependency on how grants are stored, and a caller that passes nothing gets
 * exactly the V1 behaviour — nothing widens a deny.
 */
export interface GrantConsumer {
  /** Spend a grant for this content and destination, or return null. */
  consume(contentHash: string, destination: string): { id: string } | null
}

export interface EgressInput {
  item: ContextItem
  plan: ProviderDestinationPlan
  /**
   * Consulted only by `clearForEgress`, and only after a deny — a grant is an
   * audited exception to a refusal, never a shortcut past the rules.
   * `decideEgress` ignores it, so the pure decision stays pure.
   */
  grants?: GrantConsumer
}

/**
 * The destination string a grant is bound to.
 *
 * Identical to the one the audit records (`egressAuditEntry`) and to the key
 * `planFromPolicy` reads, so consent given for `provider:x:remote` cannot be
 * spent on `provider:x`. Defined here because it is part of what a grant
 * means, not a detail of how decisions are logged.
 */
export function destinationOf(plan: ProviderDestinationPlan): string {
  return plan.destinationKind === "local"
    ? `provider:${plan.providerId}`
    : `provider:${plan.providerId}:remote`
}

export interface EgressResult {
  decision: EgressDecision
  reason: string
}

/**
 * Brand carried only by an item the guard has cleared.
 *
 * Every defect the three counter-reviews found was the same one wearing a
 * different coat: a value that should be the *result* of a decision could be
 * written directly. The router fabricated `restriction: "allow"`; `get()`
 * did the same one layer up after the router was fixed; `runProbes` turned
 * an empty evidence into a PASS; `status.vector` came from a config flag;
 * the MCP daemon lent its own token to an anonymous call. Each fix closed
 * the occurrence and left the constructibility, so the next surface drew
 * from the same urn.
 *
 * This brand closes it: a `ClearedItem` cannot be written, only obtained
 * from `clearForEgress`. A code path that emits a candidate without asking
 * the guard no longer type-checks.
 */
declare const egressCleared: unique symbol

/** A `ContextItem` the guard has allowed. Unforgeable outside this module. */
export type ClearedItem = ContextItem & { readonly [egressCleared]: true }

export type EgressVerdict =
  | { cleared: true; item: ClearedItem; result: EgressResult }
  | { cleared: false; item: ContextItem; result: EgressResult }

/**
 * Decide, and hand back a branded item when the answer is allow.
 *
 * Prefer this over calling `decideEgress` and carrying the raw item onward:
 * the brand is what makes "I forgot to check" a compile error rather than a
 * finding in the next review.
 */
export function clearForEgress(input: EgressInput): EgressVerdict {
  const result = decideEgress(input)
  if (result.decision === "allow") {
    return { cleared: true, item: input.item as ClearedItem, result }
  }

  // A refusal is the only thing a grant may overturn, and only for this exact
  // content and this exact destination (ADR-KNOW-0006 §3). The grant is spent
  // here rather than by the caller: a check the caller could perform and then
  // forget to record is the same shape of defect the brand above exists to
  // close. The reason names the grant so the audit line points at the consent.
  const grant = input.grants?.consume(input.item.contentHash, destinationOf(input.plan))
  if (grant === null || grant === undefined) {
    return { cleared: false, item: input.item, result }
  }
  return {
    cleared: true,
    item: input.item as ClearedItem,
    result: {
      decision: "allow",
      reason: `declassification grant ${grant.id} overrides: ${result.reason}`,
    },
  }
}

/**
 * Decide whether an item can flow to the given provider.
 *
 * Pure: same input, same output. No I/O, no logging. The caller
 * is responsible for emitting an `egress.decision` event.
 */
export function decideEgress(input: EgressInput): EgressResult {
  const { item, plan } = input
  const override = plan.overrides?.[item.ref.id] ?? plan.overrides?.[item.ref.locator]

  // Every deny is evaluated before any allow. A portable restriction can only
  // ever be relaxed by an audited DeclassificationGrant (ADR-KNOW-0006 §3),
  // which `clearForEgress` applies *after* this function has refused — so
  // nothing inside these rules widens a deny.

  // 1. The item's own portable restriction. Ordering matters: this must be
  //    decided BEFORE any `allow` override, otherwise a plan override widens
  //    a note that asked never to leave (ADR-KNOW-0006 §1, §4).
  if (item.restriction === "deny") {
    return { decision: "deny", reason: "item portable restriction is deny" }
  }

  // 2. A per-item override may restrict.
  if (override === "deny") {
    return { decision: "deny", reason: "per-item override denies egress" }
  }

  // 3. Provider default.
  if (plan.defaultRestriction === "deny") {
    return { decision: "deny", reason: "provider default restriction is deny" }
  }

  // 4. Unresolved provenance is denied toward anything that leaves the
  //    machine (ADR-KNOW-0006 §2 says DENY EXTERNAL, not deny everywhere).
  //    A plan that does not declare itself local counts as remote, so the
  //    ambiguous case still fails closed.
  if (item.trust === "unverified" && plan.destinationKind !== "local") {
    return {
      decision: "deny",
      reason: "provenance is unverified and the destination is not local (ADR-KNOW-0006 §2)",
    }
  }

  // 5. An `allow` override is a confirmation, never a widening: it is only
  //    reachable once every deny above has been cleared.
  if (override === "allow") {
    return { decision: "allow", reason: "per-item override confirms egress" }
  }

  return { decision: "allow", reason: "no restriction" }
}
