/**
 * Tests for the Pricing module (TEAM-C04) — historized price snapshots,
 * explicit stale policy, risk-level enforcement, currency strictness,
 * historical recomputation, and diff event emission.
 */

import { describe, expect, test } from "bun:test"
import {
  PricingStore,
  parseCurrencyCode,
  ISO_4217_CODES,
  DEFAULT_FRESHNESS_WINDOW_MS,
  InvalidPriceSnapshotError,
  StalePriceBlockedError,
  UnknownPriceBlockedError,
  type RiskLevel,
  type RecordPriceInput,
} from "../../src/model-intelligence/pricing"
import { InvalidCurrencyError, InvalidPricingError } from "../../src/model-intelligence/errors"

const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"]
const BLOCKING_RISK_LEVELS: RiskLevel[] = ["high", "critical"]
const NON_BLOCKING_RISK_LEVELS: RiskLevel[] = ["low", "medium"]

function baseRecord(overrides: Partial<RecordPriceInput> = {}): RecordPriceInput {
  return {
    providerID: "anthropic",
    modelID: "claude-sonnet-5",
    currency: "USD",
    unit: "per_1m_tokens",
    components: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: null },
    source: "models.dev",
    ...overrides,
  }
}

function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

// =====================================================================
// Currency validation
// =====================================================================

