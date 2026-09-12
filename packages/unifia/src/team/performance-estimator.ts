import { NamedError } from "@unifia/util/error"
import z from "zod"

// =============================================================================
// performance-estimator.ts — TEAM-F04
//
// Combines an external prior (a published benchmark score, per TEAM-C05)
// with this program's own observed outcomes, and reports the result WITH its
// uncertainty rather than as a bare number.
//
// The model is Beta-Binomial, chosen because it makes the properties this
// card asks for fall out of the arithmetic instead of being bolted on:
//
//   Shrinkage      A Beta prior is pseudo-observations. With little evidence
//                  the posterior sits near the prior and only moves as real
//                  observations accumulate. Two lucky successes cannot claim
//                  a 100% success rate, which is exactly the "no 2-sample
//                  overfit" criterion.
//
//   Recency decay  Each observation is weighted 0.5^(age / halfLife), so old
//                  evidence fades smoothly instead of being cut off by an
//                  arbitrary window. Weights are summed into an *effective*
//                  sample count, which is what every downstream threshold
//                  uses — ten one-year-old runs are not ten fresh ones.
//
//   Domain vector  Per-domain posteriors shrink toward the global posterior,
//                  which itself shrinks toward the external prior. A domain
//                  with three observations is informed by everything else
//                  the model has done rather than judged on those three.
//
//   Intervals      Credible intervals come from inverting the Beta CDF, not
//                  from a normal approximation. The normal approximation is
//                  worst exactly where this estimator is used most — few
//                  samples, rates near 0 or 1 — where it happily produces
//                  bounds outside [0,1].
//
// Pure: no LLM, network, provider, clock or filesystem access. Observation
// age is supplied by the caller in days, so the same input always yields the
// same estimate.
// =============================================================================

export const PERFORMANCE_ESTIMATOR_VERSION = "1.0.0" as const

// -----------------------------------------------------------------------
// Boundary validation
// -----------------------------------------------------------------------

export const PerformanceEstimatorInputError = NamedError.create(
  "PerformanceEstimatorInputError",
  z.object({
    entity: z.string(),
    issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
  }),
)

/**
 * Raised when prior strength and effective evidence are both zero. Beta(0,0)
 * is improper — there is no posterior to report, and computing one anyway
 * yields NaN. Since every comparison against NaN is false, a NaN estimate
 * would slip past downstream thresholds instead of tripping them, so this
 * fails loudly rather than returning a number that lies.
 */
export const NoEvidenceError = NamedError.create(
  "NoEvidenceError",
  z.object({
    scope: z.string(),
    priorStrength: z.number(),
    effectiveSamples: z.number(),
    message: z.string(),
  }),
)

function parseBoundary<Schema extends z.ZodTypeAny>(schema: Schema, entity: string, raw: unknown): z.infer<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new PerformanceEstimatorInputError({
      entity,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    })
  }
  return result.data
}

// -----------------------------------------------------------------------
// Beta distribution — CDF by continued fraction, quantiles by bisection
// -----------------------------------------------------------------------

const MAX_CF_ITERATIONS = 300
const CF_EPSILON = 1e-12
const TINY = 1e-300

function logGamma(x: number): number {
  // Lanczos approximation; accurate well past the precision this estimator
  // reports (three decimals on a probability).
  // Written as the exactly representable doubles: the published constants
  // -86.50532032941677 and 2.50662827463100050 are not representable and
  // round to these, one unit in the last place away.
  const coefficients = [
    76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ]
  let y = x
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let series = 1.000000000190015
  for (const coefficient of coefficients) {
    y += 1
    series += coefficient / y
  }
  return -tmp + Math.log((2.5066282746310007 * series) / x)
}

/** Continued-fraction expansion used by the regularized incomplete beta. */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let result = d

  for (let m = 1; m <= MAX_CF_ITERATIONS; m++) {
    const m2 = 2 * m
    let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + numerator * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + numerator / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    result *= d * c

    numerator = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + numerator * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + numerator / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    result *= delta
    if (Math.abs(delta - 1) < CF_EPSILON) break
  }
  return result
}

