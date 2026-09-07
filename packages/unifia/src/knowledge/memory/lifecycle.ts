/* SPDX-License-Identifier: MIT */
/**
 * Memory lifecycle (P4).
 *
 * Per ADR-KNOW-0009: candidate → active → superseded → archived.
 * Transitions are explicit, audited, and refused if unauthorised.
 */

import type {
  KnowledgeId,
  KnowledgeLifecycleState,
  MutationIntent,
  MutationResult,
  MutationKind,
} from "@unifia/contracts/knowledge"

/**
 * The V1 transition table (ADR-KNOW-0009). Single source of truth: the admin
 * matrix renderer imports this rather than keeping its own copy.
 *
 * `superseded -> active` is deliberately absent. ADR-KNOW-0009 shows only
 * `archived --[restore]--> active`, and a superseded note is a traceable
 * historical record reachable through `knowledge_get` (rule 3) — it is not
 * revived. The table previously allowed it while `intentForTransition` had no
 * MutationKind for it, so it was allowed and then refused.
 */
export const VALID_TRANSITIONS: Readonly<
  Record<KnowledgeLifecycleState, readonly KnowledgeLifecycleState[]>
> = {
  candidate: ["active", "archived"],
  active: ["superseded", "archived"],
  superseded: ["archived"],
  archived: ["active"],
}

export interface LifecycleTransition {
  from: KnowledgeLifecycleState
  to: KnowledgeLifecycleState
  /** Audit record. */
  auditId: string
  /** Reason, for audit. */
  reason: string
  /** Source agent / user. */
  source: string
}

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LifecycleError"
  }
}

/** Decide whether a transition is allowed. */
export function isTransitionAllowed(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

/** A transition decision. */
export type TransitionDecision =
  | { allowed: true; intent: MutationIntent }
  | { allowed: false; reason: string }

const VALID_MUTATION_KINDS: MutationKind[] = [
  "create", "update", "delete", "move", "promote", "supersede", "archive", "restore",
]

/** Map a transition to a MutationIntent kind. */
export function intentForTransition(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
  targetId: KnowledgeId,
  expectedVersionHash: string,
  reason: string,
  source: string,
): TransitionDecision {
  if (!isTransitionAllowed(from, to)) {
    return { allowed: false, reason: `transition ${from} -> ${to} is not allowed` }
  }
  const kind: MutationKind | undefined =
    to === "active" && from === "candidate" ? "promote" :
    to === "active" && from === "archived" ? "restore" :
    to === "superseded" ? "supersede" :
    to === "archived" ? "archive" :
    undefined
  if (kind === undefined) {
    return { allowed: false, reason: `no mutation kind for ${from} -> ${to}` }
  }
  if (!VALID_MUTATION_KINDS.includes(kind)) {
    return { allowed: false, reason: `mutation kind ${kind} is not in the V1 set` }
  }
  return {
    allowed: true,
    intent: {
      kind,
      targetId,
      expectedVersionHash: expectedVersionHash as MutationIntent["expectedVersionHash"],
      reason,
      source,
    },
  }
}

/** Construct a MutationResult for a successful transition. */
export function transitionResult(
  auditId: string,
  newLifecycle: KnowledgeLifecycleState,
): MutationResult {
  return { applied: true, newLifecycle, auditId }
}
