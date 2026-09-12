/**
 * invoker.test.ts — TEAM-B03
 *
 * Unit tests for:
 *   - multi-model/model-invoker.ts   (success, cancellation, timeout,
 *     retry, offline/error paths, streaming, availability check)
 *   - multi-model/usage-normalizer.ts (token/cost normalization)
 *   - multi-model/cost-catalog.ts     (read-only lookup via injected fn)
 *
 * All executors are fakes — no real provider/network call is ever made.
 * Availability-check tests use discoverAvailableProviders' explicit
 * short-circuit branch (>= 2 explicit participants), which is the same
 * network-free branch already exercised in provider-discovery.test.ts.
 */

import { describe, expect, test } from "bun:test"

import {
  createModelInvoker,
  type ExecutorResult,
  type ModelExecutor,
  type ModelStreamExecutor,
  type StreamAggregator,
  type StreamChunk,
} from "../../src/multi-model/model-invoker"
import {
  makeInvocationRequestId,
  makeModelRef,
  ModelInvocationError,
  type InvocationRequest,
  type InvocationResult,
  type TokenUsage,
} from "../../src/multi-model/types"
import {
  computeCost,
  normalizeTokenUsage,
  normalizeDurationMs,
  normalizeUsage,
  type CostRates,
} from "../../src/multi-model/usage-normalizer"
import { createCostCatalog, costLookupFromRegistry } from "../../src/multi-model/cost-catalog"

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let requestCounter = 0
function buildRequest(model = makeModelRef("anthropic", "claude-sonnet-4-20250514")): InvocationRequest<string> {
  requestCounter += 1
  return {
    requestId: makeInvocationRequestId(`req-${requestCounter}`),
    model,
    endpoint: null,
    modalities: { input: ["text"], output: ["text"] },
    input: "hello",
  }
}

const ZERO_USAGE: TokenUsage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
}

function okResult<Output>(output: Output): ExecutorResult<Output> {
  return { output, usage: ZERO_USAGE, finishReason: "stop" }
}

function abortLikeError(): Error {
  const e = new Error("aborted")
  e.name = "AbortError"
  return e
}

/** Executor that "hangs" until either its internal timer or the signal fires. */
function makeHangingExecutor<Output>(result: ExecutorResult<Output>, hangMs = 5000): ModelExecutor<string, Output> {
  return (_request, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortLikeError())
        return
      }
      const timer = setTimeout(() => resolve(result), hangMs)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(abortLikeError())
        },
        { once: true },
      )
    })
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return undefined
  } catch (e) {
    return e
  }
}

