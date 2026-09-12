import { createHash } from "node:crypto"

export const BUDGET_TRACKER_SCHEMA_VERSION = "1.0.0"
export const BUDGET_THRESHOLDS = [50, 80, 95, 100] as const
export type BudgetDimension = "phase" | "task" | "provider"
export type BudgetEventThreshold = (typeof BUDGET_THRESHOLDS)[number]

export interface BudgetLimit { readonly maxTokens: number; readonly maxCostUsd: number }
export interface HistoricalPricingSnapshot {
  readonly version: string
  readonly capturedAtUTC: string
  readonly providerID: string
  readonly modelID: string
  readonly inputUsdPerMillionTokens: number
  readonly outputUsdPerMillionTokens: number
}
export interface BudgetTrackerConfig {
  readonly phase: BudgetLimit
  readonly task: BudgetLimit
  readonly provider: Readonly<Record<string, BudgetLimit>>
  readonly pricing: HistoricalPricingSnapshot
  readonly parentSignal?: AbortSignal
}
export interface UsageDelta { readonly inputTokens: number; readonly outputTokens: number }
export interface BudgetUsage { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number; readonly costUsd: number }
export interface BudgetEvent {
  readonly schemaVersion: typeof BUDGET_TRACKER_SCHEMA_VERSION
  readonly threshold: BudgetEventThreshold
  readonly dimension: BudgetDimension
  readonly scopeID: string
  readonly usage: BudgetUsage
  readonly limit: BudgetLimit
  readonly expected: BudgetUsage
  readonly actual: BudgetUsage
}
export interface BudgetOperationContext { readonly signal: AbortSignal; readonly expected: BudgetUsage; readonly providerID: string; readonly modelID: string }
export interface BudgetOperationResult<T> { readonly value: T; readonly actual: BudgetUsage }

export class BudgetExceededError extends Error {
  readonly dimension: BudgetDimension; readonly scopeID: string; readonly expected: BudgetUsage; readonly actual: BudgetUsage; readonly limit: BudgetLimit
  constructor(input: { dimension: BudgetDimension; scopeID: string; expected: BudgetUsage; actual: BudgetUsage; limit: BudgetLimit }) {
    super(`budget exceeded for ${input.dimension}/${input.scopeID}`); this.name = "BudgetExceededError"
    this.dimension = input.dimension; this.scopeID = input.scopeID; this.expected = input.expected; this.actual = input.actual; this.limit = input.limit
  }
}
export class BudgetCancelledError extends Error { constructor(reason = "budget operation cancelled") { super(reason); this.name = "BudgetCancelledError" } }
interface MutableUsage { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }
const zeroUsage = (): MutableUsage => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 })
const asUsage = (v: MutableUsage): BudgetUsage => ({ ...v })
const makeUsage = (inputTokens: number, outputTokens: number, costUsd: number): BudgetUsage => ({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd })
function validateLimit(limit: BudgetLimit, label: string): void {
  if (!Number.isInteger(limit.maxTokens) || limit.maxTokens <= 0) throw new RangeError(`${label}.maxTokens must be positive`)
  if (!Number.isFinite(limit.maxCostUsd) || limit.maxCostUsd <= 0) throw new RangeError(`${label}.maxCostUsd must be positive`)
}
function validatePricing(p: HistoricalPricingSnapshot): void {
  if (!p.version.trim() || !p.providerID.trim() || !p.modelID.trim()) throw new TypeError("pricing snapshot identity is required")
  if (!p.capturedAtUTC.endsWith("Z") || Number.isNaN(Date.parse(p.capturedAtUTC))) throw new TypeError("pricing snapshot must use UTC")
  if (!Number.isFinite(p.inputUsdPerMillionTokens) || p.inputUsdPerMillionTokens < 0 || !Number.isFinite(p.outputUsdPerMillionTokens) || p.outputUsdPerMillionTokens < 0) throw new RangeError("pricing must be non-negative")
}
function validateDelta(d: UsageDelta): void {
  if (!Number.isInteger(d.inputTokens) || d.inputTokens < 0 || !Number.isInteger(d.outputTokens) || d.outputTokens < 0) throw new RangeError("token usage must be non-negative integers")
}
function over(value: BudgetUsage, limit: BudgetLimit): boolean { return value.totalTokens > limit.maxTokens || value.costUsd > limit.maxCostUsd }
function percent(value: BudgetUsage, limit: BudgetLimit): number { return Math.max(value.totalTokens / limit.maxTokens, value.costUsd / limit.maxCostUsd) * 100 }
function crossed(previous: number, current: number): BudgetEventThreshold[] { return BUDGET_THRESHOLDS.filter((threshold) => previous < threshold && current >= threshold) }
function pricingJson(p: HistoricalPricingSnapshot): string { return JSON.stringify({ capturedAtUTC: p.capturedAtUTC, inputUsdPerMillionTokens: p.inputUsdPerMillionTokens, modelID: p.modelID, outputUsdPerMillionTokens: p.outputUsdPerMillionTokens, providerID: p.providerID, version: p.version }) }

