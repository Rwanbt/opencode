/**
 * Mock LanguageModelV3 provider harness (Sprint 5 — item 1).
 *
 * Goal: allow unit tests to exercise code paths that call `streamText()` from
 * the `ai` SDK without reaching a real LLM. Complements `test/lib/llm-server.ts`
 * (which tests at the HTTP boundary) by plugging directly into the SDK's
 * `LanguageModelV3` contract, so tests can construct models inline without
 * standing up an HTTP server.
 *
 * Scope (conservative): only the subset of the `LanguageModelV3` interface used
 * by `streamText` / `wrapLanguageModel` (`doStream` is the hot path;
 * `doGenerate` returns a minimal, valid shape for callers that exercise it).
 *
 * API:
 *
 *   const model = createMockProvider({
 *     responses: [
 *       // Static text, FIFO consumption.
 *       { output: "hello" },
 *       // Matched against the prompt body via RegExp on the JSON-stringified
 *       // prompt. Only the first matching queued response is consumed.
 *       { input: /explore/, output: "explore-out" },
 *       // Error handshake — rejects before the first chunk. Mirrors a
 *       // pre-stream 503 for fallback-wiring tests.
 *       { output: Object.assign(new Error("upstream 503"), { status: 503 }) },
 *       // Async generator — each yield is streamed as a text-delta.
 *       { output: async function* () { yield "chunk1"; yield "chunk2" } },
 *       // AbortError — behaves like a user cancellation.
 *       { output: Object.assign(new Error("aborted"), { name: "AbortError" }) },
 *     ],
 *   })
 *
 * Consumption semantics:
 *   - FIFO across the `responses` array.
 *   - `input` acts as a filter: a queued entry is only eligible when its regex
 *     matches the current call's stringified prompt. Entries without `input`
 *     match anything.
 *   - When the queue is exhausted, `doStream`/`doGenerate` throw
 *     `MockProviderExhaustedError` — tests that forget to queue enough
 *     responses fail loudly instead of hanging.
 *
 * Error semantics:
 *   - A queued `Error` instance rejects the `doStream` promise itself (handshake
 *     failure, before any chunk is emitted). This is the important case for the
 *     fallback wrapper (item 2) — it distinguishes handshake-vs-mid-stream.
 *   - To simulate a mid-stream error, use an async generator that throws or use
 *     `{ output: "...", midStreamError: new Error("boom") }`.
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"

export type MockOutput =
  | string
  | Error
  | (() => AsyncGenerator<string, void, unknown>)

export interface MockResponse {
  /** Optional filter. The entry is only consumed when the prompt matches. */
  input?: RegExp
  /** Static text, error (handshake), or async generator (chunked stream). */
  output: MockOutput
  /**
   * When set alongside a string or generator `output`, emits the text first and
   * then pushes this error into the stream after the last chunk — used to
   * simulate mid-stream disconnects without crafting a generator.
   */
  midStreamError?: Error
  /** Optional per-entry usage override. */
  usage?: { inputTokens: number; outputTokens: number }
}

export class MockProviderExhaustedError extends Error {
  constructor(prompt: string) {
    super(
      `Mock provider queue exhausted (no matching entry). Prompt excerpt: ${prompt.slice(0, 200)}`,
    )
    this.name = "MockProviderExhaustedError"
  }
}

export interface MockProviderOptions {
  responses: MockResponse[]
  /** Provider identifier, visible via `model.provider`. Default "mock". */
  provider?: string
  /** Model identifier, visible via `model.modelId`. Default "mock-model". */
  modelId?: string
}

export interface MockProvider extends LanguageModelV3 {
  /** Number of `doStream` calls received (useful for fallback-wiring assertions). */
  readonly callCount: () => number
  /** Raw call log — prompts seen, in order. */
  readonly calls: () => LanguageModelV3CallOptions[]
  /** Remaining queued responses, for drift detection at teardown. */
  readonly pending: () => number
}