function expectInvocationError(caught: unknown, code: string): void {
  if (!(caught instanceof ModelInvocationError)) {
    throw new Error(`expected a ModelInvocationError, got: ${String(caught)}`)
  }
  expect(caught.data.code).toBe(code)
}

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe("model-invoker — success path", () => {
  test("invoke() returns a well-formed InvocationResult", async () => {
    const request = buildRequest()
    const executor: ModelExecutor<string, string> = async () => okResult("hi there")
    const invoker = createModelInvoker({ executor })

    const result = await invoker.invoke(request)

    expect(result.requestId).toEqual(request.requestId)
    expect(result.model).toEqual(request.model)
    expect(result.output).toBe("hi there")
    expect(result.finishReason).toBe("stop")
    expect(result.usage).toEqual(ZERO_USAGE)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test("invoke() forwards providerRequestId when present", async () => {
    const request = buildRequest()
    const executor: ModelExecutor<string, string> = async () => ({
      ...okResult("x"),
      providerRequestId: "prov-123",
    })
    const invoker = createModelInvoker({ executor })

    const result = await invoker.invoke(request)
    expect(result.providerRequestId).toBe("prov-123")
  })
})

// ---------------------------------------------------------------------------
// Cancellation via AbortSignal
// ---------------------------------------------------------------------------

describe("model-invoker — cancellation", () => {
  test("pre-aborted signal short-circuits without calling the executor", async () => {
    const request = buildRequest()
    let calls = 0
    const executor: ModelExecutor<string, string> = async () => {
      calls++
      return okResult("never")
    }
    const invoker = createModelInvoker({ executor })
    const controller = new AbortController()
    controller.abort()

    const caught = await captureRejection(invoker.invoke(request, { signal: controller.signal }))
    expectInvocationError(caught, "E_CANCELLED")
    expect(calls).toBe(0)
  })

  test("mid-flight cancellation propagates as E_CANCELLED", async () => {
    const request = buildRequest()
    const executor = makeHangingExecutor(okResult("never"))
    const invoker = createModelInvoker({ executor })
    const controller = new AbortController()

    const promise = invoker.invoke(request, { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)

    const caught = await captureRejection(promise)
    expectInvocationError(caught, "E_CANCELLED")
  })
})

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("model-invoker — timeout", () => {
  test("exceeding timeoutMs propagates as E_TIMEOUT", async () => {
    const request = buildRequest()
    const executor = makeHangingExecutor(okResult("never"))
    const invoker = createModelInvoker({ executor })

    const caught = await captureRejection(invoker.invoke(request, { timeoutMs: 20 }))
    expectInvocationError(caught, "E_TIMEOUT")
  })

  test("default timeout from InvocationRequest.options.timeoutMs is honored", async () => {
    const request: InvocationRequest<string> = { ...buildRequest(), options: { timeoutMs: 20 } }
    const executor = makeHangingExecutor(okResult("never"))
    const invoker = createModelInvoker({ executor })

    const caught = await captureRejection(invoker.invoke(request))
    expectInvocationError(caught, "E_TIMEOUT")
  })

  test("completing before the timeout succeeds normally", async () => {
    const request = buildRequest()
    const executor = makeHangingExecutor(okResult("fast"), 5)
    const invoker = createModelInvoker({ executor })

    const result = await invoker.invoke(request, { timeoutMs: 2000 })
    expect(result.output).toBe("fast")
  })
})

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

describe("model-invoker — retry", () => {
  function makeFlakyExecutor(failTimes: number, ok: ExecutorResult<string>) {
    let calls = 0
    const executor: ModelExecutor<string, string> = async () => {
      calls++
      if (calls <= failTimes) {
        throw new ModelInvocationError({ code: "E_RATE_LIMIT", message: "rate limited (fake)" })
      }
      return ok
    }
    return { executor, callCount: () => calls }
  }

  test("retries a transient error until success", async () => {
    const request = buildRequest()
    const { executor, callCount } = makeFlakyExecutor(2, okResult("recovered"))
    const invoker = createModelInvoker({ executor, defaultRetry: { maxAttempts: 3, baseDelayMs: 1 } })

    const result = await invoker.invoke(request)
    expect(result.output).toBe("recovered")
    expect(callCount()).toBe(3)
  })

  test("exhausts retries and throws the last normalized error", async () => {
    const request = buildRequest()
    const { executor, callCount } = makeFlakyExecutor(5, okResult("unreached"))
    const invoker = createModelInvoker({ executor, defaultRetry: { maxAttempts: 2, baseDelayMs: 1 } })

    const caught = await captureRejection(invoker.invoke(request))
    expectInvocationError(caught, "E_RATE_LIMIT")
    expect(callCount()).toBe(2)
  })

  test("non-retryable errors are not retried even with maxAttempts > 1", async () => {
    const request = buildRequest()
    let calls = 0
    const executor: ModelExecutor<string, string> = async () => {
      calls++
      throw new Error("boom (generic, non-abort)")
    }
    const invoker = createModelInvoker({ executor, defaultRetry: { maxAttempts: 3, baseDelayMs: 1 } })

    const caught = await captureRejection(invoker.invoke(request))
    expectInvocationError(caught, "E_INTERNAL")
    expect(calls).toBe(1)
  })

  test("per-call retry option overrides the invoker default", async () => {
    const request = buildRequest()
    const { executor, callCount } = makeFlakyExecutor(1, okResult("ok"))
    const invoker = createModelInvoker({ executor, defaultRetry: { maxAttempts: 1 } })

    const result = await invoker.invoke(request, { retry: { maxAttempts: 2, baseDelayMs: 1 } })
    expect(result.output).toBe("ok")
    expect(callCount()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Offline / error paths (no network involved anywhere in this file)
// ---------------------------------------------------------------------------

describe("model-invoker — offline/error paths", () => {
  test("a generic thrown Error is normalized to E_INTERNAL with the original message captured", async () => {
    const request = buildRequest()
    const executor: ModelExecutor<string, string> = async () => {
      throw new Error("ECONNREFUSED (simulated offline)")
    }
    const invoker = createModelInvoker({ executor })

    const caught = await captureRejection(invoker.invoke(request))
    expectInvocationError(caught, "E_INTERNAL")
    if (caught instanceof ModelInvocationError) {
      expect(String(caught.data.issue)).toContain("ECONNREFUSED")
    }
  })

  test("a ModelInvocationError thrown by the executor passes through unchanged", async () => {
    const request = buildRequest()
    const executor: ModelExecutor<string, string> = async () => {
      throw new ModelInvocationError({ code: "E_AUTH", message: "invalid api key (fake)" })
    }
    const invoker = createModelInvoker({ executor })

    const caught = await captureRejection(invoker.invoke(request))
    expectInvocationError(caught, "E_AUTH")
  })
})

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

describe("model-invoker — streaming", () => {
  const joinAggregate: StreamAggregator<string> = (chunks) => ({
    output: chunks.map((c) => c.delta).join(""),
    usage: ZERO_USAGE,
    finishReason: "stop",
  })

  async function drive<Output>(gen: AsyncGenerator<StreamChunk<Output>, InvocationResult<Output>, void>) {
    const collected: StreamChunk<Output>[] = []
    let next = await gen.next()
    while (!next.done) {
      collected.push(next.value)
      next = await gen.next()
    }
    return { collected, result: next.value }
  }

  test("invokeStream() yields chunks then returns the aggregated InvocationResult", async () => {
    const request = buildRequest()
    const streamExecutor: ModelStreamExecutor<string, string> = async function* () {
      yield { delta: "Hello " }
      yield { delta: "world" }
    }
    const noopExecutor: ModelExecutor<string, string> = async () => okResult("unused")
    const invoker = createModelInvoker({ executor: noopExecutor, streamExecutor })

    const { collected, result } = await drive(invoker.invokeStream(request, joinAggregate))

    expect(collected).toHaveLength(2)
    expect(result.output).toBe("Hello world")
    expect(result.finishReason).toBe("stop")
    expect(result.requestId).toEqual(request.requestId)
  })

  test("invokeStream() without a configured streamExecutor throws E_UNAVAILABLE", async () => {
    const request = buildRequest()
    const noopExecutor: ModelExecutor<string, string> = async () => okResult("unused")
    const invoker = createModelInvoker({ executor: noopExecutor })

    const gen = invoker.invokeStream(request, joinAggregate)
    const caught = await captureRejection(gen.next())
    expectInvocationError(caught, "E_UNAVAILABLE")
  })

  test("cancelling mid-stream propagates as E_CANCELLED and stops further chunks", async () => {
    const request = buildRequest()
    const streamExecutor: ModelStreamExecutor<string, string> = async function* (_req, signal) {
      yield { delta: "a" }
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(abortLikeError())
          return
        }
        const timer = setTimeout(resolve, 5000)
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer)
            reject(abortLikeError())
          },
          { once: true },
        )
      })
      yield { delta: "b (unreachable)" }
    }
    const noopExecutor: ModelExecutor<string, string> = async () => okResult("unused")
    const invoker = createModelInvoker({ executor: noopExecutor, streamExecutor })
    const controller = new AbortController()

    const gen = invoker.invokeStream(request, joinAggregate, { signal: controller.signal })
    const first = await gen.next()
    expect(first.done).toBe(false)
    expect(first.value).toEqual({ delta: "a" })

    setTimeout(() => controller.abort(), 10)
    const caught = await captureRejection(gen.next())
    expectInvocationError(caught, "E_CANCELLED")
  })
})

// ---------------------------------------------------------------------------
// Availability check (consumes B02 discoverAvailableProviders, explicit
// short-circuit branch only — network-free)
// ---------------------------------------------------------------------------

describe("model-invoker — availability check", () => {
  const explicitParticipants = [
    { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    { providerID: "openai", modelID: "gpt-4.1" },
  ]

  test("invoke() proceeds when the requested model is among discovered participants", async () => {
    const model = makeModelRef("anthropic", "claude-sonnet-4-20250514")
    const request = buildRequest(model)
    const executor: ModelExecutor<string, string> = async () => okResult("ok")
    const invoker = createModelInvoker({
      executor,
      availabilityCheck: { enabled: true, explicitParticipants },
    })

    const result = await invoker.invoke(request)
    expect(result.output).toBe("ok")
  })

  test("invoke() rejects with E_UNAVAILABLE, without calling the executor, when the model is unknown", async () => {
    const model = makeModelRef("mistral", "mistral-large-latest")
    const request = buildRequest(model)
    let calls = 0
    const executor: ModelExecutor<string, string> = async () => {
      calls++
      return okResult("never")
    }
    const invoker = createModelInvoker({
      executor,
      availabilityCheck: { enabled: true, explicitParticipants },
    })

    const caught = await captureRejection(invoker.invoke(request))
    expectInvocationError(caught, "E_UNAVAILABLE")
    expect(calls).toBe(0)
  })

  test("availability check is skipped entirely when not enabled", async () => {
    const model = makeModelRef("mistral", "mistral-large-latest")
    const request = buildRequest(model)
    const executor: ModelExecutor<string, string> = async () => okResult("ok")
    const invoker = createModelInvoker({ executor })

    const result = await invoker.invoke(request)
    expect(result.output).toBe("ok")
  })
})

// ---------------------------------------------------------------------------
// usage-normalizer.ts
// ---------------------------------------------------------------------------

describe("usage-normalizer — normalizeTokenUsage", () => {
  test("maps canonical field names directly", () => {
    const usage = normalizeTokenUsage({ inputTokens: 100, outputTokens: 50, reasoningTokens: 10 })
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: 10,
    })
  })

  test("falls back to OpenAI-style prompt/completion field names", () => {
    const usage = normalizeTokenUsage({ promptTokens: 30, completionTokens: 12 })
    expect(usage.inputTokens).toBe(30)
    expect(usage.outputTokens).toBe(12)
  })

  test("falls back to Anthropic-style cache field names", () => {
    const usage = normalizeTokenUsage({
      inputTokens: 5,
      outputTokens: 5,
      cacheReadInputTokens: 7,
      cacheCreationInputTokens: 3,
    })
    expect(usage.cacheReadTokens).toBe(7)
    expect(usage.cacheWriteTokens).toBe(3)
  })

  test("defaults absent required counters to 0 and optional counters to null", () => {
    const usage = normalizeTokenUsage({})
    expect(usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    })
  })

  test("clamps negative token counts to 0", () => {
    const usage = normalizeTokenUsage({ inputTokens: -5, outputTokens: -1 })
    expect(usage.inputTokens).toBe(0)
    expect(usage.outputTokens).toBe(0)
  })
})

