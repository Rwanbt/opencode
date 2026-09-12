import { describe, expect, test } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { isTeamFallbackEligible, withStreamingFallbackChain } from "../../src/provider/fallback"

function model(name: string, generate: () => Promise<unknown>): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: name,
    modelId: name,
    supportedUrls: {},
    doGenerate: generate as LanguageModelV3["doGenerate"],
    doStream: async () => ({
      stream: new ReadableStream({ start: (controller) => controller.close() }),
    }) as never,
  }
}

function streamModel(name: string, stream: () => Promise<ReadableStream<never>>, calls: string[]): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: name,
    modelId: name,
    supportedUrls: {},
    doGenerate: async () => ({}) as never,
    doStream: async () => {
      calls.push(name)
      return { stream: await stream() } as never
    },
  }
}

function failedStream(error: unknown) {
  return new ReadableStream<never>({
    start(controller) {
      controller.error(error)
    },
  })
}

describe("Team provider fallback", () => {
  test("recognizes the MiniMax 2066 retry error", () => {
    const error = Object.assign(
      new Error("Failed after 3 attempts. Last error: The request timed out while processing. Please try again later. (2066)"),
      {
        name: "AI_RetryError",
        errors: [Object.assign(new Error("request timed out"), { code: 2066 })],
      },
    )
    expect(isTeamFallbackEligible(error)).toBe(true)
  })

  test("allows another selected provider after auth or quota failure", () => {
    expect(isTeamFallbackEligible(Object.assign(new Error("invalid API key"), { status: 401 }))).toBe(true)
    expect(isTeamFallbackEligible(Object.assign(new Error("insufficient quota"), { code: "insufficient_quota" }))).toBe(true)
  })

  test("never falls back after user cancellation", () => {
    expect(isTeamFallbackEligible(Object.assign(new Error("cancelled"), { name: "AbortError" }))).toBe(false)
  })

  test("walks the selected models until one succeeds", async () => {
    const calls: string[] = []
    const chain = withStreamingFallbackChain(
      [
        model("minimax", async () => {
          calls.push("minimax")
          throw Object.assign(new Error("request timed out"), { code: 2066 })
        }),
        model("google", async () => {
          calls.push("google")
          throw Object.assign(new Error("invalid API key"), { status: 401 })
        }),
        model("mistral", async () => {
          calls.push("mistral")
          return { provider: "mistral" }
        }),
      ],
      { shouldFallback: isTeamFallbackEligible },
    )

    const result = (await chain.doGenerate({} as never)) as unknown as { provider: string }
    expect(result.provider).toBe("mistral")
    expect(calls).toEqual(["minimax", "google", "mistral"])
  })

  test("walks the chain when streaming providers fail before content", async () => {
    const calls: string[] = []
    const success = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", id: "answer", delta: "ok" })
        controller.close()
      },
    })
    const chain = withStreamingFallbackChain(
      [
        streamModel("minimax", async () => failedStream(Object.assign(new Error("timed out"), { code: 2066 })), calls),
        streamModel("google", async () => {
          throw Object.assign(new Error("rate limited"), { status: 429 })
        }, calls),
        streamModel("mistral", async () => success as ReadableStream<never>, calls),
      ],
      { shouldFallback: isTeamFallbackEligible },
    )

    const result = await chain.doStream({} as never)
    const parts = []
    const reader = result.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }

    expect(calls).toEqual(["minimax", "google", "mistral"])
    expect(parts).toEqual([{ type: "text-delta", id: "answer", delta: "ok" }])
  })

  test("does not hide a non-provider request error", async () => {
    const calls: string[] = []
    const chain = withStreamingFallbackChain(
      [
        model("primary", async () => {
          calls.push("primary")
          throw Object.assign(new Error("invalid request body"), { status: 400 })
        }),
        model("secondary", async () => {
          calls.push("secondary")
          return { provider: "secondary" }
        }),
      ],
      { shouldFallback: isTeamFallbackEligible },
    )

    await expect(chain.doGenerate({} as never)).rejects.toThrow("invalid request body")
    expect(calls).toEqual(["primary"])
  })

  test("rejects an empty chain", () => {
    expect(() => withStreamingFallbackChain([])).toThrow("at least one model")
  })

  test("forwards every part in order once the primary is streaming", async () => {
    const calls: string[] = []
    const source = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue({ type: "text-delta", id: "answer", delta: String(i) })
        controller.close()
      },
    })
    const chain = withStreamingFallbackChain(
      [
        streamModel("minimax", async () => source as ReadableStream<never>, calls),
        streamModel("google", async () => new ReadableStream<never>(), calls),
      ],
      { shouldFallback: isTeamFallbackEligible },
    )

    const result = await chain.doStream({} as never)
    const deltas: string[] = []
    const reader = result.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      deltas.push((value as { delta: string }).delta)
    }

    expect(deltas).toEqual(["0", "1", "2", "3", "4"])
    expect(calls).toEqual(["minimax"])
  })

  // Regression: the stitched stream used to drain the upstream inside start(),
  // which runs to completion regardless of the consumer. A Team chain nests one
  // wrapper per selected model, so each unbounded queue stacked up in memory.
  // With pull() the producer is paced by the consumer, so a consumer that has
  // read 3 parts must not have pulled the whole upstream.
  test("does not drain the upstream ahead of the consumer", async () => {
    const total = 500
    let produced = 0
    const source = new ReadableStream({
      pull(controller) {
        if (produced >= total) {
          controller.close()
          return
        }
        produced++
        controller.enqueue({ type: "text-delta", id: "answer", delta: String(produced) })
      },
    })
    const chain = withStreamingFallbackChain(
      [
        streamModel("minimax", async () => source as ReadableStream<never>, []),
        streamModel("google", async () => new ReadableStream<never>(), []),
      ],
      { shouldFallback: isTeamFallbackEligible },
    )

    const result = await chain.doStream({} as never)
    const reader = result.stream.getReader()
    for (let i = 0; i < 3; i++) await reader.read()

    // Give an unpaced producer room to run away. A start()-driven drain loop
    // keeps pumping on its own microtasks while the consumer sits idle, so
    // without this settle window the assertion below passes for the wrong
    // reason (the loop simply had not got far enough yet).
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Exact count depends on queue high-water marks; the invariant is that it
    // stays proportional to what was consumed, not to the size of the upstream.
    expect(produced).toBeLessThan(50)
    await reader.cancel()
  })
})
