/**
 * Pricing — historized model price snapshots + stale policy (TEAM-C04).
 *
 * Builds on top of the C01 registry (schema.ts `isoUtcNow`, and the shape of
 * the per-model `Pricing` currently embedded on `Model.pricing`) to add what
 * the registry itself does not provide: a full price *history* with
 * temporal bounds, an explicit staleness policy, and risk-aware enforcement.
 *
 * Doctrine (card TEAM-C04):
 *   - Full history : every price entry carries `validFrom`/`validTo` — no
 *     price ever exists without temporal bounds. The registry only ever
 *     sees "the current price"; this module is the source of truth for
 *     "what was the price at time T".
 *   - Stale policy, never silent : a query result always carries an
 *     explicit `stale: boolean`. Callers never have to guess whether the
 *     data they received is fresh — the flag is set every time, not only
 *     when convenient.
 *   - Risk-level enforcement : `low`/`medium` risk callers may proceed with
 *     stale or unknown pricing (the explicit flag lets them decide what to
 *     do). `high`/`critical` risk callers get a hard block — a typed error
 *     is thrown, never a console warning that can be ignored.
 *   - Currency strictness : currency codes are validated against a curated
 *     ISO 4217 allowlist (shape regex alone is not enough — `"ZZZ"` has the
 *     right shape but is not a real currency).
 *   - Historical recomputation : given a past timestamp, the snapshot that
 *     was applicable *then* is used, never the current price.
 *   - Diff events : every call to `record()` that changes a price produces
 *     a structured `PriceDiffEvent` (old value, new value, timestamp,
 *     source) — no silent price mutation.
 *
 * Invariants (mirrors C01/C02/C03 doctrine — cf. registry.ts / connectors/types.ts):
 *   - This module never imports the multi-model substrate or the team
 *     namespace (kept fully within model-intelligence/).
 *   - `providerID`/`modelID` are plain strings (same convention as
 *     `connectors/types.ts::PricingEntry`) — this module does not redefine
 *     model/provider identity, it only references it.
 *   - No secret handling here — this module is purely numeric pricing data.
 *
 * Allowed by TEAM-C04 scope manifest :
 *   - creation : packages/unifia/src/model-intelligence/pricing.ts
 */

import z from "zod"
import { NamedError } from "@unifia/util/error"
import { isoUtcNow } from "./schema"
import { InvalidCurrencyError, InvalidPricingError } from "./errors"

// =====================================================================
// 1. Constants & primitive validation
// =====================================================================

/** ISO 8601 UTC, optionally with fractional seconds (mirrors schema.ts). */
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/** Shape check only — 3 uppercase letters. Membership is checked separately. */
const ISO_4217_SHAPE = /^[A-Z]{3}$/

/**
 * Curated allowlist of active ISO 4217 alphabetic currency codes relevant to
 * LLM provider billing. Shape-only validation (`/^[A-Z]{3}$/`) would accept
 * "ZZZ" as valid; this closes that gap. Extend deliberately — never widen to
 * "any 3 uppercase letters" as a shortcut.
 */
export const ISO_4217_CODES: ReadonlySet<string> = new Set([
  "USD", "EUR", "GBP", "JPY", "CNY", "CHF", "CAD", "AUD", "NZD",
  "INR", "KRW", "SGD", "HKD", "SEK", "NOK", "DKK", "PLN", "CZK",
  "HUF", "RON", "BGN", "HRK", "ISK", "TRY", "ZAR", "BRL", "MXN",
  "ARS", "CLP", "COP", "PEN", "ILS", "AED", "SAR", "QAR", "KWD",
  "BHD", "OMR", "THB", "MYR", "IDR", "PHP", "VND", "PKR", "BDT",
  "EGP", "NGN", "KES", "GHS", "TWD", "RUB", "UAH",
])

/** Default freshness window: 30 days. Overridable per `PricingStore`. */
export const DEFAULT_FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

// =====================================================================
// 2. Core types
// =====================================================================

/**
 * Risk level of the context requesting a price. `high`/`critical` contexts
 * (e.g. billing, budget enforcement, invoicing) may never silently use
 * stale or unknown pricing — see `isBlockingRisk`.
 */
export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

/**
 * Cost unit — explicit in the type, never implicit. Mirrors
 * `schema.ts::Pricing.unit` / `connectors/types.ts::PricingEntry.unit`.
 */
