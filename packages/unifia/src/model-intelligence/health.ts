/**
 * Health check : latence, taux d'erreur, rate limit, uptime.
 *
 * Calcul des métriques depuis observations ponctuelles. Pas de réseau réel
 * ici (c'est la responsabilité des connecteurs ou d'un health-checker
 * séparé).
 *
 * TEAM-C06 étend ce module avec la couche probing/scheduling :
 *   - un scheduler adaptatif décidant QUAND sonder un (providerID, modelID)
 *   - un limiteur de débit protégeant un budget requests/minute configurable
 *   - une fenêtre glissante en mémoire accumulant les observations dans le
 *     temps (au lieu d'un tableau ponctuel fourni par l'appelant)
 *   - une redaction stricte de tout texte d'erreur de probe avant stockage,
 *     pour garantir qu'aucun contenu de prompt/completion utilisateur ne
 *     puisse être persisté (critère d'acceptation de la carte).
 *
 * Toujours pas de réseau réel ici : ce module ne fait qu'orchestrer QUAND et
 * COMBIEN sonder, et COMMENT agréger/rédiger le résultat. L'appel réseau
 * effectif reste la responsabilité d'un connecteur (cf. connectors/).
 */

import { NamedError } from "@unifia/util/error"
import z from "zod"
import type { ModelHealth, RateLimit } from "./schema"
import { isoUtcNow } from "./schema"

export interface HealthObservation {
  timestampUTC: string
  latencyMs: number | null
  error: boolean
}

export function aggregateHealth(observations: HealthObservation[]): ModelHealth {
  if (observations.length === 0) {
    return {
      lastHealthCheckUTC: isoUtcNow(),
      availabilityScore: 1,
      latencyP50Ms: null,
      latencyP95Ms: null,
      errorRate1h: 0,
      rateLimit: null,
      notes: null,
    }
  }

  const latencies = observations
    .map((o) => o.latencyMs)
    .filter((l): l is number => typeof l === "number")
    .sort((a, b) => a - b)

  const errors = observations.filter((o) => o.error).length

  return {
    lastHealthCheckUTC: isoUtcNow(),
    availabilityScore: 1 - errors / observations.length,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    errorRate1h: errors / observations.length,
    rateLimit: null,
    notes: null,
  }
}

function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null
  const idx = Math.floor(sortedValues.length * p)
  return sortedValues[Math.min(idx, sortedValues.length - 1)]
}

export function buildRateLimit(
  requestsPerMinute: number | null,
  tokensPerMinute: number | null,
  resetWindow: RateLimit["resetWindow"],
): RateLimit {
  return { requestsPerMinute, tokensPerMinute, resetWindow }
}

// =====================================================================
// TEAM-C06 — payload redaction
//
// A probe error message may originate from an HTTP response body that
// echoes request content (validation errors, provider-side prompt
// logging, etc). We never persist raw probe error text: only a bounded,
// whitelisted technical summary survives. Anything that is not a
// recognized network/HTTP technical token is replaced wholesale — partial
// redaction of free-form natural language is not reliably safe, so this
// module does not attempt it.
// =====================================================================

const PROBE_ERROR_SUMMARY_MAX_LEN = 120

const KNOWN_NETWORK_ERROR_CODES = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNABORTED",
  "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
] as const

// Requires an explicit "HTTP" marker immediately before the code so that
// unrelated 3-digit numbers (IP octets, ports, ids embedded in free text)
// are never mistaken for a status code.
const HTTP_STATUS_PATTERN = /\bHTTP\/?\d?\.?\d?\s+([1-5]\d{2})\b/i

/**
 * Redact a raw probe error message before it is allowed anywhere near
 * persistence. Returns only a fixed-vocabulary technical summary (known
 * network error codes, HTTP status codes) or a generic opaque marker —
 * never a substring of the original free-form message.
 */
