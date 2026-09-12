/* SPDX-License-Identifier: MIT */
/**
 * Context Inspector — surfaces the inclusion/exclusion rationale
 * for each item in a `ContextPack`. See runbook §11 P1.4.
 *
 * The Inspector never modifies the pack. It is read-only.
 */

import type {
  ContextItem,
  ContextPack,
  ProviderDestinationPlan,
  RestrictionLevel,
} from "@unifia/contracts/knowledge"
import { decideEgress } from "../policy/egress.js"

export interface InspectorRow {
  id: string
  locator: string
  source: string
  type: string
  trust: ContextItem["trust"]
  authority: ContextItem["authority"]
  restriction: RestrictionLevel
  destination: string
  decision: "allow" | "deny"
  decisionReason: string
  relevance: number
  tokenCost: number
  contentHash: string
  reason: string
}

export interface InspectorView {
  destination: string
  defaultRestriction: RestrictionLevel
  rows: InspectorRow[]
  totalTokenCost: number
  tokenBudget: number
  diagnostics: ContextPack["diagnostics"]
}

export function inspect(
  pack: ContextPack,
  plan: ProviderDestinationPlan,
): InspectorView {
  const rows: InspectorRow[] = pack.items.map((item) => {
    const d = decideEgress({ item, plan })
    return {
      id: item.ref.id,
      locator: item.ref.locator,
      source: item.source,
      type: item.type,
      trust: item.trust,
      authority: item.authority,
      restriction: item.restriction,
      destination: plan.providerId,
      decision: d.decision,
      decisionReason: d.reason,
      relevance: item.relevance,
      tokenCost: item.tokenCost,
      contentHash: item.contentHash,
      reason: item.reason,
    }
  })
  return {
    destination: plan.providerId,
    defaultRestriction: plan.defaultRestriction,
    rows,
    totalTokenCost: pack.diagnostics.totalTokenCost,
    tokenBudget: pack.tokenBudget,
    diagnostics: pack.diagnostics,
  }
}