export const PricingUnitSchema = z.enum(["per_1k_tokens", "per_1m_tokens", "per_request"])
export type PricingUnit = z.infer<typeof PricingUnitSchema>

export interface PriceComponents {
  input: number
  output: number
  cacheRead: number | null
  cacheWrite: number | null
  reasoning: number | null
}

/**
 * One historized price snapshot for a (providerID, modelID) pair.
 *
 * `validFrom`/`validTo` are the temporal bounds of applicability —
 * `validTo === null` means "still the current price as of the last
 * `record()` call" (it gets closed the moment a newer snapshot is
 * recorded, never left open forever by omission).
 */
export interface PriceSnapshot {
  providerID: string
  modelID: string
  currency: string
  unit: PricingUnit
  components: PriceComponents
  /** ISO 8601 UTC — inclusive start of applicability. */
  validFrom: string
  /** ISO 8601 UTC — exclusive end of applicability, or null if still open. */
  validTo: string | null
  /** Where this price came from (connector id, "manual", source url, ...). */
  source: string
  /** ISO 8601 UTC — when this snapshot was recorded into history (audit). */
  recordedAtUTC: string
}

export interface PriceUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** Structured diff emitted whenever `record()` changes a price. */
export interface PriceDiffEvent {
  type: "price.created" | "price.updated"
  providerID: string
  modelID: string
  /** ISO 8601 UTC — the new snapshot's `validFrom` (= when the change applies). */
  atUTC: string
  source: string
  oldValue: PriceComponents | null
  newValue: PriceComponents
  oldCurrency: string | null
  newCurrency: string
  oldUnit: PricingUnit | null
  newUnit: PricingUnit
}

export interface RecordPriceInput {
  providerID: string
  modelID: string
  currency: string
  unit: PricingUnit
  components: {
    input: number
    output: number
    cacheRead?: number | null
    cacheWrite?: number | null
    reasoning?: number | null
  }
  /** ISO 8601 UTC. Defaults to `isoUtcNow()` if omitted. */
  validFrom?: string
  source: string
}

/**
 * Result of a price lookup (current or historical). `stale` is always set
 * explicitly — never omitted, never defaulted to `false` when unknown.
 * `stale` only reflects freshness for "current" lookups (`atUTC` omitted at
 * the `lookupPrice` call site); historical lookups return `stale: false`
 * because they answer "what was true then", not "is this still accurate".
 */
export interface PriceLookupResult {
  snapshot: PriceSnapshot | null
  stale: boolean
  unknown: boolean
  ageMs: number | null
  atUTC: string
}

export interface PriceComputationCosts {
  input: number
  output: number
  cacheRead: number | null
  cacheWrite: number | null
  reasoning: number | null
  total: number
}

export interface PriceComputationResult {
  providerID: string
  modelID: string
  currency: string | null
  unit: PricingUnit | null
  costs: PriceComputationCosts | null
  snapshot: PriceSnapshot | null
  stale: boolean
  unknown: boolean
  ageMs: number | null
  atUTC: string
}

// =====================================================================
// 3. Typed errors
//
// Currency and per-field numeric validation reuse the existing C01
// `InvalidCurrencyError` / `InvalidPricingError` (single authoritative
// source for those two concerns — see errors.ts). The stale/unknown
// blocking errors and the temporal-shape error below are new concepts
// introduced by this card and owned here.
// =====================================================================

export const InvalidPriceSnapshotError = NamedError.create(
  "InvalidPriceSnapshotError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    reason: z.enum([
      "invalid_validFrom",
      "invalid_validTo",
      "validTo_before_validFrom",
      "empty_provider_id",
      "empty_model_id",
      "empty_source",
      "non_monotonic_history",
    ]),
    message: z.string(),
  }),
)

export const StalePriceBlockedError = NamedError.create(
  "StalePriceBlockedError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    riskLevel: RiskLevelSchema,
    ageMs: z.number().int().nonnegative(),
    freshnessWindowMs: z.number().int().positive(),
    snapshotValidFrom: z.string(),
    message: z.string(),
  }),
)

export const UnknownPriceBlockedError = NamedError.create(
  "UnknownPriceBlockedError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    riskLevel: RiskLevelSchema,
    atUTC: z.string(),
    message: z.string(),
  }),
)

// =====================================================================
// 4. Currency & numeric validation
// =====================================================================

/**
 * Strictly validates an ISO 4217 currency code : shape (3 uppercase
 * letters) AND membership in the curated allowlist. Throws the shared
 * `InvalidCurrencyError` (C01) rather than a new type — currency validity
 * is a single, already-owned concern.
 */