/** Regularized incomplete beta I_x(a, b) — the Beta CDF at `x`. */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + b * Math.log(1 - x) + a * Math.log(x)) *
        betaContinuedFraction(1 - x, b, a)) /
        b
}

/**
 * Inverse Beta CDF by bisection. Bisection rather than Newton: it cannot
 * diverge, and 60 iterations pin a probability to ~1e-18 — far tighter than
 * anything this estimator reports.
 */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  let low = 0
  let high = 1
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    if (betaCdf(mid, a, b) < p) low = mid
    else high = mid
  }
  return (low + high) / 2
}

// -----------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------

export const ExternalPriorSchema = z
  .object({
    /** Benchmark score normalised to a success rate in [0,1] (C05 owns the raw scales). */
    successRate: z.number().min(0).max(1),
    /**
     * Prior strength in pseudo-observations. This is how much evidence the
     * external benchmark is worth: 10 means "treat it as 10 observations".
     * Capped, because an unbounded prior would make internal evidence
     * unable to ever move the estimate.
     */
    strength: z.number().min(0).max(1_000),
    benchmarkID: z.string().min(1),
    benchmarkVersion: z.string().min(1),
  })
  .strict()
export type ExternalPrior = z.infer<typeof ExternalPriorSchema>

export const ObservationSchema = z
  .object({
    domain: z.string().min(1),
    success: z.boolean(),
    /** Age in days at estimation time. Supplied by the caller so this module stays clock-free. */
    ageDays: z.number().min(0),
  })
  .strict()
export type Observation = z.infer<typeof ObservationSchema>

export const EstimatorConfigSchema = z
  .object({
    /** Days after which an observation carries half its original weight. */
    halfLifeDays: z.number().positive(),
    /** Effective sample count below which evidence is declared insufficient. */
    minEffectiveSamples: z.number().min(0),
    /** Pseudo-observations a domain borrows from the global posterior. */
    domainPriorStrength: z.number().min(0).max(1_000),
    /** Credible interval mass, e.g. 0.9 for a 90% interval. */
    credibleMass: z.number().gt(0).lt(1),
  })
  .strict()
export type EstimatorConfig = z.infer<typeof EstimatorConfigSchema>

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = Object.freeze({
  halfLifeDays: 30,
  minEffectiveSamples: 5,
  domainPriorStrength: 8,
  credibleMass: 0.9,
})

// -----------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------

export const SourceKindSchema = z.enum(["external_prior", "internal_global", "internal_domain"])
export type SourceKind = z.infer<typeof SourceKindSchema>

export interface SourceWeight {
  readonly kind: SourceKind
  /** Share of the posterior's total evidence, in [0,1]. Weights sum to 1. */
  readonly weight: number
  /** Pseudo-observations this source contributed. */
  readonly evidence: number
  readonly detail: string
}

export interface PerformanceEstimate {
  readonly mean: number
  readonly lower: number
  readonly upper: number
  readonly credibleMass: number
  /** Sum of recency weights — NOT the raw observation count. */
  readonly effectiveSamples: number
  /**
   * False when effective samples fall below the configured minimum. The
   * estimate is still returned (shrunk toward the prior), but a caller must
   * not treat it as measured.
   */
  readonly sufficientEvidence: boolean
  /** Share of the posterior still coming from the prior, in [0,1]. */
  readonly shrinkageWeight: number
}

export interface DomainEstimate extends PerformanceEstimate {
  readonly domain: string
}

export interface PerformanceEstimateResult {
  readonly estimatorVersion: typeof PERFORMANCE_ESTIMATOR_VERSION
  /** Estimate for the requested domain, or the global one when none was asked for. */
  readonly estimate: PerformanceEstimate
  readonly requestedDomain: string | null
  readonly global: PerformanceEstimate
  /** One estimate per observed domain, ordered by domain name. */
  readonly domainVector: readonly DomainEstimate[]
  readonly sources: readonly SourceWeight[]
  readonly observationCount: number
}