describe("usage-normalizer — normalizeDurationMs", () => {
  test("prefers explicit durationMs", () => {
    expect(normalizeDurationMs({ durationMs: 42 })).toBe(42)
  })

  test("falls back to endedAtMs - startedAtMs", () => {
    expect(normalizeDurationMs({ startedAtMs: 1000, endedAtMs: 1250 })).toBe(250)
  })

  test("defaults to 0 when nothing is available", () => {
    expect(normalizeDurationMs({})).toBe(0)
  })
})

describe("usage-normalizer — computeCost", () => {
  const usage: TokenUsage = {
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 200_000,
    cacheWriteTokens: 100_000,
    reasoningTokens: 50_000,
  }

  test("returns null when rates are unknown", () => {
    expect(computeCost(usage, null)).toBeNull()
  })

  test("computes per_1m_tokens cost across all categories", () => {
    const rates: CostRates = {
      currency: "USD",
      unit: "per_1m_tokens",
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
      reasoning: 15,
    }
    const cost = computeCost(usage, rates)
    expect(cost).not.toBeNull()
    if (!cost) return
    expect(cost.inputCost).toBeCloseTo(3, 5)
    expect(cost.outputCost).toBeCloseTo(7.5, 5)
    expect(cost.cacheReadCost).toBeCloseTo(0.06, 5)
    expect(cost.cacheWriteCost).toBeCloseTo(0.375, 5)
    expect(cost.reasoningCost).toBeCloseTo(0.75, 5)
    expect(cost.totalCost).toBeCloseTo(3 + 7.5 + 0.06 + 0.375 + 0.75, 5)
  })

  test("per_request rate is a flat charge independent of token counts", () => {
    const rates: CostRates = { currency: "USD", unit: "per_request", input: 0.01, output: 0.02 }
    const cost = computeCost(usage, rates)
    expect(cost).toEqual({
      currency: "USD",
      inputCost: 0.01,
      outputCost: 0.02,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      reasoningCost: 0,
      totalCost: 0.03,
    })
  })

  test("treats missing cache/reasoning rates as zero-cost, not an error", () => {
    const rates: CostRates = { currency: "USD", unit: "per_1m_tokens", input: 1, output: 2 }
    const cost = computeCost(usage, rates)
    expect(cost?.cacheReadCost).toBe(0)
    expect(cost?.cacheWriteCost).toBe(0)
    expect(cost?.reasoningCost).toBe(0)
  })
})