describe("parseCurrencyCode — ISO 4217 strict validation", () => {
  test("accepts recognized codes", () => {
    expect(parseCurrencyCode("USD")).toBe("USD")
    expect(parseCurrencyCode("EUR")).toBe("EUR")
    expect(parseCurrencyCode("JPY")).toBe("JPY")
  })

  test("rejects lowercase (shape mismatch)", () => {
    expect(() => parseCurrencyCode("usd")).toThrow(InvalidCurrencyError)
  })

  test("rejects wrong length (shape mismatch)", () => {
    expect(() => parseCurrencyCode("US")).toThrow(InvalidCurrencyError)
    expect(() => parseCurrencyCode("USDD")).toThrow(InvalidCurrencyError)
  })

  test("rejects a shape-valid but non-existent code — proves strict membership, not just regex", () => {
    expect(ISO_4217_CODES.has("ZZZ")).toBe(false)
    expect(() => parseCurrencyCode("ZZZ")).toThrow(InvalidCurrencyError)
  })

  test("error carries the offending currency and an explanatory expectation", () => {
    try {
      parseCurrencyCode("ZZZ")
      throw new Error("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidCurrencyError)
      expect((e as InstanceType<typeof InvalidCurrencyError>).data.currency).toBe("ZZZ")
    }
  })
})

// =====================================================================
// record() — validation
// =====================================================================

describe("PricingStore.record — validation", () => {
  test("rejects empty providerID", () => {
    const store = new PricingStore()
    expect(() => store.record(baseRecord({ providerID: "" }))).toThrow(InvalidPriceSnapshotError)
  })

  test("rejects empty modelID", () => {
    const store = new PricingStore()
    expect(() => store.record(baseRecord({ modelID: "" }))).toThrow(InvalidPriceSnapshotError)
  })

  test("rejects empty source (diff events must be attributable)", () => {
    const store = new PricingStore()
    expect(() => store.record(baseRecord({ source: "" }))).toThrow(InvalidPriceSnapshotError)
  })

  test("rejects negative price component", () => {
    const store = new PricingStore()
    expect(() =>
      store.record(baseRecord({ components: { input: -1, output: 15, cacheRead: null, cacheWrite: null, reasoning: null } })),
    ).toThrow(InvalidPricingError)
  })

  test("rejects malformed validFrom", () => {
    const store = new PricingStore()
    expect(() => store.record(baseRecord({ validFrom: "not-a-date" }))).toThrow(InvalidPriceSnapshotError)
  })

  test("rejects a new snapshot whose validFrom is not strictly after the currently open snapshot", () => {
    const store = new PricingStore()
    store.record(baseRecord({ validFrom: "2026-01-10T00:00:00Z" }))
    expect(() => store.record(baseRecord({ validFrom: "2026-01-05T00:00:00Z" }))).toThrow(InvalidPriceSnapshotError)
    expect(() => store.record(baseRecord({ validFrom: "2026-01-10T00:00:00Z" }))).toThrow(InvalidPriceSnapshotError)
  })

  test("rejects an unrecognized currency via record()", () => {
    const store = new PricingStore()
    expect(() => store.record(baseRecord({ currency: "ZZZ" }))).toThrow(InvalidCurrencyError)
  })
})

// =====================================================================
// Diff events
// =====================================================================

describe("PricingStore — diff events", () => {
  test("first record produces a price.created diff with oldValue null", () => {
    const store = new PricingStore()
    const { diff } = store.record(baseRecord({ validFrom: "2026-01-01T00:00:00Z" }))
    expect(diff.type).toBe("price.created")
    expect(diff.oldValue).toBeNull()
    expect(diff.oldCurrency).toBeNull()
    expect(diff.oldUnit).toBeNull()
    expect(diff.newValue.input).toBe(3)
    expect(diff.source).toBe("models.dev")
    expect(diff.atUTC).toBe("2026-01-01T00:00:00Z")
  })

  test("second record produces a price.updated diff carrying old and new values", () => {
    const store = new PricingStore()
    store.record(baseRecord({ validFrom: "2026-01-01T00:00:00Z" }))
    const { diff } = store.record(
      baseRecord({ validFrom: "2026-02-01T00:00:00Z", components: { input: 4, output: 20, cacheRead: null, cacheWrite: null, reasoning: null } }),
    )
    expect(diff.type).toBe("price.updated")
    expect(diff.oldValue).not.toBeNull()
    expect(diff.oldValue!.input).toBe(3)
    expect(diff.newValue.input).toBe(4)
    expect(diff.atUTC).toBe("2026-02-01T00:00:00Z")
  })

  test("diff log accumulates across multiple price changes, queryable via getDiffEvents", () => {
    const store = new PricingStore()
    store.record(baseRecord({ validFrom: "2026-01-01T00:00:00Z" }))
    store.record(baseRecord({ validFrom: "2026-02-01T00:00:00Z", components: { input: 4, output: 20, cacheRead: null, cacheWrite: null, reasoning: null } }))
    store.record(baseRecord({ providerID: "openai", modelID: "gpt-x", validFrom: "2026-01-01T00:00:00Z" }))

    expect(store.getDiffEvents()).toHaveLength(3)
    expect(store.getDiffEvents("anthropic")).toHaveLength(2)
    expect(store.getDiffEvents("anthropic", "claude-sonnet-5")).toHaveLength(2)
    expect(store.getDiffEvents("openai")).toHaveLength(1)
  })

  test("onDiff listener receives every diff event, and unsubscribe stops delivery", () => {
    const store = new PricingStore()
    const received: string[] = []
    const unsubscribe = store.onDiff((event) => received.push(event.type))

    store.record(baseRecord({ validFrom: "2026-01-01T00:00:00Z" }))
    expect(received).toEqual(["price.created"])

    unsubscribe()
    store.record(baseRecord({ validFrom: "2026-02-01T00:00:00Z" }))
    expect(received).toEqual(["price.created"])
  })

  test("recording a new price closes the previously open snapshot's validTo", () => {
    const store = new PricingStore()
    store.record(baseRecord({ validFrom: "2026-01-01T00:00:00Z" }))
    store.record(baseRecord({ validFrom: "2026-02-01T00:00:00Z" }))

    const history = store.historyFor("anthropic", "claude-sonnet-5")
    expect(history).toHaveLength(2)
    expect(history[0].validTo).toBe("2026-02-01T00:00:00Z")
    expect(history[1].validTo).toBeNull()
  })
})

// =====================================================================
// Historical recomputation
// =====================================================================

describe("PricingStore — historical recomputation", () => {
  test("lookupPrice at a past timestamp resolves the snapshot applicable then, not the current one", () => {
    const store = new PricingStore()
    store.record(baseRecord({ validFrom: "2026-01-01T00:00:00Z", components: { input: 3, output: 15, cacheRead: null, cacheWrite: null, reasoning: null } }))
    store.record(baseRecord({ validFrom: "2026-03-01T00:00:00Z", components: { input: 5, output: 25, cacheRead: null, cacheWrite: null, reasoning: null } }))
    store.record(baseRecord({ validFrom: "2026-06-01T00:00:00Z", components: { input: 8, output: 40, cacheRead: null, cacheWrite: null, reasoning: null } }))

    const inFirstEra = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel: "low", atUTC: "2026-02-15T00:00:00Z" })
    expect(inFirstEra.snapshot!.components.input).toBe(3)
    expect(inFirstEra.stale).toBe(false)

    const inSecondEra = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel: "low", atUTC: "2026-04-01T00:00:00Z" })
    expect(inSecondEra.snapshot!.components.input).toBe(5)

    const inThirdEra = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel: "low", atUTC: "2026-07-01T00:00:00Z" })
    expect(inThirdEra.snapshot!.components.input).toBe(8)
  })

  test("computeCost at a past timestamp uses the historical price, independent of the current price", () => {
    const store = new PricingStore()
    store.record(baseRecord({ validFrom: "2026-01-01T00:00:00Z", components: { input: 3, output: 15, cacheRead: null, cacheWrite: null, reasoning: null } }))
    store.record(baseRecord({ validFrom: "2026-03-01T00:00:00Z", components: { input: 30, output: 150, cacheRead: null, cacheWrite: null, reasoning: null } }))

    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const historical = store.computeCost("anthropic", "claude-sonnet-5", usage, { riskLevel: "low", atUTC: "2026-01-15T00:00:00Z" })
    expect(historical.costs!.input).toBe(3)
    expect(historical.costs!.output).toBe(15)
    expect(historical.costs!.total).toBe(18)

    const current = store.computeCost("anthropic", "claude-sonnet-5", usage, { riskLevel: "low", atUTC: "2026-04-01T00:00:00Z" })
    expect(current.costs!.input).toBe(30)
    expect(current.costs!.output).toBe(150)
  })

  test("a timestamp before any recorded snapshot has no applicable price (unknown, not the earliest one)", () => {
    const store = new PricingStore()
    store.record(baseRecord({ validFrom: "2026-03-01T00:00:00Z" }))

    const result = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel: "low", atUTC: "2026-01-01T00:00:00Z" })
    expect(result.unknown).toBe(true)
    expect(result.snapshot).toBeNull()
  })

  test("historical lookups never report stale — a past answer is correct by construction", () => {
    const store = new PricingStore({ freshnessWindowMs: 1 })
    store.record(baseRecord({ validFrom: "2020-01-01T00:00:00Z" }))
    const result = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel: "critical", atUTC: "2020-06-01T00:00:00Z" })
    expect(result.stale).toBe(false)
    expect(result.snapshot).not.toBeNull()
  })
})