export class BudgetTracker {
  readonly pricingSnapshotHash: string
  private readonly config: BudgetTrackerConfig
  private readonly controller = new AbortController()
  private readonly usageByScope = new Map<string, MutableUsage>()
  private readonly emitted = new Set<string>()
  private readonly listeners = new Set<(event: BudgetEvent) => void>()
  private parentAbortHandler: (() => void) | undefined
  constructor(config: BudgetTrackerConfig) {
    validateLimit(config.phase, "phase"); validateLimit(config.task, "task")
    for (const [providerID, limit] of Object.entries(config.provider)) validateLimit(limit, `provider/${providerID}`)
    validatePricing(config.pricing); this.config = config
    this.pricingSnapshotHash = createHash("sha256").update(pricingJson(config.pricing)).digest("hex")
    if (config.parentSignal) {
      this.parentAbortHandler = () => this.cancel("parent signal aborted")
      if (config.parentSignal.aborted) this.parentAbortHandler(); else config.parentSignal.addEventListener("abort", this.parentAbortHandler, { once: true })
    }
  }
  onEvent(listener: (event: BudgetEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  get signal(): AbortSignal { return this.controller.signal }
  cancel(reason = "budget cancelled"): void { if (!this.signal.aborted) this.controller.abort(reason) }
  dispose(): void { if (this.config.parentSignal && this.parentAbortHandler) this.config.parentSignal.removeEventListener("abort", this.parentAbortHandler); this.parentAbortHandler = undefined; this.listeners.clear() }
  snapshot(dimension: BudgetDimension, scopeID: string): BudgetUsage { return asUsage(this.usageByScope.get(this.key(dimension, scopeID)) ?? zeroUsage()) }
  async run<T>(input: { phaseID: string; taskID: string; providerID: string; modelID?: string; expected: UsageDelta; execute: (context: BudgetOperationContext) => Promise<{ value: T; usage: UsageDelta }> }): Promise<BudgetOperationResult<T>> {
    if (this.signal.aborted) throw new BudgetCancelledError(this.signal.reason?.toString())
    validateDelta(input.expected)
    const modelID = input.modelID ?? this.config.pricing.modelID
    if (input.providerID !== this.config.pricing.providerID || modelID !== this.config.pricing.modelID) throw new RangeError("pricing snapshot does not match provider/model")
    const expected = this.toUsage(input.expected)
    const providerLimit = this.config.provider[input.providerID]; if (!providerLimit) throw new RangeError(`no budget configured for provider ${input.providerID}`)
    const scopes: Array<[BudgetDimension, string, BudgetLimit]> = [["phase", input.phaseID, this.config.phase], ["task", input.taskID, this.config.task], ["provider", input.providerID, providerLimit]]
    for (const [dimension, scopeID, limit] of scopes) this.assertWithin(dimension, scopeID, limit, expected)
    const operationController = new AbortController(); const abort = () => operationController.abort(this.signal.reason)
    this.signal.addEventListener("abort", abort, { once: true })
    try {
      const result = await input.execute({ signal: operationController.signal, expected, providerID: input.providerID, modelID })
      if (this.signal.aborted) throw new BudgetCancelledError(this.signal.reason?.toString())
      validateDelta(result.usage); const actual = this.toUsage(result.usage)
      for (const [dimension, scopeID, limit] of scopes) this.assertWithin(dimension, scopeID, limit, actual)
      for (const [dimension, scopeID, limit] of scopes) this.commit(dimension, scopeID, limit, expected, actual)
      return { value: result.value, actual }
    } finally { this.signal.removeEventListener("abort", abort) }
  }
  private commit(dimension: BudgetDimension, scopeID: string, limit: BudgetLimit, expected: BudgetUsage, actual: BudgetUsage): void {
    const key = this.key(dimension, scopeID); const current = this.usageByScope.get(key) ?? zeroUsage(); const previous = asUsage(current)
    const next = makeUsage(current.inputTokens + actual.inputTokens, current.outputTokens + actual.outputTokens, current.costUsd + actual.costUsd); if (over(next, limit)) { this.cancel(`hard budget stop for ${dimension}/${scopeID}`); throw new BudgetExceededError({ dimension, scopeID, expected, actual: next, limit }) }
    this.usageByScope.set(key, { ...next })
    for (const threshold of crossed(percent(previous, limit), percent(next, limit))) {
      const eventKey = `${key}:${threshold}`; if (this.emitted.has(eventKey)) continue; this.emitted.add(eventKey)
      const event: BudgetEvent = { schemaVersion: BUDGET_TRACKER_SCHEMA_VERSION, threshold, dimension, scopeID, usage: next, limit, expected, actual }; for (const listener of this.listeners) listener(event)
    }
  }
  private assertWithin(dimension: BudgetDimension, scopeID: string, limit: BudgetLimit, expected: BudgetUsage): void {
    const current = this.snapshot(dimension, scopeID); const projected = makeUsage(current.inputTokens + expected.inputTokens, current.outputTokens + expected.outputTokens, current.costUsd + expected.costUsd)
    if (over(projected, limit)) { this.cancel(`hard budget stop for ${dimension}/${scopeID}`); throw new BudgetExceededError({ dimension, scopeID, expected, actual: projected, limit }) }
  }
  private toUsage(delta: UsageDelta): BudgetUsage { return makeUsage(delta.inputTokens, delta.outputTokens, delta.inputTokens * this.config.pricing.inputUsdPerMillionTokens / 1_000_000 + delta.outputTokens * this.config.pricing.outputUsdPerMillionTokens / 1_000_000) }
  private key(dimension: BudgetDimension, scopeID: string): string { if (!scopeID.trim()) throw new TypeError(`${dimension} scopeID must not be empty`); return `${dimension}:${scopeID}` }
}