export interface EstimatePerformanceInput {
  readonly externalPrior: ExternalPrior
  readonly observations: readonly Observation[]
  readonly domain?: string | null
  readonly config?: EstimatorConfig
}

// -----------------------------------------------------------------------
// Estimation
// -----------------------------------------------------------------------

interface WeightedCounts {
  readonly successes: number
  readonly failures: number
}

function recencyWeight(ageDays: number, halfLifeDays: number): number {
  return 0.5 ** (ageDays / halfLifeDays)
}

function accumulate(observations: readonly Observation[], halfLifeDays: number): WeightedCounts {
  let successes = 0
  let failures = 0
  for (const observation of observations) {
    const weight = recencyWeight(observation.ageDays, halfLifeDays)
    if (observation.success) successes += weight
    else failures += weight
  }
  return { successes, failures }
}

function buildEstimate(
  priorAlpha: number,
  priorBeta: number,
  counts: WeightedCounts,
  config: EstimatorConfig,
  scope: string,
): PerformanceEstimate {
  const alpha = priorAlpha + counts.successes
  const beta = priorBeta + counts.failures
  const effectiveSamples = counts.successes + counts.failures
  const priorStrength = priorAlpha + priorBeta

  // Both parameters must be strictly positive. Beta(a, 0) and Beta(0, b) are
  // improper just as Beta(0, 0) is: with no prior strength and, say, only
  // successes observed, nothing bounds the failure rate from above — every
  // rate arbitrarily close to 1 stays consistent with the data. Computing
  // anyway produced mean = 1 (certainty from a handful of runs) alongside an
  // interval that did not even contain that mean.
  if (alpha <= 0 || beta <= 0) {
    throw new NoEvidenceError({
      scope,
      priorStrength,
      effectiveSamples,
      message:
        alpha + beta <= 0
          ? `no evidence for ${scope}: prior strength is 0 and observations carry no effective weight (all decayed or none supplied), so the posterior is undefined`
          : `one-sided evidence for ${scope}: with prior strength 0 and only ${alpha <= 0 ? "failures" : "successes"} observed, the posterior is improper and no finite credible interval exists — supply a non-zero prior strength`,
    })
  }

  const tail = (1 - config.credibleMass) / 2

  return {
    mean: alpha / (alpha + beta),
    lower: betaQuantile(tail, alpha, beta),
    upper: betaQuantile(1 - tail, alpha, beta),
    credibleMass: config.credibleMass,
    effectiveSamples,
    sufficientEvidence: effectiveSamples >= config.minEffectiveSamples,
    shrinkageWeight: priorStrength + effectiveSamples === 0 ? 1 : priorStrength / (priorStrength + effectiveSamples),
  }
}

/**
 * Estimate an endpoint's success rate from an external prior plus observed
 * outcomes, hierarchically: observations inform a global posterior, and each
 * domain shrinks toward that global posterior rather than standing alone.
 *
 * Always returns an estimate — including with zero observations, where it is
 * exactly the external prior. What changes with evidence is
 * `sufficientEvidence` and the width of the interval, so a caller can tell a
 * measured rate from a borrowed one instead of both arriving as a bare number.
 */
