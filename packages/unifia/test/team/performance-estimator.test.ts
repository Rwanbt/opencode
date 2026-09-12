import { describe, expect, it } from "bun:test"
import {
  betaCdf,
  betaQuantile,
  DEFAULT_ESTIMATOR_CONFIG,
  estimatePerformance,
  NoEvidenceError,
  PerformanceEstimatorInputError,
  type ExternalPrior,
  type Observation,
} from "../../src/team/performance-estimator"

const prior: ExternalPrior = {
  successRate: 0.8,
  strength: 10,
  benchmarkID: "swe-bench",
  benchmarkVersion: "1.0",
}

function observations(count: number, success: boolean, domain = "rust", ageDays = 0): Observation[] {
  return Array.from({ length: count }, () => ({ domain, success, ageDays }))
}

/** Deterministic LCG — a calibration test must not depend on Math.random. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

describe("beta distribution primitives", () => {
  it("has a CDF that is 0 at 0, 1 at 1, and monotonically increasing", () => {
    expect(betaCdf(0, 2, 3)).toBe(0)
    expect(betaCdf(1, 2, 3)).toBe(1)
    let previous = 0
    for (let x = 0.05; x < 1; x += 0.05) {
      const value = betaCdf(x, 2, 3)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it("matches the closed form for Beta(1,1), which is uniform", () => {
    expect(betaCdf(0.25, 1, 1)).toBeCloseTo(0.25, 6)
    expect(betaCdf(0.5, 1, 1)).toBeCloseTo(0.5, 6)
    expect(betaCdf(0.75, 1, 1)).toBeCloseTo(0.75, 6)
  })

  it("matches the closed form for Beta(2,1), whose CDF is x^2", () => {
    expect(betaCdf(0.3, 2, 1)).toBeCloseTo(0.09, 6)
    expect(betaCdf(0.8, 2, 1)).toBeCloseTo(0.64, 6)
  })

  it("matches exact closed forms for the half-integer cases", () => {
    // These are the a < 1 shapes where a naive numeric integration of the
    // pdf breaks down (the t^(a-1) singularity at 0), so they are checked
    // against identities instead:
    //   I_x(0.5, 0.5) = (2/pi) * asin(sqrt x)
    //   I_x(0.5, 1)   = sqrt x
    //   I_x(1, 0.5)   = 1 - sqrt(1 - x)
    for (const x of [0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      expect(betaCdf(x, 0.5, 0.5)).toBeCloseTo((2 / Math.PI) * Math.asin(Math.sqrt(x)), 10)
      expect(betaCdf(x, 0.5, 1)).toBeCloseTo(Math.sqrt(x), 10)
      expect(betaCdf(x, 1, 0.5)).toBeCloseTo(1 - Math.sqrt(1 - x), 10)
    }
  })

  it("matches the exact binomial tail for integer parameters", () => {
    // I_x(k, n-k+1) = P(Binomial(n, x) >= k), summed exactly.
    const choose = (n: number, k: number) => {
      let result = 1
      for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1)
      return result
    }
    const binomialTail = (x: number, k: number, n: number) => {
      let sum = 0
      for (let j = k; j <= n; j++) sum += choose(n, j) * x ** j * (1 - x) ** (n - j)
      return sum
    }

    for (const [k, n] of [
      [1, 5],
      [3, 10],
      [7, 12],
      [2, 20],
      [15, 20],
    ]) {
      for (const x of [0.1, 0.35, 0.5, 0.8]) {
        expect(betaCdf(x, k!, n! - k! + 1)).toBeCloseTo(binomialTail(x, k!, n!), 10)
      }
    }
  })

  it("stays within [0,1] and finite across a hostile parameter grid", () => {
    for (const a of [0.1, 0.5, 1, 2, 10, 100]) {
      for (const b of [0.1, 0.5, 1, 2, 10, 100]) {
        for (let i = 0; i <= 20; i++) {
          const value = betaCdf(i / 20, a, b)
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it("inverts the CDF: quantile(cdf(x)) round-trips", () => {
    for (const x of [0.1, 0.35, 0.5, 0.77, 0.95]) {
      expect(betaQuantile(betaCdf(x, 3, 5), 3, 5)).toBeCloseTo(x, 6)
    }
  })

  it("keeps quantiles inside [0,1] where a normal approximation would not", () => {
    // Beta(0.5, 20): mass jammed against 0, mean ~0.024.
    const lower = betaQuantile(0.05, 0.5, 20)
    const upper = betaQuantile(0.95, 0.5, 20)

    expect(lower).toBeGreaterThanOrEqual(0)
    expect(upper).toBeLessThanOrEqual(1)
    expect(lower).toBeLessThan(upper)
  })
})

describe("estimatePerformance — acceptance: no 2-sample overfit", () => {
  it("does not claim a perfect rate from two successes", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: observations(2, true) })

    // Naive counting would say 2/2 = 1.0.
    expect(result.global.mean).toBeLessThan(0.9)
    expect(result.global.mean).toBeGreaterThan(prior.successRate)
    expect(result.global.sufficientEvidence).toBe(false)
  })

  it("does not claim a zero rate from two failures", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: observations(2, false) })

    expect(result.global.mean).toBeGreaterThan(0.5)
    expect(result.global.sufficientEvidence).toBe(false)
  })

  it("keeps the interval wide when evidence is thin and narrows it as evidence grows", () => {
    const thin = estimatePerformance({ externalPrior: prior, observations: observations(2, true) })
    const thick = estimatePerformance({ externalPrior: prior, observations: observations(200, true) })

    const thinWidth = thin.global.upper - thin.global.lower
    const thickWidth = thick.global.upper - thick.global.lower
    expect(thickWidth).toBeLessThan(thinWidth)
    expect(thick.global.sufficientEvidence).toBe(true)
  })

  it("returns exactly the prior when there is no evidence at all", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: [] })

    expect(result.global.mean).toBeCloseTo(prior.successRate, 10)
    expect(result.global.effectiveSamples).toBe(0)
    expect(result.global.shrinkageWeight).toBe(1)
    expect(result.global.sufficientEvidence).toBe(false)
  })
})

describe("estimatePerformance — shrinkage", () => {
  it("moves from the prior toward the observed rate as evidence accumulates", () => {
    const means = [0, 5, 25, 200].map(
      (count) => estimatePerformance({ externalPrior: prior, observations: observations(count, false) }).global.mean,
    )

    // Prior says 0.8, every observation is a failure: the mean must fall
    // monotonically toward 0 without ever jumping straight there.
    for (let i = 1; i < means.length; i++) expect(means[i]!).toBeLessThan(means[i - 1]!)
    expect(means[0]).toBeCloseTo(0.8, 6)
    expect(means[3]!).toBeLessThan(0.1)
  })

  it("reports the prior's remaining share as shrinkageWeight", () => {
    const light = estimatePerformance({ externalPrior: prior, observations: observations(10, true) })
    const heavy = estimatePerformance({ externalPrior: prior, observations: observations(100, true) })

    // strength 10 against 10 effective observations -> half the posterior.
    expect(light.global.shrinkageWeight).toBeCloseTo(0.5, 6)
    expect(heavy.global.shrinkageWeight).toBeLessThan(light.global.shrinkageWeight)
  })

  it("lets a stronger prior resist the same evidence", () => {
    const weak = estimatePerformance({
      externalPrior: { ...prior, strength: 1 },
      observations: observations(10, false),
    })
    const strong = estimatePerformance({
      externalPrior: { ...prior, strength: 100 },
      observations: observations(10, false),
    })

    expect(strong.global.mean).toBeGreaterThan(weak.global.mean)
  })
})

describe("estimatePerformance — recency decay", () => {
  it("weighs an old observation less than a fresh one", () => {
    const fresh = estimatePerformance({ externalPrior: prior, observations: observations(10, false, "rust", 0) })
    const old = estimatePerformance({ externalPrior: prior, observations: observations(10, false, "rust", 120) })

    // Same ten failures; the old ones barely move the estimate.
    expect(old.global.mean).toBeGreaterThan(fresh.global.mean)
    expect(old.global.effectiveSamples).toBeLessThan(fresh.global.effectiveSamples)
  })

  it("halves the weight after exactly one half-life", () => {
    const result = estimatePerformance({
      externalPrior: prior,
      observations: observations(8, true, "rust", DEFAULT_ESTIMATOR_CONFIG.halfLifeDays),
    })

    expect(result.global.effectiveSamples).toBeCloseTo(4, 6)
  })

  it("counts effective samples, not raw ones, against the sufficiency threshold", () => {
    // Twenty observations, all four half-lives old -> 20 * 0.0625 = 1.25 effective.
    const result = estimatePerformance({
      externalPrior: prior,
      observations: observations(20, true, "rust", 4 * DEFAULT_ESTIMATOR_CONFIG.halfLifeDays),
    })

    expect(result.observationCount).toBe(20)
    expect(result.global.effectiveSamples).toBeCloseTo(1.25, 6)
    expect(result.global.sufficientEvidence).toBe(false)
  })
})

describe("estimatePerformance — domain vector", () => {
  const mixed: Observation[] = [
    ...observations(20, true, "typescript"),
    ...observations(20, false, "rust"),
    ...observations(1, true, "go"),
  ]

  it("produces one estimate per observed domain, ordered by name", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: mixed })

    expect(result.domainVector.map((entry) => entry.domain)).toEqual(["go", "rust", "typescript"])
  })

  it("separates domains instead of averaging them into one number", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: mixed })
    const rust = result.domainVector.find((entry) => entry.domain === "rust")!
    const typescript = result.domainVector.find((entry) => entry.domain === "typescript")!

    expect(rust.mean).toBeLessThan(0.4)
    expect(typescript.mean).toBeGreaterThan(0.7)
  })

  it("shrinks a thin domain toward the global posterior rather than trusting it", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: mixed })
    const go = result.domainVector.find((entry) => entry.domain === "go")!

    // One success in "go" must not read as a high success rate.
    expect(go.sufficientEvidence).toBe(false)
    expect(Math.abs(go.mean - result.global.mean)).toBeLessThan(0.15)
  })

  it("treats an unobserved domain as the borrowed global estimate, not an error", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: mixed, domain: "cobol" })

    expect(result.requestedDomain).toBe("cobol")
    expect(result.estimate.effectiveSamples).toBe(0)
    expect(result.estimate.sufficientEvidence).toBe(false)
    expect(result.estimate.mean).toBeCloseTo(result.global.mean, 6)
  })

  it("returns the requested domain's estimate as the headline estimate", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: mixed, domain: "rust" })

    expect(result.estimate.mean).toBeCloseTo(result.domainVector.find((e) => e.domain === "rust")!.mean, 10)
    expect(result.estimate.mean).not.toBeCloseTo(result.global.mean, 2)
  })
})

describe("estimatePerformance — acceptance: explain source weights", () => {
  it("reports prior and observation shares that sum to 1", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: observations(10, true) })

    const total = result.sources.reduce((sum, source) => sum + source.weight, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(result.sources.map((source) => source.kind).sort()).toEqual(["external_prior", "internal_global"])
  })

  it("shows the prior dominating when evidence is thin, and yielding when it is not", () => {
    const thin = estimatePerformance({ externalPrior: prior, observations: observations(1, true) })
    const thick = estimatePerformance({ externalPrior: prior, observations: observations(100, true) })

    const priorShare = (r: ReturnType<typeof estimatePerformance>) =>
      r.sources.find((source) => source.kind === "external_prior")!.weight
    expect(priorShare(thin)).toBeGreaterThan(0.8)
    expect(priorShare(thick)).toBeLessThan(0.2)
  })

  it("names the benchmark behind the prior so a borrowed estimate is traceable", () => {
    const result = estimatePerformance({ externalPrior: prior, observations: [] })
    const external = result.sources.find((source) => source.kind === "external_prior")!

    expect(external.detail).toContain("swe-bench")
    expect(external.detail).toContain("1.0")
  })

  it("switches to domain-level sources when a domain is requested", () => {
    const result = estimatePerformance({
      externalPrior: prior,
      observations: observations(10, true, "rust"),
      domain: "rust",
    })

    expect(result.sources.map((source) => source.kind).sort()).toEqual(["internal_domain", "internal_global"])
    expect(result.sources.reduce((sum, source) => sum + source.weight, 0)).toBeCloseTo(1, 10)
    expect(result.sources.find((source) => source.kind === "internal_domain")!.detail).toContain("rust")
  })

  it("discloses how much of a domain's borrowed mass is itself external prior", () => {
    // The external prior reaches a domain estimate only through the global
    // posterior. Without this, a mostly-borrowed domain estimate would look
    // like measured evidence.
    const thin = estimatePerformance({
      externalPrior: prior,
      observations: observations(1, true, "rust"),
      domain: "rust",
    })
    const borrowed = thin.sources.find((source) => source.kind === "internal_global")!

    expect(borrowed.detail).toContain("external prior")
    expect(borrowed.detail).toContain("swe-bench")
    // With one observation against a strength-10 prior, most of the global
    // posterior is still the benchmark.
    expect(borrowed.detail).toMatch(/9[0-9]\.\d%/)
  })
})

describe("estimatePerformance — acceptance: synthetic calibration", () => {
  it("converges to the true rate as samples accumulate", () => {
    const random = makeRandom(42)
    const trueRate = 0.35
    const generated: Observation[] = Array.from({ length: 500 }, () => ({
      domain: "rust",
      success: random() < trueRate,
      ageDays: 0,
    }))

    const result = estimatePerformance({ externalPrior: prior, observations: generated })

    // Prior says 0.8, truth is 0.35: with 500 samples the data must win.
    expect(result.global.mean).toBeCloseTo(trueRate, 1)
    expect(result.global.lower).toBeLessThan(trueRate)
    expect(result.global.upper).toBeGreaterThan(trueRate)
  })

  it("produces credible intervals that cover the truth at roughly their nominal rate", () => {
    const random = makeRandom(7)
    const trueRate = 0.6
    const trials = 200
    const samplesPerTrial = 60
    let covered = 0

    for (let trial = 0; trial < trials; trial++) {
      const generated: Observation[] = Array.from({ length: samplesPerTrial }, () => ({
        domain: "d",
        success: random() < trueRate,
        ageDays: 0,
      }))
      // Neutral prior so the test measures the interval, not the prior's pull.
      const result = estimatePerformance({
        externalPrior: { ...prior, successRate: 0.5, strength: 1 },
        observations: generated,
      })
      if (result.global.lower <= trueRate && trueRate <= result.global.upper) covered++
    }

    // Nominal 90%. A miscalibrated interval (e.g. a normal approximation or
    // a wrong tail split) would land far outside this band.
    const coverage = covered / trials
    expect(coverage).toBeGreaterThan(0.8)
    expect(coverage).toBeLessThan(0.98)
  })

  it("is deterministic: identical input yields an identical estimate", () => {
    const generated = observations(37, true, "rust", 3)
    const first = estimatePerformance({ externalPrior: prior, observations: generated })
    const second = estimatePerformance({ externalPrior: prior, observations: generated })

    expect(second).toEqual(first)
  })

  it("is independent of observation order", () => {
    const mixed: Observation[] = [
      ...observations(10, true, "a", 1),
      ...observations(7, false, "b", 12),
      ...observations(4, true, "c", 40),
    ]
    const forward = estimatePerformance({ externalPrior: prior, observations: mixed })
    const reversed = estimatePerformance({ externalPrior: prior, observations: [...mixed].reverse() })

    expect(reversed.global.mean).toBeCloseTo(forward.global.mean, 12)
    expect(reversed.domainVector.map((entry) => entry.domain)).toEqual(
      forward.domainVector.map((entry) => entry.domain),
    )
  })
})

describe("estimatePerformance — boundaries", () => {
  it("rejects a success rate outside 0..1", () => {
    expect(() => estimatePerformance({ externalPrior: { ...prior, successRate: 1.4 }, observations: [] })).toThrow(
      PerformanceEstimatorInputError,
    )
  })

  it("rejects a negative observation age", () => {
    expect(() =>
      estimatePerformance({ externalPrior: prior, observations: [{ domain: "d", success: true, ageDays: -1 }] }),
    ).toThrow(PerformanceEstimatorInputError)
  })

  it("rejects a non-positive half-life, which would make decay undefined", () => {
    expect(() =>
      estimatePerformance({
        externalPrior: prior,
        observations: [],
        config: { ...DEFAULT_ESTIMATOR_CONFIG, halfLifeDays: 0 },
      }),
    ).toThrow(PerformanceEstimatorInputError)
  })

  it("rejects a credible mass of 0 or 1", () => {
    for (const credibleMass of [0, 1]) {
      expect(() =>
        estimatePerformance({
          externalPrior: prior,
          observations: [],
          config: { ...DEFAULT_ESTIMATOR_CONFIG, credibleMass },
        }),
      ).toThrow(PerformanceEstimatorInputError)
    }
  })

  it("refuses to invent an estimate when there is no evidence at all", () => {
    // Beta(0,0) is improper. Returning a number here would mean NaN, and
    // since every comparison against NaN is false, it would slip past every
    // downstream threshold instead of tripping them.
    expect(() => estimatePerformance({ externalPrior: { ...prior, strength: 0 }, observations: [] })).toThrow(
      NoEvidenceError,
    )
  })

  it("refuses to claim certainty from one-sided evidence with no prior", () => {
    // strength 0 with only successes leaves beta = 0: an improper posterior.
    // Computing anyway reported mean = 1 with an interval whose upper bound
    // was 0.67 — an interval not containing its own mean, and certainty
    // asserted from a handful of runs.
    expect(() =>
      estimatePerformance({ externalPrior: { ...prior, strength: 0 }, observations: observations(1, true) }),
    ).toThrow(NoEvidenceError)
    expect(() =>
      estimatePerformance({ externalPrior: { ...prior, strength: 0 }, observations: observations(50, false) }),
    ).toThrow(NoEvidenceError)
  })

  it("accepts one-sided evidence as soon as any prior strength is supplied", () => {
    const result = estimatePerformance({
      externalPrior: { ...prior, strength: 0.001 },
      observations: observations(50, true),
    })

    expect(result.global.mean).toBeLessThan(1)
    expect(result.global.upper).toBeGreaterThanOrEqual(result.global.mean)
  })

  it("refuses just as loudly when every observation has decayed to nothing", () => {
    // Same degenerate posterior reached the other way: no prior, and
    // observations so old their weight underflows.
    expect(() =>
      estimatePerformance({
        externalPrior: { ...prior, strength: 0 },
        observations: observations(50, true, "rust", 100_000),
      }),
    ).toThrow(NoEvidenceError)
  })

  it("never reports a NaN or infinite estimate across a hostile parameter sweep", () => {
    for (const strength of [0.001, 1, 1_000]) {
      for (const count of [0, 1, 50]) {
        for (const ageDays of [0, 30, 100_000]) {
          const result = estimatePerformance({
            externalPrior: { ...prior, strength },
            observations: observations(count, true, "rust", ageDays),
          })
          for (const value of [result.global.mean, result.global.lower, result.global.upper]) {
            expect(Number.isFinite(value)).toBe(true)
            expect(value).toBeGreaterThanOrEqual(0)
            expect(value).toBeLessThanOrEqual(1)
          }
          // Deliberately NOT asserting lower <= mean <= upper: for a heavily
          // skewed Beta (tiny beta parameter, almost all mass at 1) the mean
          // is dragged below the 5th percentile by the sliver of spread mass.
          // That is a genuine property of the distribution, not a defect.
          expect(result.global.lower).toBeLessThanOrEqual(result.global.upper)
        }
      }
    }
  })

  it("is not confused by a domain named like an object prototype key", () => {
    for (const domain of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const result = estimatePerformance({
        externalPrior: prior,
        observations: observations(6, true, domain),
        domain,
      })
      expect(result.domainVector.map((entry) => entry.domain)).toEqual([domain])
      expect(result.estimate.effectiveSamples).toBe(6)
      expect(Number.isFinite(result.estimate.mean)).toBe(true)
    }
  })

  it("widens the interval monotonically as the credible mass grows", () => {
    let previousWidth = -1
    for (const credibleMass of [0.5, 0.8, 0.9, 0.95, 0.99]) {
      const result = estimatePerformance({
        externalPrior: prior,
        observations: observations(20, true),
        config: { ...DEFAULT_ESTIMATOR_CONFIG, credibleMass },
      })
      const width = result.global.upper - result.global.lower
      expect(width).toBeGreaterThanOrEqual(previousWidth)
      previousWidth = width
    }
  })

  it("supports a zero-strength prior once both outcomes have been observed", () => {
    // With no prior, evidence must bound the rate from both sides for the
    // posterior to be proper. Mixed outcomes do that; one-sided ones do not
    // (covered above).
    const result = estimatePerformance({
      externalPrior: { ...prior, strength: 0 },
      observations: [...observations(4, true), ...observations(2, false)],
    })

    expect(Number.isFinite(result.global.mean)).toBe(true)
    expect(result.global.mean).toBeCloseTo(4 / 6, 6)
  })

  it("keeps every reported bound inside [0,1]", () => {
    for (const [successes, failures] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [50, 0],
      [0, 50],
    ]) {
      const result = estimatePerformance({
        externalPrior: { ...prior, strength: 0.5 },
        observations: [...observations(successes!, true), ...observations(failures!, false)],
      })
      expect(result.global.lower).toBeGreaterThanOrEqual(0)
      expect(result.global.upper).toBeLessThanOrEqual(1)
      expect(result.global.lower).toBeLessThanOrEqual(result.global.upper)
    }
  })
})