// =====================================================================
// Stale policy — explicit flag, per risk level
// =====================================================================

describe("PricingStore — stale policy is explicit at every risk level", () => {
  test("a fresh snapshot is never flagged stale, at any risk level", () => {
    for (const riskLevel of RISK_LEVELS) {
      const store = new PricingStore()
      store.record(baseRecord({ validFrom: new Date().toISOString() }))
      const result = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel })
      expect(result.stale).toBe(false)
      expect(result.unknown).toBe(false)
    }
  })

  for (const riskLevel of NON_BLOCKING_RISK_LEVELS) {
    test(`risk="${riskLevel}": stale price is served with an explicit stale:true flag, never silently as fresh`, () => {
      const store = new PricingStore({ freshnessWindowMs: 1_000 })
      store.record(baseRecord({ validFrom: msAgo(60_000) }))
      const result = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel })
      expect(result.unknown).toBe(false)
      expect(result.snapshot).not.toBeNull()
      expect(result.stale).toBe(true)
      expect(result.ageMs).toBeGreaterThan(1_000)
    })
  }

  for (const riskLevel of BLOCKING_RISK_LEVELS) {
    test(`risk="${riskLevel}": stale price is a hard block (throws StalePriceBlockedError, never a silent warning)`, () => {
      const store = new PricingStore({ freshnessWindowMs: 1_000 })
      store.record(baseRecord({ validFrom: msAgo(60_000) }))
      expect(() => store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel })).toThrow(StalePriceBlockedError)

      try {
        store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel })
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(StalePriceBlockedError)
        const err = e as InstanceType<typeof StalePriceBlockedError>
        expect(err.data.riskLevel).toBe(riskLevel)
        expect(err.data.freshnessWindowMs).toBe(1_000)
        expect(err.data.ageMs).toBeGreaterThan(1_000)
      }
    })

    test(`risk="${riskLevel}": computeCost also blocks on stale pricing (not just lookupPrice)`, () => {
      const store = new PricingStore({ freshnessWindowMs: 1_000 })
      store.record(baseRecord({ validFrom: msAgo(60_000) }))
      expect(() =>
        store.computeCost("anthropic", "claude-sonnet-5", { inputTokens: 1000, outputTokens: 1000 }, { riskLevel }),
      ).toThrow(StalePriceBlockedError)
    })
  }

  test("staleness boundary: age just under the window is fresh, just over is stale", () => {
    const store = new PricingStore({ freshnessWindowMs: 10_000 })
    store.record(baseRecord({ validFrom: msAgo(5_000) }))
    const fresh = store.lookupPrice("anthropic", "claude-sonnet-5", { riskLevel: "low" })
    expect(fresh.stale).toBe(false)
  })
})