describe("usage-normalizer — normalizeUsage (combined entrypoint)", () => {
  test("combines tokens, duration and cost in one envelope", () => {
    const rates: CostRates = { currency: "USD", unit: "per_1m_tokens", input: 3, output: 15 }
    const normalized = normalizeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, durationMs: 120 }, rates)

    expect(normalized.tokens.inputTokens).toBe(1_000_000)
    expect(normalized.durationMs).toBe(120)
    expect(normalized.cost?.totalCost).toBeCloseTo(18, 5)
  })

  test("cost is null when rates are omitted", () => {
    const normalized = normalizeUsage({ inputTokens: 10, outputTokens: 5 })
    expect(normalized.cost).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// cost-catalog.ts
// ---------------------------------------------------------------------------

describe("cost-catalog — createCostCatalog (injected lookup, no registry import)", () => {
  const knownModel = makeModelRef("anthropic", "claude-sonnet-4-20250514")
  const knownRates: CostRates = { currency: "USD", unit: "per_1m_tokens", input: 3, output: 15 }

  function fakeLookup(model: { providerID: string; modelID: string }): CostRates | null {
    if (model.providerID === knownModel.providerID && model.modelID === knownModel.modelID) return knownRates
    return null
  }

  test("getRates resolves rates for a known model via the injected function", async () => {
    const catalog = createCostCatalog(fakeLookup)
    const rates = await catalog.getRates(knownModel)
    expect(rates).toEqual(knownRates)
  })

  test("getRates returns null for an unknown model rather than fabricating rates", async () => {
    const catalog = createCostCatalog(fakeLookup)
    const rates = await catalog.getRates(makeModelRef("mistral", "mistral-large-latest"))
    expect(rates).toBeNull()
  })

  test("computeCostFor resolves rates then computes cost", async () => {
    const catalog = createCostCatalog(fakeLookup)
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    }
    const cost = await catalog.computeCostFor(knownModel, usage)
    expect(cost?.inputCost).toBeCloseTo(3, 5)
  })

  test("computeCostFor returns null (not zero) when the model is unknown", async () => {
    const catalog = createCostCatalog(fakeLookup)
    const usage: TokenUsage = {
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    }
    const cost = await catalog.computeCostFor(makeModelRef("groq", "llama-3.3-70b-versatile"), usage)
    expect(cost).toBeNull()
  })
})

describe("cost-catalog — costLookupFromRegistry adapter", () => {
  test("adapts a registry-shaped getModel function into a CostLookupFn", async () => {
    const getModel = async (providerID: string, modelID: string) => {
      if (providerID === "anthropic" && modelID === "claude-sonnet-4-20250514") {
        return {
          pricing: {
            currency: "USD",
            unit: "per_1m_tokens" as const,
            input: 3,
            output: 15,
            cacheRead: 0.3,
            cacheWrite: null,
            reasoning: null,
          },
        }
      }
      return null
    }
    const lookup = costLookupFromRegistry(getModel)
    const rates = await lookup(makeModelRef("anthropic", "claude-sonnet-4-20250514"))
    expect(rates).toEqual({
      currency: "USD",
      unit: "per_1m_tokens",
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: null,
      reasoning: null,
    })
  })

  test("returns null when the adapted registry function reports no record", async () => {
    const getModel = async () => null
    const lookup = costLookupFromRegistry(getModel)
    const rates = await lookup(makeModelRef("unknown", "unknown-model"))
    expect(rates).toBeNull()
  })
})
