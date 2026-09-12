/**
 * provider-discovery.bench.test.ts — TEAM-B02 followup
 *
 * Performance benchmarks + offline-mode stress tests for the
 * multi-model/provider-discovery.ts substrate.
 *
 * Run with:
 *   bun test test/multi-model/provider-discovery.bench.test.ts
 *
 * Output: latency percentiles (p50, p95, p99) over a 1000-iteration sample,
 * measured against a synthetic catalogue of N providers × M models.
 *
 * Bench catalogue shape:
 *   - 7 PREFERRED_MODELS (matches the production set)
 *   - Plus N additional "noise" providers/models to exercise the loop body
 *     without affecting the actual selection (they are skipped because
 *     they're not in PREFERRED_MODELS).
 *
 * Performance budget (informational):
 *   - discoverAvailableProviders() with explicit=[]: < 5ms (no I/O)
 *   - discoverAvailableProviders() with mocked runtime: < 5ms + Provider.list latency
 *   - includeJudgeInList() : < 100µs (pure sync)
 */

import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as ProviderMod from "../../src/provider/provider"
import * as AuthMod from "../../src/auth"

// ESM namespace imports are live bindings: once mock.module() replaces what
// a specifier resolves to, ProviderMod/AuthMod reflect the mock too. Spread
// into a plain object HERE, before any test in this file mocks anything, so
// the afterEach reset below restores the real thing instead of re-registering
// whatever the last mock happened to leave live.
const originalProviderMod = { ...ProviderMod }
const originalAuthMod = { ...AuthMod }

type ProviderInfo = {
  id: string
  name?: string
  source?: string
  env?: string[]
  options?: Record<string, unknown>
  models?: Record<string, { cost: { input: number; output: number }; status?: string }>
  key?: string
}

const buildProvider = (
  id: string,
  envVars: string[],
  models: Record<string, { cost: { input: number; output: number }; status?: string }>,
): ProviderInfo => ({
  id,
  name: id,
  source: "env",
  env: envVars,
  options: {},
  models,
})

let discoverAvailableProviders: typeof import("../../src/multi-model/provider-discovery").discoverAvailableProviders
let includeJudgeInList: typeof import("../../src/multi-model/provider-discovery").includeJudgeInList

beforeEach(async () => {
  const mod = await import(`../../src/multi-model/provider-discovery?bust=${crypto.randomUUID()}`)
  discoverAvailableProviders = mod.discoverAvailableProviders
  includeJudgeInList = mod.includeJudgeInList
})

afterEach(() => {
  mock.module("../../src/provider/provider", () => originalProviderMod)
  mock.module("../../src/auth", () => originalAuthMod)
})

// ---------------------------------------------------------------------------
// Bench harness — 1000-iteration sample, percentiles via sorted array.
// ---------------------------------------------------------------------------

type Sample = { p50: number; p95: number; p99: number; mean: number; min: number; max: number }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

function summarize(samples: number[]): Sample {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = samples.reduce((a, b) => a + b, 0)
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sum / samples.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  }
}

const N_ITER = 1000

// ---------------------------------------------------------------------------
// Test fixtures — synthetic catalogues of varying size.
// ---------------------------------------------------------------------------

const SMALL_CATALOGUE: Record<string, ProviderInfo> = {
  anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
    "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
  }),
  openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
    "gpt-4.1": { cost: { input: 2, output: 8 } },
  }),
  google: buildProvider("google", ["FAKE_GOOGLE_KEY"], {
    "gemini-2.5-pro": { cost: { input: 1.25, output: 10 } },
  }),
}

function buildLargeCatalogue(extraProviderCount: number): Record<string, ProviderInfo> {
  const out: Record<string, ProviderInfo> = { ...SMALL_CATALOGUE }
  for (let i = 0; i < extraProviderCount; i++) {
    const id = `noise-${i}`
    out[id] = buildProvider(id, [`FAKE_NOISE_${i}_KEY`], {
      [`noise-model-${i}`]: { cost: { input: 1, output: 2 } },
    })
  }
  return out
}

beforeEach(() => {
  process.env.FAKE_ANTHROPIC_KEY = "bench-anthropic"
  process.env.FAKE_OPENAI_KEY = "bench-openai"
  process.env.FAKE_GOOGLE_KEY = "bench-google"
})

afterEach(() => {
  delete process.env.FAKE_ANTHROPIC_KEY
  delete process.env.FAKE_OPENAI_KEY
  delete process.env.FAKE_GOOGLE_KEY
})

// ---------------------------------------------------------------------------
// Benchmarks.
// ---------------------------------------------------------------------------