export function parseCurrencyCode(code: string): string {
  if (!ISO_4217_SHAPE.test(code)) {
    throw new InvalidCurrencyError({
      currency: code,
      expected: "ISO 4217 alphabetic code: exactly 3 uppercase letters (e.g. USD, EUR)",
    })
  }
  if (!ISO_4217_CODES.has(code)) {
    throw new InvalidCurrencyError({
      currency: code,
      expected: "a recognized ISO 4217 currency code present in ISO_4217_CODES",
    })
  }
  return code
}

function assertNonNegativeComponent(
  modelID: string,
  field: "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning",
  value: number | null,
): void {
  if (value === null) return
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidPricingError({
      modelID,
      field,
      message: `pricing.${field} must be a finite non-negative number, got ${value}`,
    })
  }
}

function assertValidTimestamp(providerID: string, modelID: string, field: "validFrom" | "validTo", value: string): void {
  if (!ISO_8601_UTC.test(value)) {
    throw new InvalidPriceSnapshotError({
      providerID,
      modelID,
      reason: field === "validFrom" ? "invalid_validFrom" : "invalid_validTo",
      message: `${field} must be ISO 8601 UTC (e.g. 2026-01-15T10:00:00Z), got "${value}"`,
    })
  }
}

// =====================================================================
// 5. Time helpers
// =====================================================================

/** Epoch ms for an ISO 8601 UTC string. Never compare ISO strings lexically. */
function toEpochMs(iso: string): number {
  return new Date(iso).getTime()
}

function isBlockingRisk(riskLevel: RiskLevel): boolean {
  return riskLevel === "high" || riskLevel === "critical"
}

function unitDivisor(unit: PricingUnit): number {
  switch (unit) {
    case "per_1k_tokens":
      return 1_000
    case "per_1m_tokens":
      return 1_000_000
    case "per_request":
      return 1
  }
}

// =====================================================================
// 6. PricingStore — in-memory historized pricing with stale policy
// =====================================================================

export interface PricingStoreOptions {
  /** How long a "current" snapshot stays fresh before `stale: true`. */
  freshnessWindowMs?: number
}

function historyKey(providerID: string, modelID: string): string {
  return `${providerID}::${modelID}`
}

/**
 * Finds the snapshot applicable at `atUTC` within an already
 * chronologically-sorted list: `validFrom <= atUTC < validTo` (or
 * `validTo === null` for the still-open snapshot).
 */
function findApplicableSnapshot(list: readonly PriceSnapshot[], atUTC: string): PriceSnapshot | null {
  const atMs = toEpochMs(atUTC)
  for (const snapshot of list) {
    const fromMs = toEpochMs(snapshot.validFrom)
    const toMs = snapshot.validTo === null ? null : toEpochMs(snapshot.validTo)
    if (fromMs <= atMs && (toMs === null || atMs < toMs)) return snapshot
  }
  return null
}

/**
 * Historized pricing store : `record()` appends a bounded snapshot (closing
 * whichever snapshot was previously open) and returns a structured diff
 * event ; `lookupPrice()` / `computeCost()` resolve either the current
 * price (with staleness evaluated against `freshnessWindowMs`) or the price
 * applicable at an arbitrary past timestamp (historical recomputation,
 * never stale by construction).
 */
export class PricingStore {
  private readonly history = new Map<string, PriceSnapshot[]>()
  private readonly diffLog: PriceDiffEvent[] = []
  private readonly listeners: Array<(event: PriceDiffEvent) => void> = []
  private readonly freshnessWindowMs: number

  constructor(options: PricingStoreOptions = {}) {
    this.freshnessWindowMs = options.freshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS
  }

  getFreshnessWindowMs(): number {
    return this.freshnessWindowMs
  }

