/* SPDX-License-Identifier: MIT */
/**
 * The egress brand is unforgeable (card C32).
 *
 * Every defect the three counter-reviews found was one defect wearing
 * different coats: a value that should be the result of a decision could be
 * written directly. The router fabricated `restriction: "allow"`; `get()`
 * did the same one layer up after the router was fixed; `runProbes` turned
 * an empty evidence into a PASS; the MCP daemon lent its own token to an
 * anonymous call. Each fix closed the occurrence, not the constructibility.
 *
 * These assertions are type-level. They fail the typecheck, not the runner,
 * which is the point: the guarantee is that unchecked code stops compiling.
 */

import { describe, it, expect } from "bun:test"
import { clearForEgress, decideEgress, type ClearedItem } from "../../../src/knowledge/policy/egress.js"
import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"

const item: ContextItem = {
  ref: { id: "0190d2c0-7b00-7000-8000-000000000001", locator: "n.md" },
  source: "personal",
  type: "decision",
  trust: "verified",
  authority: "user",
  restriction: "allow",
  relevance: 1,
  tokenCost: 0,
  contentHash: "a".repeat(64),
  snippet: "body",
  reason: "test",
}

const localPlan: ProviderDestinationPlan = {
  providerId: "cli",
  destinationKind: "local",
  defaultRestriction: "allow",
}

describe("C32 — a cleared item cannot be fabricated", () => {
  it("refuses to accept a plain ContextItem where a ClearedItem is required", () => {
    // @ts-expect-error a ContextItem is not cleared until the guard says so
    const forged: ClearedItem = item
    expect(forged).toBeDefined()
  })

  it("refuses an object literal carrying a permissive restriction", () => {
    // @ts-expect-error writing `restriction: "allow"` does not clear anything
    const forged: ClearedItem = { ...item, restriction: "allow" }
    expect(forged).toBeDefined()
  })

  it("yields a cleared item only through the guard", () => {
    const verdict = clearForEgress({ item, plan: localPlan })
    expect(verdict.cleared).toBe(true)
    if (verdict.cleared) {
      // Assignable precisely because the guard produced it.
      const ok: ClearedItem = verdict.item
      expect(ok.ref.locator).toBe("n.md")
    }
  })

  it("withholds the brand when the guard refuses", () => {
    const denied = clearForEgress({
      item: { ...item, restriction: "deny" },
      plan: { providerId: "cloud", destinationKind: "remote", defaultRestriction: "allow" },
    })
    expect(denied.cleared).toBe(false)
    // There is no branch here that hands back a ClearedItem: the union makes
    // the refusal path unable to produce one.
    expect(denied.result.decision).toBe("deny")
  })

  it("keeps decideEgress pure and available for pure assertions", () => {
    expect(decideEgress({ item, plan: localPlan }).decision).toBe("allow")
  })
})
