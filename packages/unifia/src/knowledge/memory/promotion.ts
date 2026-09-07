/* SPDX-License-Identifier: MIT */
/**
 * Auto-promotion (P4.2).
 *
 * Per ADR-KNOW-0009 and plan gelé §31, an "auto-promotion" source
 * is a `KnowledgeSource` that is automatically considered
 * `active` without explicit user approval. V1 sources:
 *
 * 1. explicit "remember this" (user command),
 * 2. accepted ADR (`unifia_lifecycle` already `accepted` on import),
 * 3. explicit constraint (`unifia_type: constraint`),
 * 4. KNOWN_FAILURE_PATTERNS import,
 * 5. explicit user preference (`unifia_type: preference`).
 *
 * Everything else goes through the inbox (P4.3).
 */

import type { MemoryType, KnowledgeLifecycleState } from "@unifia/contracts/knowledge"

const AUTO_PROMOTION_TYPES: ReadonlySet<MemoryType> = new Set<MemoryType>([
  "constraint",
  "preference",
  "failure",
  "decision",
])

export interface PromotionDecision {
  autoActive: boolean
  reason: string
}

export function decidePromotion(
  type: MemoryType,
  currentLifecycle: KnowledgeLifecycleState,
  hasExplicitUserApproval: boolean,
  isFromAcceptedAdr: boolean,
): PromotionDecision {
  if (currentLifecycle === "active") {
    return { autoActive: false, reason: "already active" }
  }
  if (hasExplicitUserApproval) {
    return { autoActive: true, reason: "explicit user approval" }
  }
  if (isFromAcceptedAdr) {
    return { autoActive: true, reason: "from accepted ADR" }
  }
  if (AUTO_PROMOTION_TYPES.has(type)) {
    return { autoActive: true, reason: `auto-promotion type ${type}` }
  }
  return { autoActive: false, reason: "candidate: requires approval" }
}