export function redactProbeError(rawMessage: string | null | undefined): string | null {
  if (rawMessage === null || rawMessage === undefined) return null
  const trimmed = rawMessage.trim()
  if (trimmed.length === 0) return null

  const matchedCode = KNOWN_NETWORK_ERROR_CODES.find((code) => trimmed.includes(code))
  const statusMatch = HTTP_STATUS_PATTERN.exec(trimmed)

  const tokens: string[] = []
  if (matchedCode) tokens.push(matchedCode)
  if (statusMatch) tokens.push(`http_status=${statusMatch[1]}`)

  if (tokens.length === 0) {
    const boundedLen = Math.min(trimmed.length, PROBE_ERROR_SUMMARY_MAX_LEN)
    return `[redacted: opaque probe error, ${boundedLen} chars]`
  }
  return tokens.join(" ").slice(0, PROBE_ERROR_SUMMARY_MAX_LEN)
}

// =====================================================================
// TEAM-C06 — adaptive probe scheduler
//
// Policy (deliberately simple, deterministic, testable):
//   - on failure: exponential backoff from the base interval, capped at
//     the max interval — avoids hammering a struggling endpoint.
//   - on the first success after a failure streak: return immediately to
//     the base interval — a recovered endpoint is re-verified at normal
//     cadence rather than trusted instantly.
//   - on a sustained success streak (>= stability threshold) with no
//     intervening failure: relax the interval further, capped at the max
//     — a long-stable endpoint is probed less often ("restraint").
// =====================================================================

export const PROBE_INTERVAL_MIN_MS = 15_000
export const PROBE_INTERVAL_BASE_MS = 5 * 60_000
export const PROBE_INTERVAL_MAX_MS = 30 * 60_000
const PROBE_STABILITY_THRESHOLD = 5
const PROBE_BACKOFF_FACTOR = 2
const PROBE_RELAXATION_FACTOR = 1.5

export interface ProbeAttemptResult {
  timestampUTC: string
  success: boolean
  latencyMs: number | null
  /**
   * Raw, unredacted error text as captured from the probe attempt (may
   * contain request/response content). Never persisted as-is — see
   * `redactProbeError` and `HealthWindowStore.record`, which redact it at
   * the ingestion boundary before anything reaches storage.
   */
  rawErrorMessage: string | null
}

export interface ProbeScheduleState {
  consecutiveFailures: number
  consecutiveSuccesses: number
  lastProbeAtUTC: string | null
  intervalMs: number
}

export const INITIAL_PROBE_SCHEDULE_STATE: ProbeScheduleState = {
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  lastProbeAtUTC: null,
  intervalMs: PROBE_INTERVAL_BASE_MS,
}

/**
 * Pure state transition: given the current schedule state and the outcome
 * of the probe that was just attempted, compute the next schedule state.
 * No I/O, no timers — the caller owns actual scheduling (setTimeout, cron,
 * queue, etc).
 */
export function advanceProbeSchedule(
  state: ProbeScheduleState,
  result: ProbeAttemptResult,
): ProbeScheduleState {
  if (!result.success) {
    const consecutiveFailures = state.consecutiveFailures + 1
    const intervalMs = Math.min(
      PROBE_INTERVAL_MAX_MS,
      Math.max(PROBE_INTERVAL_MIN_MS, PROBE_INTERVAL_BASE_MS * PROBE_BACKOFF_FACTOR ** consecutiveFailures),
    )
    return {
      consecutiveFailures,
      consecutiveSuccesses: 0,
      lastProbeAtUTC: result.timestampUTC,
      intervalMs,
    }
  }

  const consecutiveSuccesses = state.consecutiveSuccesses + 1
  const recoveringFromFailure = state.consecutiveFailures > 0

  let intervalMs: number
  if (recoveringFromFailure) {
    intervalMs = PROBE_INTERVAL_BASE_MS
  } else if (consecutiveSuccesses >= PROBE_STABILITY_THRESHOLD) {
    intervalMs = Math.min(PROBE_INTERVAL_MAX_MS, state.intervalMs * PROBE_RELAXATION_FACTOR)
  } else {
    intervalMs = state.intervalMs
  }

  return {
    consecutiveFailures: 0,
    consecutiveSuccesses,
    lastProbeAtUTC: result.timestampUTC,
    intervalMs,
  }
}

