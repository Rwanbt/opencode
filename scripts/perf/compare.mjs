// SPDX-License-Identifier: MIT

// Compare two measurement artifacts and detect regressions (carte A03).
// Default threshold: 10% increase on any percentile flags a regression.
//
// Returns { regression, metrics, threshold, reason? }.
// `metrics` is the full per-percentile comparison so the caller can
// inspect which dimension regressed.

const DEFAULT_THRESHOLD = 0.10

export function compareArtifacts(baseline, current, options = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const metrics = []

  if (!baseline?.variance || !current?.variance) {
    return { regression: true, metrics: [], threshold, reason: "missing variance" }
  }

  for (const metric of Object.keys(baseline.variance)) {
    const b = baseline.variance[metric]
    const c = current.variance[metric]
    if (!b || !c || typeof b !== "object" || typeof c !== "object") continue
    for (const pct of ["p50", "p95", "p99"]) {
      if (typeof b[pct] !== "number" || typeof c[pct] !== "number") continue
      if (b[pct] === 0) continue
      const delta = (c[pct] - b[pct]) / b[pct]
      const regression = delta > threshold
      metrics.push({ metric, percentile: pct, baseline: b[pct], current: c[pct], delta, threshold, regression })
    }
  }

  return {
    regression: metrics.some((m) => m.regression),
    metrics,
    threshold,
  }
}