function promptString(options: LanguageModelV3CallOptions): string {
  try {
    return JSON.stringify(options.prompt)
  } catch {
    return String(options.prompt)
  }
}

function consume(responses: MockResponse[], prompt: string): MockResponse | undefined {
  // Prefer the earliest entry with a `input` regex that matches — lets tests
  // register prompt-specific responses alongside a generic catch-all without
  // worrying about ordering. If no input-matched entry is present, fall back
  // to the first catch-all (no `input`) entry.
  const specific = responses.findIndex((r) => r.input && r.input.test(prompt))
  if (specific !== -1) {
    const [taken] = responses.splice(specific, 1)
    return taken
  }
  const catchAll = responses.findIndex((r) => !r.input)
  if (catchAll !== -1) {
    const [taken] = responses.splice(catchAll, 1)
    return taken
  }
  return undefined
}

function textStream(text: string, id = "txt-0"): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
  ]
}

async function* generatorParts(
  gen: () => AsyncGenerator<string, void, unknown>,
  id = "txt-0",
): AsyncGenerator<LanguageModelV3StreamPart> {
  yield { type: "stream-start", warnings: [] }
  yield { type: "text-start", id }
  for await (const chunk of gen()) {
    yield { type: "text-delta", id, delta: chunk }
  }
  yield { type: "text-end", id }
}

function makeUsage(entry: MockResponse) {
  return {
    inputTokens: {
      total: entry.usage?.inputTokens ?? 0,
      noCache: entry.usage?.inputTokens ?? 0,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: entry.usage?.outputTokens ?? 0,
      text: entry.usage?.outputTokens ?? 0,
      reasoning: undefined,
    },
    totalTokens: (entry.usage?.inputTokens ?? 0) + (entry.usage?.outputTokens ?? 0),
  } as unknown as LanguageModelV3StreamPart extends infer _ ? any : any
}

function finishPart(entry: MockResponse): LanguageModelV3StreamPart {
  return {
    type: "finish",
    usage: makeUsage(entry),
    finishReason: { unified: "stop", raw: "stop" },
  }
}

export function createMockProvider(opts: MockProviderOptions): MockProvider {
  const queue: MockResponse[] = [...opts.responses]
  const calls: LanguageModelV3CallOptions[] = []

  const doStream = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
    calls.push(options)
    const prompt = promptString(options)
    const entry = consume(queue, prompt)
    if (!entry) throw new MockProviderExhaustedError(prompt)

    // Handshake failure — reject before the stream is constructed.
    if (entry.output instanceof Error) {
      throw entry.output
    }

    const isGenerator = typeof entry.output === "function"
    const staticText = typeof entry.output === "string" ? entry.output : null

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        try {
          if (staticText !== null) {
            for (const part of textStream(staticText)) controller.enqueue(part)
          } else if (isGenerator) {
            for await (const part of generatorParts(
              entry.output as () => AsyncGenerator<string, void, unknown>,
            )) {
              controller.enqueue(part)
            }
          }
          if (entry.midStreamError) {
            controller.enqueue({ type: "error", error: entry.midStreamError })
            controller.error(entry.midStreamError)
            return
          }
          controller.enqueue(finishPart(entry))
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })

    return { stream }
  }

  const doGenerate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
    calls.push(options)
    const prompt = promptString(options)
    const entry = consume(queue, prompt)
    if (!entry) throw new MockProviderExhaustedError(prompt)
    if (entry.output instanceof Error) throw entry.output
    let text = ""
    if (typeof entry.output === "string") text = entry.output
    else if (typeof entry.output === "function") {
      for await (const chunk of entry.output()) text += chunk
    }
    return {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: makeUsage(entry),
      warnings: [],
    } as unknown as LanguageModelV3GenerateResult
  }

  return {
    specificationVersion: "v3",
    provider: opts.provider ?? "mock",
    modelId: opts.modelId ?? "mock-model",
    supportedUrls: {},
    doGenerate,
    doStream,
    callCount: () => calls.length,
    calls: () => [...calls],
    pending: () => queue.length,
  }
}