describe("multi-model/provider-discovery — performance benchmarks", () => {
  test(`discoverAvailableProviders (small catalogue, 3 providers) — ${N_ITER} iters`, async () => {
    mock.module("../../src/provider/provider", () => ({
      ...ProviderMod,
      Provider: { ...ProviderMod.Provider, list: async () => SMALL_CATALOGUE },
    }))
    mock.module("../../src/auth", () => ({ ...AuthMod, Auth: { ...AuthMod.Auth, all: async () => ({}) } }))

    const samples: number[] = []
    for (let i = 0; i < N_ITER; i++) {
      const start = Bun.nanoseconds()
      await Effect.runPromise(discoverAvailableProviders())
      samples.push(Bun.nanoseconds() - start)
    }
    const s = summarize(samples)
    console.log(`BENCH small_catalogue: p50=${s.p50}ns p95=${s.p95}ns p99=${s.p99}ns mean=${s.mean.toFixed(0)}ns`)
    // Budget: < 5ms = 5_000_000ns. Generous upper bound.
    expect(s.p99).toBeLessThan(5_000_000)
  })

  test(`discoverAvailableProviders (medium catalogue, 50 providers) — ${N_ITER} iters`, async () => {
    const catalogue = buildLargeCatalogue(50)
    mock.module("../../src/provider/provider", () => ({
      ...ProviderMod,
      Provider: { ...ProviderMod.Provider, list: async () => catalogue },
    }))
    mock.module("../../src/auth", () => ({ ...AuthMod, Auth: { ...AuthMod.Auth, all: async () => ({}) } }))

    const samples: number[] = []
    for (let i = 0; i < N_ITER; i++) {
      const start = Bun.nanoseconds()
      await Effect.runPromise(discoverAvailableProviders())
      samples.push(Bun.nanoseconds() - start)
    }
    const s = summarize(samples)
    console.log(`BENCH medium_catalogue(50): p50=${s.p50}ns p95=${s.p95}ns p99=${s.p99}ns mean=${s.mean.toFixed(0)}ns`)
    expect(s.p99).toBeLessThan(10_000_000)
  })

  test(`discoverAvailableProviders (large catalogue, 200 providers) — ${N_ITER} iters`, async () => {
    const catalogue = buildLargeCatalogue(200)
    mock.module("../../src/provider/provider", () => ({
      ...ProviderMod,
      Provider: { ...ProviderMod.Provider, list: async () => catalogue },
    }))
    mock.module("../../src/auth", () => ({ ...AuthMod, Auth: { ...AuthMod.Auth, all: async () => ({}) } }))

    const samples: number[] = []
    for (let i = 0; i < N_ITER; i++) {
      const start = Bun.nanoseconds()
      await Effect.runPromise(discoverAvailableProviders())
      samples.push(Bun.nanoseconds() - start)
    }
    const s = summarize(samples)
    console.log(`BENCH large_catalogue(200): p50=${s.p50}ns p95=${s.p95}ns p99=${s.p99}ns mean=${s.mean.toFixed(0)}ns`)
    // Budget: < 20ms = 20_000_000ns. Even with 200 providers, the loop is O(N+M)
    // where N = PREFERRED_MODELS.length = 7, so cost should be near-constant.
    expect(s.p99).toBeLessThan(20_000_000)
  })

  test(`includeJudgeInList (pure, 1000 iters) — < 100µs p99`, () => {
    const judge = {
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
    } as Parameters<typeof includeJudgeInList>[1]
    const list: Array<Parameters<typeof includeJudgeInList>[0][number]> = Array.from(
      { length: 50 },
      (_, i) => ({
        model: {
          providerID: `provider-${i}`,
          modelID: `model-${i}`,
        } as Parameters<typeof includeJudgeInList>[0][number]["model"],
        authMethod: "api_key",
      }),
    )
    const samples: number[] = []
    for (let i = 0; i < N_ITER; i++) {
      const start = Bun.nanoseconds()
      includeJudgeInList(list, judge)
      samples.push(Bun.nanoseconds() - start)
    }
    const s = summarize(samples)
    console.log(`BENCH includeJudgeInList: p50=${s.p50}ns p95=${s.p95}ns p99=${s.p99}ns mean=${s.mean.toFixed(0)}ns`)
    expect(s.p99).toBeLessThan(100_000)
  })

  test(`discoverAvailableProviders (explicit branch, 10 providers, 1000 iters)`, async () => {
    const explicit = Array.from({ length: 10 }, (_, i) => ({
      providerID: `provider-${i}`,
      modelID: `model-${i}`,
    }))
    const samples: number[] = []
    for (let i = 0; i < N_ITER; i++) {
      const start = Bun.nanoseconds()
      await Effect.runPromise(discoverAvailableProviders(explicit))
      samples.push(Bun.nanoseconds() - start)
    }
    const s = summarize(samples)
    console.log(`BENCH explicit(10): p50=${s.p50}ns p95=${s.p95}ns p99=${s.p99}ns mean=${s.mean.toFixed(0)}ns`)
    expect(s.p99).toBeLessThan(5_000_000)
  })
})

describe("multi-model/provider-discovery — offline determinism stress", () => {
  test("1000 iterations of (no env, no auth) produce identical empty-or-InsufficientProvidersError", async () => {
    mock.module("../../src/provider/provider", () => ({ ...ProviderMod, Provider: { ...ProviderMod.Provider, list: async () => ({}) } }))
    mock.module("../../src/auth", () => ({ ...AuthMod, Auth: { ...AuthMod.Auth, all: async () => ({}) } }))

    let failureCount = 0
    for (let i = 0; i < 1000; i++) {
      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      if (exit._tag === "Failure") failureCount++
    }
    expect(failureCount).toBe(1000)
  })

  test("1000 iterations of (env-var auth, 3 providers) produce identical provider list", async () => {
    mock.module("../../src/provider/provider", () => ({
      ...ProviderMod,
      Provider: { ...ProviderMod.Provider, list: async () => SMALL_CATALOGUE },
    }))
    mock.module("../../src/auth", () => ({ ...AuthMod, Auth: { ...AuthMod.Auth, all: async () => ({}) } }))

    const baseline = await Effect.runPromise(discoverAvailableProviders())
    const baselineJSON = JSON.stringify(baseline)
    for (let i = 0; i < 1000; i++) {
      const r = await Effect.runPromise(discoverAvailableProviders())
      expect(JSON.stringify(r)).toBe(baselineJSON)
    }
  })
})