  /** Subscribe to diff events. Returns an unsubscribe function. */
  onDiff(listener: (event: PriceDiffEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  /** Full recorded diff log (audit trail), optionally filtered by model. */
  getDiffEvents(providerID?: string, modelID?: string): PriceDiffEvent[] {
    if (!providerID) return [...this.diffLog]
    return this.diffLog.filter((e) => e.providerID === providerID && (!modelID || e.modelID === modelID))
  }

  /** Full price history for a (providerID, modelID) pair, chronological. */
  historyFor(providerID: string, modelID: string): PriceSnapshot[] {
    return [...(this.history.get(historyKey(providerID, modelID)) ?? [])]
  }

  /**
   * Records a new price snapshot. Closes the previously open snapshot (if
   * any) at the new snapshot's `validFrom`, then appends the new open
   * snapshot. Always produces a `PriceDiffEvent` — creation counts as a
   * change from `null`.
   */
  record(input: RecordPriceInput): { snapshot: PriceSnapshot; diff: PriceDiffEvent } {
    if (input.providerID.length === 0) {
      throw new InvalidPriceSnapshotError({
        providerID: input.providerID,
        modelID: input.modelID,
        reason: "empty_provider_id",
        message: "providerID must not be empty",
      })
    }
    if (input.modelID.length === 0) {
      throw new InvalidPriceSnapshotError({
        providerID: input.providerID,
        modelID: input.modelID,
        reason: "empty_model_id",
        message: "modelID must not be empty",
      })
    }
    if (input.source.length === 0) {
      throw new InvalidPriceSnapshotError({
        providerID: input.providerID,
        modelID: input.modelID,
        reason: "empty_source",
        message: "source must not be empty (diff events must be attributable)",
      })
    }

    const currency = parseCurrencyCode(input.currency)
    assertNonNegativeComponent(input.modelID, "input", input.components.input)
    assertNonNegativeComponent(input.modelID, "output", input.components.output)
    assertNonNegativeComponent(input.modelID, "cacheRead", input.components.cacheRead ?? null)
    assertNonNegativeComponent(input.modelID, "cacheWrite", input.components.cacheWrite ?? null)
    assertNonNegativeComponent(input.modelID, "reasoning", input.components.reasoning ?? null)

    const validFrom = input.validFrom ?? isoUtcNow()
    assertValidTimestamp(input.providerID, input.modelID, "validFrom", validFrom)

    const key = historyKey(input.providerID, input.modelID)
    const list = this.history.get(key) ?? []
    const openIndex = list.findIndex((s) => s.validTo === null)
    const previousOpen = openIndex >= 0 ? list[openIndex] : null

    if (previousOpen && toEpochMs(validFrom) <= toEpochMs(previousOpen.validFrom)) {
      throw new InvalidPriceSnapshotError({
        providerID: input.providerID,
        modelID: input.modelID,
        reason: "non_monotonic_history",
        message: `new validFrom (${validFrom}) must be strictly after the current open snapshot's validFrom (${previousOpen.validFrom})`,
      })
    }

    const components: PriceComponents = {
      input: input.components.input,
      output: input.components.output,
      cacheRead: input.components.cacheRead ?? null,
      cacheWrite: input.components.cacheWrite ?? null,
      reasoning: input.components.reasoning ?? null,
    }

    const nextList = [...list]
    if (previousOpen && openIndex >= 0) {
      nextList[openIndex] = { ...previousOpen, validTo: validFrom }
    }

    const snapshot: PriceSnapshot = {
      providerID: input.providerID,
      modelID: input.modelID,
      currency,
      unit: input.unit,
      components,
      validFrom,
      validTo: null,
      source: input.source,
      recordedAtUTC: isoUtcNow(),
    }
    nextList.push(snapshot)
    this.history.set(key, nextList)

    const diff: PriceDiffEvent = {
      type: previousOpen ? "price.updated" : "price.created",
      providerID: input.providerID,
      modelID: input.modelID,
      atUTC: validFrom,
      source: input.source,
      oldValue: previousOpen ? previousOpen.components : null,
      newValue: components,
      oldCurrency: previousOpen ? previousOpen.currency : null,
      newCurrency: currency,
      oldUnit: previousOpen ? previousOpen.unit : null,
      newUnit: input.unit,
    }
    this.diffLog.push(diff)
    for (const listener of this.listeners) listener(diff)

    return { snapshot, diff }
  }

  /**
   * Resolves a price snapshot.
   *
   * - `opts.atUTC` omitted → "current" mode: resolves the snapshot
   *   applicable now, and evaluates staleness against `freshnessWindowMs`.
   * - `opts.atUTC` provided → "historical" mode: resolves the snapshot
   *   applicable at that past timestamp; `stale` is always `false` (a
   *   historical answer is correct by construction, not "fresh" or "old").
   *
   * `high`/`critical` risk levels hard-block (throw) on stale or unknown
   * pricing. `low`/`medium` never throw here — they get the explicit
   * `stale`/`unknown` flags instead, so the caller can decide, but the
   * data is never served as if it were silently fresh.
   */
  lookupPrice(providerID: string, modelID: string, opts: { riskLevel: RiskLevel; atUTC?: string }): PriceLookupResult {
    const isHistorical = opts.atUTC !== undefined
    // Full millisecond precision here (not `isoUtcNow()`, which floors to the
    // whole second for storage consistency): flooring "now" for a comparison
    // would make a snapshot recorded moments ago with sub-second precision
    // in its `validFrom` spuriously look "not yet applicable" until the
    // second boundary rolls over. `floor(validFrom) <= trueNow` always holds
    // for anything recorded in the past; only full precision guarantees that.
    const atUTC = opts.atUTC ?? new Date().toISOString()
    const list = this.history.get(historyKey(providerID, modelID)) ?? []
    const applicable = findApplicableSnapshot(list, atUTC)

    if (!applicable) {
      if (isBlockingRisk(opts.riskLevel)) {
        throw new UnknownPriceBlockedError({
          providerID,
          modelID,
          riskLevel: opts.riskLevel,
          atUTC,
          message: `No pricing snapshot available for ${providerID}/${modelID} at ${atUTC}; blocked under risk level "${opts.riskLevel}"`,
        })
      }
      return { snapshot: null, stale: false, unknown: true, ageMs: null, atUTC }
    }

    if (isHistorical) {
      return { snapshot: applicable, stale: false, unknown: false, ageMs: null, atUTC }
    }

    const ageMs = toEpochMs(atUTC) - toEpochMs(applicable.validFrom)
    const stale = ageMs > this.freshnessWindowMs

    if (stale && isBlockingRisk(opts.riskLevel)) {
      throw new StalePriceBlockedError({
        providerID,
        modelID,
        riskLevel: opts.riskLevel,
        ageMs,
        freshnessWindowMs: this.freshnessWindowMs,
        snapshotValidFrom: applicable.validFrom,
        message: `Pricing snapshot for ${providerID}/${modelID} is stale (age=${ageMs}ms > window=${this.freshnessWindowMs}ms); blocked under risk level "${opts.riskLevel}"`,
      })
    }

    return { snapshot: applicable, stale, unknown: false, ageMs, atUTC }
  }

  /**
   * Computes the cost of a usage window using either the current price
   * (default) or the price applicable at `opts.atUTC` (historical
   * recomputation). Delegates staleness/unknown enforcement to
   * `lookupPrice`.
   */
  computeCost(
    providerID: string,
    modelID: string,
    usage: PriceUsage,
    opts: { riskLevel: RiskLevel; atUTC?: string },
  ): PriceComputationResult {
    const lookup = this.lookupPrice(providerID, modelID, opts)

    if (lookup.unknown || !lookup.snapshot) {
      return {
        providerID,
        modelID,
        currency: null,
        unit: null,
        costs: null,
        snapshot: null,
        stale: lookup.stale,
        unknown: true,
        ageMs: lookup.ageMs,
        atUTC: lookup.atUTC,
      }
    }

    const snapshot = lookup.snapshot
    const costs = computeCostsFromComponents(snapshot.components, snapshot.unit, usage)

    return {
      providerID,
      modelID,
      currency: snapshot.currency,
      unit: snapshot.unit,
      costs,
      snapshot,
      stale: lookup.stale,
      unknown: false,
      ageMs: lookup.ageMs,
      atUTC: lookup.atUTC,
    }
  }
}

function computeCostsFromComponents(
  components: PriceComponents,
  unit: PricingUnit,
  usage: PriceUsage,
): PriceComputationCosts {
  const divisor = unitDivisor(unit)
  const costOf = (price: number, tokens: number): number => {
    if (unit === "per_request") return price
    return (tokens * price) / divisor
  }

  const input = costOf(components.input, usage.inputTokens)
  const output = costOf(components.output, usage.outputTokens)
  const cacheRead = components.cacheRead === null ? null : costOf(components.cacheRead, usage.cacheReadTokens ?? 0)
  const cacheWrite = components.cacheWrite === null ? null : costOf(components.cacheWrite, usage.cacheWriteTokens ?? 0)
  const reasoning = components.reasoning === null ? null : costOf(components.reasoning, usage.reasoningTokens ?? 0)

  const total = input + output + (cacheRead ?? 0) + (cacheWrite ?? 0) + (reasoning ?? 0)

  return { input, output, cacheRead, cacheWrite, reasoning, total }
}