export function estimatePerformance(input: EstimatePerformanceInput): PerformanceEstimateResult {
  const externalPrior = parseBoundary(ExternalPriorSchema, "externalPrior", input.externalPrior)
  const observations = parseBoundary(z.array(ObservationSchema), "observations", input.observations)
  const config = input.config
    ? parseBoundary(EstimatorConfigSchema, "config", input.config)
    : DEFAULT_ESTIMATOR_CONFIG
  const requestedDomain = input.domain ?? null

  // Global posterior: external prior as pseudo-observations, plus every
  // observation weighted by recency.
  const globalPriorAlpha = externalPrior.strength * externalPrior.successRate
  const globalPriorBeta = externalPrior.strength * (1 - externalPrior.successRate)
  const globalCounts = accumulate(observations, config.halfLifeDays)
  const global = buildEstimate(globalPriorAlpha, globalPriorBeta, globalCounts, config, "the global estimate")

  // Per-domain posteriors, each borrowing `domainPriorStrength` pseudo-
  // observations from the global posterior's mean.
  const domains = [...new Set(observations.map((observation) => observation.domain))].sort()
  const domainPriorAlpha = config.domainPriorStrength * global.mean
  const domainPriorBeta = config.domainPriorStrength * (1 - global.mean)

  const domainVector: DomainEstimate[] = domains.map((domain) => {
    const counts = accumulate(
      observations.filter((observation) => observation.domain === domain),
      config.halfLifeDays,
    )
    return { domain, ...buildEstimate(domainPriorAlpha, domainPriorBeta, counts, config, `domain "${domain}"`) }
  })

  const selected =
    requestedDomain === null
      ? global
      : (domainVector.find((entry) => entry.domain === requestedDomain) ??
        // An unobserved domain is not an error: it is the global estimate
        // with zero domain-specific evidence, which is what the hierarchy
        // says it should be.
        {
          domain: requestedDomain,
          ...buildEstimate(domainPriorAlpha, domainPriorBeta, { successes: 0, failures: 0 }, config, `domain "${requestedDomain}"`),
        })

  return {
    estimatorVersion: PERFORMANCE_ESTIMATOR_VERSION,
    estimate: selected,
    requestedDomain,
    global,
    domainVector,
    sources: buildSourceWeights(
      externalPrior,
      globalCounts,
      requestedDomain,
      observations,
      config,
      global.shrinkageWeight,
    ),
    observationCount: observations.length,
  }
}

/**
 * How much each source actually contributed, in pseudo-observations and as a
 * normalised share. Reported because "0.82" means something different when
 * it is 90% borrowed benchmark and when it is 90% measured outcomes, and a
 * caller cannot tell those apart from the number alone.
 */
function buildSourceWeights(
  externalPrior: ExternalPrior,
  globalCounts: WeightedCounts,
  requestedDomain: string | null,
  observations: readonly Observation[],
  config: EstimatorConfig,
  globalShrinkageWeight: number,
): readonly SourceWeight[] {
  const globalEvidence = globalCounts.successes + globalCounts.failures
  const domainCounts =
    requestedDomain === null
      ? { successes: 0, failures: 0 }
      : accumulate(
          observations.filter((observation) => observation.domain === requestedDomain),
          config.halfLifeDays,
        )
  const domainEvidence = domainCounts.successes + domainCounts.failures

  // A domain estimate draws on the domain's own observations plus the
  // borrowed global strength; a global estimate draws on the prior plus all
  // observations. Reporting both consistently means the shares always
  // describe the estimate that was actually returned.
  const entries: { kind: SourceKind; evidence: number; detail: string }[] =
    requestedDomain === null
      ? [
          {
            kind: "external_prior",
            evidence: externalPrior.strength,
            detail: `${externalPrior.benchmarkID}@${externalPrior.benchmarkVersion} at rate ${externalPrior.successRate}`,
          },
          {
            kind: "internal_global",
            evidence: globalEvidence,
            detail: `${observations.length} observation(s), ${globalEvidence.toFixed(3)} effective after recency decay`,
          },
        ]
      : [
          {
            kind: "internal_global",
            evidence: config.domainPriorStrength,
            // The external prior reaches a domain estimate only through the
            // global posterior. Reporting the borrowed mass without saying
            // how much of it is itself prior would make a mostly-borrowed
            // domain estimate look like measured evidence.
            detail: `borrowed ${config.domainPriorStrength} pseudo-observation(s) from the global posterior, itself ${(globalShrinkageWeight * 100).toFixed(1)}% external prior (${externalPrior.benchmarkID}@${externalPrior.benchmarkVersion})`,
          },
          {
            kind: "internal_domain",
            evidence: domainEvidence,
            detail: `domain "${requestedDomain}": ${domainEvidence.toFixed(3)} effective observation(s) after recency decay`,
          },
        ]

  const total = entries.reduce((sum, entry) => sum + entry.evidence, 0)
  return entries.map((entry) => ({
    kind: entry.kind,
    evidence: entry.evidence,
    weight: total === 0 ? 0 : entry.evidence / total,
    detail: entry.detail,
  }))
}