// =====================================================================
// Unknown policy — explicit flag, per risk level
// =====================================================================

describe("PricingStore — unknown price policy at every risk level", () => {
  for (const riskLevel of NON_BLOCKING_RISK_LEVELS) {
    test(`risk="${riskLevel}": unknown price (no history) is reported via explicit unknown:true, not thrown`, () => {
      const store = new PricingStore()
      const result = store.lookupPrice("anthropic", "does-not-exist", { riskLevel })
      expect(result.unknown).toBe(true)
      expect(result.snapshot).toBeNull()
      expect(result.stale).toBe(false)
    })

    test(`risk="${riskLevel}": computeCost on unknown price returns unknown:true with null costs`, () => {
      const store = new PricingStore()
      const result = store.computeCost("anthropic", "does-not-exist", { inputTokens: 100, outputTokens: 100 }, { riskLevel })
      expect(result.unknown).toBe(true)
      expect(result.costs).toBeNull()
      expect(result.currency).toBeNull()
    })
  }

  for (const riskLevel of BLOCKING_RISK_LEVELS) {
    test(`risk="${riskLevel}": unknown price is a hard block (throws UnknownPriceBlockedError)`, () => {
      const store = new PricingStore()
      expect(() => store.lookupPrice("anthropic", "does-not-exist", { riskLevel })).toThrow(UnknownPriceBlockedError)
    })

    test(`risk="${riskLevel}": computeCost also blocks on unknown pricing`, () => {
      const store = new PricingStore()
      expect(() =>
        store.computeCost("anthropic", "does-not-exist", { inputTokens: 100, outputTokens: 100 }, { riskLevel }),
      ).toThrow(UnknownPriceBlockedError)
    })
  }
})

// =====================================================================
// Cost computation
// =====================================================================

