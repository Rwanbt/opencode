/**
 * multi-model/usage-normalizer.ts — TEAM-B03
 *
 * Normalizes per-provider usage payloads (raw token counts under varying
 * field names, timing) into the canonical TokenUsage shape (B01) plus a
 * canonical cost/duration envelope consumed by ModelInvoker and CostCatalog.
 *
 * Providers report usage under different field names (OpenAI-style:
 * prompt_tokens/completion_tokens; Anthropic-style: input_tokens/
 * output_tokens/cache_creation_input_tokens; ...). This module is the single
 * place that reconciles those shapes into B01's TokenUsage — callers must
 * never re-implement this mapping elsewhere (doctrine: one canonical usage
 * shape per plan directeur §26).
 *
 * Hard constraints (B03 scope manifest):
 *   - Never imports packages/unifia/src/team/** (frozen).
 *   - Never imports packages/unifia/src/collective/** (frozen).
 *   - Never imports packages/unifia/src/model-intelligence/** (frozen;
 *     cost RATES are looked up by cost-catalog.ts, not here — this module
 *     only computes cost given already-resolved rates).
 *   - Consumes TokenUsage/TokenUsageSchema from ./types (B01) only.
 */

import { TokenUsageSchema, type TokenUsage } from "./types"

// ---------------------------------------------------------------------------
// Raw usage input (permissive — covers common provider field-naming schemes)
// ---------------------------------------------------------------------------

export interface RawUsageInput {
  readonly inputTokens?: number | null
  readonly promptTokens?: number | null
  readonly outputTokens?: number | null
  readonly completionTokens?: number | null
  readonly cacheReadTokens?: number | null
  readonly cacheReadInputTokens?: number | null
  readonly cacheWriteTokens?: number | null
  readonly cacheCreationInputTokens?: number | null
  readonly reasoningTokens?: number | null
}

export interface RawTimingInput {
  readonly durationMs?: number | null
  readonly startedAtMs?: number | null
  readonly endedAtMs?: number | null
}

// ---------------------------------------------------------------------------
// Cost rates + normalized cost (currency-aware, provider-agnostic)
// ---------------------------------------------------------------------------

export const COST_UNIT_VALUES = ["per_1m_tokens", "per_1k_tokens", "per_request"] as const
export type CostUnit = (typeof COST_UNIT_VALUES)[number]

export interface CostRates {
  readonly currency: string
  readonly unit: CostUnit
  readonly input: number
  readonly output: number
  readonly cacheRead?: number | null
  readonly cacheWrite?: number | null
  readonly reasoning?: number | null
}

export interface NormalizedCost {
  readonly currency: string
  readonly inputCost: number
  readonly outputCost: number
  readonly cacheReadCost: number
  readonly cacheWriteCost: number
  readonly reasoningCost: number
  readonly totalCost: number
}

export interface NormalizedUsage {
  readonly tokens: TokenUsage
  readonly cost: NormalizedCost | null
  readonly durationMs: number
}

// ---------------------------------------------------------------------------
// Token normalization
// ---------------------------------------------------------------------------

function firstDefined(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (v !== null && v !== undefined) return v
  }
  return null
}

/**
 * Normalize a raw per-provider usage payload into the canonical TokenUsage
 * shape (B01). Required counters (input/output) default to 0 when absent;
 * optional counters (cache/reasoning) default to null, matching
 * TokenUsageSchema. Negative values (malformed provider payloads) are
 * clamped to 0 rather than propagated.
 */