/** ISO-8601 UTC timestamp of the next earliest allowed probe, per the adaptive schedule only (rate limit not considered). */
export function nextProbeAtUTC(state: ProbeScheduleState): string {
  if (!state.lastProbeAtUTC) return isoUtcNow()
  const lastMs = new Date(state.lastProbeAtUTC).getTime()
  return new Date(lastMs + state.intervalMs).toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function isProbeDue(state: ProbeScheduleState, nowUTC: string = isoUtcNow()): boolean {
  if (!state.lastProbeAtUTC) return true
  return new Date(nowUTC).getTime() >= new Date(nextProbeAtUTC(state)).getTime()
}

// =====================================================================
// TEAM-C06 — rate limit enforcement
//
// Sliding-window request budget shared across probes for a given scope
// (typically one limiter per provider, or a global limiter — the caller
// decides the granularity by how many `RateLimiterState` instances it
// keeps). This is deliberately independent from the adaptive schedule
// above: a probe can be "due" per the schedule yet still blocked because
// the requests-per-minute budget is exhausted.
// =====================================================================

const RATE_LIMIT_WINDOW_MS = 60_000

export interface RateLimitBudget {
  requestsPerMinute: number
}

export interface RateLimiterState {
  /** Epoch-ms timestamps of probes recorded within the trailing window, ascending order. */
  recentProbeTimestampsMs: number[]
}

export const EMPTY_RATE_LIMITER_STATE: RateLimiterState = { recentProbeTimestampsMs: [] }

export const RateLimitBudgetExceededError = NamedError.create(
  "RateLimitBudgetExceededError",
  z.object({
    requestsPerMinute: z.number(),
    windowMs: z.number(),
    attemptedAtUTC: z.string(),
    message: z.string(),
  }),
)

function pruneRateLimiterState(state: RateLimiterState, nowMs: number): RateLimiterState {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS
  return { recentProbeTimestampsMs: state.recentProbeTimestampsMs.filter((t) => t > cutoff) }
}

/** Whether a probe could be scheduled right now without breaching the requests-per-minute budget. */
export function canScheduleProbe(
  state: RateLimiterState,
  budget: RateLimitBudget,
  nowUTC: string = isoUtcNow(),
): boolean {
  if (budget.requestsPerMinute <= 0) return false
  const pruned = pruneRateLimiterState(state, new Date(nowUTC).getTime())
  return pruned.recentProbeTimestampsMs.length < budget.requestsPerMinute
}

/**
 * Record a probe attempt against the budget. Throws `RateLimitBudgetExceededError`
 * if the budget is already exhausted — callers should always gate on
 * `canScheduleProbe` first; this is the enforcement backstop.
 */
export function recordProbeAttempt(
  state: RateLimiterState,
  budget: RateLimitBudget,
  nowUTC: string = isoUtcNow(),
): RateLimiterState {
  const nowMs = new Date(nowUTC).getTime()
  const pruned = pruneRateLimiterState(state, nowMs)
  if (budget.requestsPerMinute <= 0 || pruned.recentProbeTimestampsMs.length >= budget.requestsPerMinute) {
    throw new RateLimitBudgetExceededError({
      requestsPerMinute: budget.requestsPerMinute,
      windowMs: RATE_LIMIT_WINDOW_MS,
      attemptedAtUTC: nowUTC,
      message: "probe rate limit budget exhausted for this window",
    })
  }
  return { recentProbeTimestampsMs: [...pruned.recentProbeTimestampsMs, nowMs] }
}

export type ProbeScheduleDecisionReason = "due_and_within_budget" | "not_due" | "rate_limited"

export interface ProbeScheduleDecision {
  shouldProbe: boolean
  reason: ProbeScheduleDecisionReason
  /** Earliest UTC timestamp at which re-evaluating the decision could plausibly change the answer. */
  nextEligibleAtUTC: string
}

/**
 * Combine the adaptive schedule and the rate-limit budget into a single
 * go/no-go decision. This is the function a real prober should call before
 * issuing a network request.
 */
export function decideProbeSchedule(
  scheduleState: ProbeScheduleState,
  rateLimiterState: RateLimiterState,
  budget: RateLimitBudget,
  nowUTC: string = isoUtcNow(),
): ProbeScheduleDecision {
  if (!isProbeDue(scheduleState, nowUTC)) {
    return { shouldProbe: false, reason: "not_due", nextEligibleAtUTC: nextProbeAtUTC(scheduleState) }
  }
  if (!canScheduleProbe(rateLimiterState, budget, nowUTC)) {
    const nextEligibleAtUTC = new Date(new Date(nowUTC).getTime() + RATE_LIMIT_WINDOW_MS)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
    return { shouldProbe: false, reason: "rate_limited", nextEligibleAtUTC }
  }
  return { shouldProbe: true, reason: "due_and_within_budget", nextEligibleAtUTC: nowUTC }
}

// =====================================================================
// TEAM-C06 — aggregated-window persistence
//
// Accumulates probe results into rolling time windows per (providerID,
// modelID), redacting any error text at the ingestion boundary so nothing
// raw ever reaches the store. `HealthWindowStore` is an interface so a
// real persistence backend (sqlite, kv, etc) can implement it later
// without changing this module's public API — `createInMemoryHealthWindowStore`
// is the only implementation this card ships.
// =====================================================================

export interface HealthWindowKey {
  providerID: string
  modelID: string
}

/** A `HealthObservation` plus the redacted (never raw) error summary captured at ingestion time. */
export interface StoredHealthObservation extends HealthObservation {
  redactedErrorSummary: string | null
}

export const DEFAULT_HEALTH_WINDOW_MS = 60 * 60_000
const MAX_OBSERVATIONS_PER_KEY = 500

export interface HealthWindowStore {
  /** Redacts `result.rawErrorMessage` and stores the resulting observation. Returns the stored (redacted) form. */
  record(key: HealthWindowKey, result: ProbeAttemptResult): StoredHealthObservation
  /** Observations for `key` within the trailing `windowMs`, oldest first. */
  window(key: HealthWindowKey, windowMs?: number, nowUTC?: string): StoredHealthObservation[]
  /** `aggregateHealth` over the trailing window, with `notes` set to the most recent redacted error summary (if any). */
  aggregate(key: HealthWindowKey, windowMs?: number, nowUTC?: string): ModelHealth
}

function healthWindowKeyToString(key: HealthWindowKey): string {
  return `${key.providerID}::${key.modelID}`
}

function toStoredObservation(result: ProbeAttemptResult): StoredHealthObservation {
  return {
    timestampUTC: result.timestampUTC,
    latencyMs: result.latencyMs,
    error: !result.success,
    redactedErrorSummary: result.success ? null : redactProbeError(result.rawErrorMessage),
  }
}

function aggregateStoredWindow(observations: StoredHealthObservation[]): ModelHealth {
  const base = aggregateHealth(observations)
  const mostRecentError = [...observations].reverse().find((o) => o.error)
  return { ...base, notes: mostRecentError?.redactedErrorSummary ?? null }
}

/**
 * In-memory `HealthWindowStore`. Bounded per key (`MAX_OBSERVATIONS_PER_KEY`)
 * so an unbounded probing cadence cannot leak memory; old entries are
 * dropped oldest-first once the bound is hit, independent of the
 * window-based pruning applied on read.
 */
export function createInMemoryHealthWindowStore(): HealthWindowStore {
  const observationsByKey = new Map<string, StoredHealthObservation[]>()

  function pruneToWindow(
    list: StoredHealthObservation[],
    windowMs: number,
    nowUTC: string,
  ): StoredHealthObservation[] {
    const cutoffMs = new Date(nowUTC).getTime() - windowMs
    return list.filter((o) => new Date(o.timestampUTC).getTime() >= cutoffMs)
  }

  const store: HealthWindowStore = {
    record(key, result) {
      const stored = toStoredObservation(result)
      const mapKey = healthWindowKeyToString(key)
      const existing = observationsByKey.get(mapKey) ?? []
      observationsByKey.set(mapKey, [...existing, stored].slice(-MAX_OBSERVATIONS_PER_KEY))
      return stored
    },
    window(key, windowMs = DEFAULT_HEALTH_WINDOW_MS, nowUTC = isoUtcNow()) {
      const list = observationsByKey.get(healthWindowKeyToString(key)) ?? []
      return pruneToWindow(list, windowMs, nowUTC)
    },
    aggregate(key, windowMs = DEFAULT_HEALTH_WINDOW_MS, nowUTC = isoUtcNow()) {
      return aggregateStoredWindow(store.window(key, windowMs, nowUTC))
    },
  }
  return store
}