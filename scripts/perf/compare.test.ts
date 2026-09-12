// SPDX-License-Identifier: MIT

import { test, expect } from "bun:test"
import { compareArtifacts } from "./compare.mjs"

const BASELINE = {
  variance: {
    samplerElapsedMs: { p50: 100, p95: 120, p99: 130 },
  },
}

test("identical artifacts show no regression", () => {
  const r = compareArtifacts(BASELINE, BASELINE)
  expect(r.regression).toBe(false)
  // Tous les percentiles sont retournés, mais aucun ne flag
  expect(r.metrics).toHaveLength(3)
  expect(r.metrics.every((m) => m.regression === false)).toBe(true)
  expect(r.metrics.every((m) => m.delta === 0)).toBe(true)
})

test("50% inflation on p95 is detected as regression", () => {
  const current = {
    variance: {
      samplerElapsedMs: { p50: 100, p95: 180, p99: 130 },
    },
  }
  const r = compareArtifacts(BASELINE, current)
  expect(r.regression).toBe(true)
  const hit = r.metrics.find((m) => m.metric === "samplerElapsedMs" && m.percentile === "p95")
  expect(hit?.regression).toBe(true)
  expect(hit?.delta).toBeCloseTo(0.5, 2)
})

test("5% inflation is below default 10% threshold", () => {
  const current = {
    variance: {
      samplerElapsedMs: { p50: 100, p95: 126, p99: 130 },
    },
  }
  const r = compareArtifacts(BASELINE, current)
  expect(r.regression).toBe(false)
})

test("missing variance does not crash", () => {
  const r = compareArtifacts({}, {})
  expect(r.regression).toBe(true)
  expect(r.reason).toBe("missing variance")
})

test("custom threshold is honored (low threshold flags small inflation)", () => {
  // 5% inflation (126/120 = 1.05) with threshold 1% should flag
  const current = {
    variance: {
      samplerElapsedMs: { p50: 100, p95: 126, p99: 130 },
    },
  }
  const r = compareArtifacts(BASELINE, current, { threshold: 0.01 })
  expect(r.regression).toBe(true)
})

test("custom threshold is honored (high threshold tolerates medium inflation)", () => {
  // 12% inflation (134/120 = 1.117) with threshold 20% should NOT flag
  const current = {
    variance: {
      samplerElapsedMs: { p50: 100, p95: 134, p99: 130 },
    },
  }
  const r = compareArtifacts(BASELINE, current, { threshold: 0.20 })
  expect(r.regression).toBe(false)
})