export function normalizeTokenUsage(raw: RawUsageInput): TokenUsage {
  const inputTokens = firstDefined(raw.inputTokens, raw.promptTokens) ?? 0
  const outputTokens = firstDefined(raw.outputTokens, raw.completionTokens) ?? 0
  const cacheReadTokens = firstDefined(raw.cacheReadTokens, raw.cacheReadInputTokens)
  const cacheWriteTokens = firstDefined(raw.cacheWriteTokens, raw.cacheCreationInputTokens)
  const reasoningTokens = firstDefined(raw.reasoningTokens)

  return TokenUsageSchema.parse({
    inputTokens: Math.max(0, inputTokens),
    outputTokens: Math.max(0, outputTokens),
    cacheReadTokens: cacheReadTokens === null ? null : Math.max(0, cacheReadTokens),
    cacheWriteTokens: cacheWriteTokens === null ? null : Math.max(0, cacheWriteTokens),
    reasoningTokens: reasoningTokens === null ? null : Math.max(0, reasoningTokens),
  })
}

/**
 * Normalize a timing payload into a single non-negative duration in
 * milliseconds. Prefers an explicit durationMs; falls back to
 * (endedAtMs - startedAtMs); defaults to 0 when neither is available.
 */
export function normalizeDurationMs(raw: RawTimingInput): number {
  if (raw.durationMs !== null && raw.durationMs !== undefined) {
    return Math.max(0, raw.durationMs)
  }
  if (
    raw.startedAtMs !== null &&
    raw.startedAtMs !== undefined &&
    raw.endedAtMs !== null &&
    raw.endedAtMs !== undefined
  ) {
    return Math.max(0, raw.endedAtMs - raw.startedAtMs)
  }
  return 0
}

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

function unitDivisor(unit: CostUnit): number {
  switch (unit) {
    case "per_1m_tokens":
      return 1_000_000
    case "per_1k_tokens":
      return 1_000
    case "per_request":
      return 1
  }
}

/**
 * Compute cost for a token usage against provider cost rates. Returns null
 * when no rates are known (e.g. a CostCatalog lookup miss) — callers must
 * treat "unknown cost" distinctly from "zero cost", never silently
 * defaulting a missing rate to zero.
 *
 * `per_request` rates are flat per-call charges independent of token
 * counts: totalCost = input + output, attributed to inputCost/outputCost
 * respectively so downstream reporting can still sum by category.
 */
export function computeCost(usage: TokenUsage, rates: CostRates | null): NormalizedCost | null {
  if (!rates) return null

  if (rates.unit === "per_request") {
    const inputCost = rates.input
    const outputCost = rates.output
    return {
      currency: rates.currency,
      inputCost,
      outputCost,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      reasoningCost: 0,
      totalCost: inputCost + outputCost,
    }
  }

  const divisor = unitDivisor(rates.unit)
  const inputCost = (usage.inputTokens / divisor) * rates.input
  const outputCost = (usage.outputTokens / divisor) * rates.output
  const cacheReadCost =
    rates.cacheRead != null && usage.cacheReadTokens != null
      ? (usage.cacheReadTokens / divisor) * rates.cacheRead
      : 0
  const cacheWriteCost =
    rates.cacheWrite != null && usage.cacheWriteTokens != null
      ? (usage.cacheWriteTokens / divisor) * rates.cacheWrite
      : 0
  const reasoningCost =
    rates.reasoning != null && usage.reasoningTokens != null
      ? (usage.reasoningTokens / divisor) * rates.reasoning
      : 0

  return {
    currency: rates.currency,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    reasoningCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost,
  }
}

// ---------------------------------------------------------------------------
// Combined normalization entrypoint
// ---------------------------------------------------------------------------

/**
 * Normalize a raw provider usage payload + timing into the full canonical
 * envelope (tokens, cost, duration). `rates` is optional — pass the result
 * of a CostCatalog lookup, or omit/null when cost is unknown.
 */
export function normalizeUsage(raw: RawUsageInput & RawTimingInput, rates?: CostRates | null): NormalizedUsage {
  const tokens = normalizeTokenUsage(raw)
  const durationMs = normalizeDurationMs(raw)
  const cost = computeCost(tokens, rates ?? null)
  return { tokens, cost, durationMs }
}