describe("PricingStore.computeCost — unit-aware cost computation", () => {
  test("per_1m_tokens: cost scales tokens/1e6 * price", () => {
    const store = new PricingStore()
    store.record(baseRecord({ unit: "per_1m_tokens", components: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: null } }))
    const result = store.computeCost(
      "anthropic",
      "claude-sonnet-5",
      { inputTokens: 2_000_000, outputTokens: 500_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 200_000 },
      { riskLevel: "low" },
    )
    expect(result.costs!.input).toBeCloseTo(6, 6)
    expect(result.costs!.output).toBeCloseTo(7.5, 6)
    expect(result.costs!.cacheRead).toBeCloseTo(0.3, 6)
    expect(result.costs!.cacheWrite).toBeCloseTo(0.75, 6)
    expect(result.costs!.reasoning).toBeNull()
    expect(result.costs!.total).toBeCloseTo(6 + 7.5 + 0.3 + 0.75, 6)
    expect(result.currency).toBe("USD")
    expect(result.unit).toBe("per_1m_tokens")
  })

  test("per_1k_tokens: cost scales tokens/1e3 * price", () => {
    const store = new PricingStore()
    store.record(baseRecord({ unit: "per_1k_tokens", components: { input: 0.003, output: 0.015, cacheRead: null, cacheWrite: null, reasoning: null } }))
    const result = store.computeCost("anthropic", "claude-sonnet-5", { inputTokens: 2000, outputTokens: 1000 }, { riskLevel: "low" })
    expect(result.costs!.input).toBeCloseTo(0.006, 6)
    expect(result.costs!.output).toBeCloseTo(0.015, 6)
  })

  test("per_request: flat cost regardless of token counts", () => {
    const store = new PricingStore()
    store.record(baseRecord({ unit: "per_request", components: { input: 0.006, output: 0, cacheRead: null, cacheWrite: null, reasoning: null } }))
    const small = store.computeCost("anthropic", "claude-sonnet-5", { inputTokens: 1, outputTokens: 0 }, { riskLevel: "low" })
    const large = store.computeCost("anthropic", "claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 500_000 }, { riskLevel: "low" })
    expect(small.costs!.input).toBe(0.006)
    expect(large.costs!.input).toBe(0.006)
  })

  test("null pricing components (e.g. no reasoning tier) yield null cost, not zero silently treated as a real price", () => {
    const store = new PricingStore()
    store.record(baseRecord({ components: { input: 3, output: 15, cacheRead: null, cacheWrite: null, reasoning: null } }))
    const result = store.computeCost("anthropic", "claude-sonnet-5", { inputTokens: 1000, outputTokens: 1000, reasoningTokens: 1000 }, { riskLevel: "low" })
    expect(result.costs!.cacheRead).toBeNull()
    expect(result.costs!.cacheWrite).toBeNull()
    expect(result.costs!.reasoning).toBeNull()
  })
})

// =====================================================================
// Cross-cutting: risk enforcement matrix (every combination explicit)
// =====================================================================

describe("PricingStore — risk-level enforcement matrix", () => {
  test("every risk level is handled explicitly for both stale and unknown states (no silent default)", () => {
    for (const riskLevel of RISK_LEVELS) {
      const unknownStore = new PricingStore()
      if (BLOCKING_RISK_LEVELS.includes(riskLevel)) {
        expect(() => unknownStore.lookupPrice("p", "m", { riskLevel })).toThrow(UnknownPriceBlockedError)
      } else {
        const result = unknownStore.lookupPrice("p", "m", { riskLevel })
        expect(result.unknown).toBe(true)
      }

      const staleStore = new PricingStore({ freshnessWindowMs: 1 })
      staleStore.record(baseRecord({ providerID: "p", modelID: "m", validFrom: msAgo(10_000) }))
      if (BLOCKING_RISK_LEVELS.includes(riskLevel)) {
        expect(() => staleStore.lookupPrice("p", "m", { riskLevel })).toThrow(StalePriceBlockedError)
      } else {
        const result = staleStore.lookupPrice("p", "m", { riskLevel })
        expect(result.stale).toBe(true)
      }
    }
  })
})

// =====================================================================
// Defaults / options
// =====================================================================

describe("PricingStore — defaults", () => {
  test("default freshness window is 30 days", () => {
    expect(DEFAULT_FRESHNESS_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000)
    const store = new PricingStore()
    expect(store.getFreshnessWindowMs()).toBe(DEFAULT_FRESHNESS_WINDOW_MS)
  })

  test("custom freshness window is honored", () => {
    const store = new PricingStore({ freshnessWindowMs: 5_000 })
    expect(store.getFreshnessWindowMs()).toBe(5_000)
  })

  test("record() defaults validFrom to now when omitted", () => {
    const store = new PricingStore()
    const before = Date.now()
    const { snapshot } = store.record(baseRecord())
    const after = Date.now()
    const validFromMs = new Date(snapshot.validFrom).getTime()
    expect(validFromMs).toBeGreaterThanOrEqual(before - 1000)
    expect(validFromMs).toBeLessThanOrEqual(after + 1000)
  })
})
