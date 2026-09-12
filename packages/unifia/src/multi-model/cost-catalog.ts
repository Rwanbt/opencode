/**
 * multi-model/cost-catalog.ts — TEAM-B03
 *
 * Read-only cost catalog for the invocation layer. Resolves per-model cost
 * rates and computes cost for a given TokenUsage.
 *
 * Doctrine (plan directeur — single source of truth for model costs): the
 * ONLY authoritative store of model pricing is the C01 model-intelligence
 * registry (packages/unifia/src/model-intelligence/registry.ts). This
 * module never defines a second/static cost table — it is a pure
 * lookup + arithmetic shell around whatever rates it is handed.
 *
 * Design note — resolving two constraints that would otherwise conflict:
 *   (a) acceptance criterion: "CostCatalog: lecture seule via C01 registry,
 *       zéro duplication" (must ultimately read C01's pricing data).
 *   (b) acceptance criterion: "Imports interdits depuis .../model-intelligence/"
 *       (zero import of model-intelligence/** from anywhere in multi-model/).
 *   Both hold simultaneously only via dependency injection: this module
 *   accepts a `CostLookupFn` as a constructor parameter instead of
 *   importing model-intelligence/registry.ts directly. Production wiring
 *   (outside multi-model/, e.g. a future integration/bootstrap card) binds
 *   a real C01-backed lookup via `costLookupFromRegistry(...)`, passing in
 *   an adapter function shaped like `Registry.getModel` (its Effect
 *   unwrapped to a Promise by the caller). Tests inject an in-memory fake.
 *   `RegistryPricingLike`/`RegistryModelLike` below are structural types
 *   only (mirroring model-intelligence/schema.ts's `Pricing` shape) — no
 *   value, schema, or table from that module is duplicated here.
 *
 * Hard constraints (B03 scope manifest):
 *   - Never imports packages/unifia/src/team/** (frozen).
 *   - Never imports packages/unifia/src/collective/** (frozen).
 *   - Never imports packages/unifia/src/model-intelligence/** (frozen).
 *   - Consumes ModelRef/TokenUsage from ./types (B01) only.
 */

import type { ModelRef, TokenUsage } from "./types"
import { computeCost, type CostRates, type NormalizedCost } from "./usage-normalizer"

// ---------------------------------------------------------------------------
// Injected lookup contract
// ---------------------------------------------------------------------------

/**
 * A cost-rate lookup function. Implementations are supplied by the caller
 * (dependency injection) — this module never imports a concrete registry.
 * Return null when the model is unknown to the backing source.
 */
export type CostLookupFn = (model: ModelRef) => Promise<CostRates | null> | CostRates | null

/**
 * Structural mirror of C01's `Model.pricing` field
 * (model-intelligence/schema.ts `Pricing`), declared locally purely to
 * type-check the adapter below. Not a re-definition of the registry: no
 * value, default, or validation rule is duplicated — only the field shape
 * needed to type an injected function's return value.
 */
export interface RegistryPricingLike {
  readonly currency: string
  readonly unit: "per_1m_tokens" | "per_1k_tokens" | "per_request"
  readonly input: number
  readonly output: number
  readonly cacheRead?: number | null
  readonly cacheWrite?: number | null
  readonly reasoning?: number | null
}

export interface RegistryModelLike {
  readonly pricing: RegistryPricingLike
}

/**
 * Shape-compatible with C01's `Registry.getModel`, but decoupled: the
 * caller supplies its own adapter (e.g. wrapping
 * `Effect.runPromise(Registry.getModel(providerID, modelID))`) — this
 * module has no compile-time or runtime dependency on model-intelligence/.
 */
export type RegistryGetModelFn = (providerID: string, modelID: string) => Promise<RegistryModelLike | null>

/**
 * Adapt a C01-shaped `getModel` function into a CostLookupFn. Call-site
 * (outside multi-model/) is responsible for supplying a function with this
 * shape; this module only performs the field mapping.
 */
export function costLookupFromRegistry(getModel: RegistryGetModelFn): CostLookupFn {
  return async (model: ModelRef) => {
    const record = await getModel(model.providerID, model.modelID)
    if (!record) return null
    const p = record.pricing
    return {
      currency: p.currency,
      unit: p.unit,
      input: p.input,
      output: p.output,
      cacheRead: p.cacheRead ?? null,
      cacheWrite: p.cacheWrite ?? null,
      reasoning: p.reasoning ?? null,
    }
  }
}

// ---------------------------------------------------------------------------
// CostCatalog
// ---------------------------------------------------------------------------

export interface CostCatalog {
  /** Resolve cost rates for a model. Returns null when unknown. */
  getRates(model: ModelRef): Promise<CostRates | null>
  /**
   * Resolve rates for `model` and compute cost for `usage`. Returns null
   * when rates are unknown — never fabricates a zero-cost result for an
   * unknown model.
   */
  computeCostFor(model: ModelRef, usage: TokenUsage): Promise<NormalizedCost | null>
}

/**
 * Build a CostCatalog around an injected lookup function. The lookup is
 * intentionally opaque here: production wiring supplies
 * `costLookupFromRegistry(...)` bound to the real C01 registry; tests
 * supply a fake in-memory lookup (see cost-catalog coverage in
 * test/multi-model/invoker.test.ts).
 */
export function createCostCatalog(lookup: CostLookupFn): CostCatalog {
  return {
    async getRates(model) {
      return await lookup(model)
    },
    async computeCostFor(model, usage) {
      const rates = await lookup(model)
      return computeCost(usage, rates)
    },
  }
}
