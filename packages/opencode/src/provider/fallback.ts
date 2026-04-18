/**
 * Cascading provider fallback (I10).
 *
 * Usage:
 *   const result = await withFallback(
 *     () => callCloud(request),
 *     () => callLocal(request),
 *     { label: "chat.stream" },
 *   )
 *
 * Contract:
 *   - Tries `primary` once.
 *   - On network-class errors (fetch failure, AbortError, 5xx, timeout),
 *     retries `secondary` once. All other errors bubble up immediately.
 *   - Never retries on 4xx (client error — fallback would just repeat the same
 *     mistake) or on aborted-by-user signals.
 *
 * This helper is opt-in: the default provider path does not call it. Enable it
 * by reading `experimental.provider.fallback` at the call site and choosing
 * which primary/secondary pair to pass. Keeping the switch at the call site
 * avoids magic behaviour for users who haven't opted in.
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import { Log } from "../util/log"

const log = Log.create({ service: "provider.fallback" })

export interface FallbackOptions {
  label?: string
  /** Override the default heuristic for "is this a retryable network error". */
  shouldFallback?: (err: unknown) => boolean
}

/**
 * Detect whether an error represents a network/5xx/timeout condition where
 * retrying against a different provider makes sense.
 */
export function isNetworkRetryable(err: unknown): boolean {
  if (!err) return false
  if (err instanceof Error) {
    // User-initiated aborts must NOT trigger a fallback — they indicate intent.
    if (err.name === "AbortError" && (err as any).cause?.name !== "TimeoutError") {
      return false
    }
    if (err.name === "TimeoutError") return true
    const msg = err.message.toLowerCase()
    if (msg.includes("fetch failed")) return true
    if (msg.includes("network")) return true
    if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout")) return true
    if (msg.includes("enotfound")) return true
    if (msg.includes("socket hang up")) return true
  }
  // Tolerate errors that expose an HTTP-style status.
  const status = (err as any)?.status ?? (err as any)?.statusCode
  if (typeof status === "number") {
    if (status >= 500 && status < 600) return true
    if (status === 408 || status === 429) return true
  }
  return false
}

/**
 * Streaming-aware fallback (Sprint 4 design note).
 *
 * The `withFallback` helper below is the *non-streaming* case. For the AI SDK
 * `streamText()` pipeline used in `session/llm.ts`, a single retryable failure
 * can happen in two distinct windows:
 *
 *   1. **Before the first chunk** — HTTP handshake, 503, connection refused,
 *      timeout. In this window, falling back to a second provider is safe:
 *      no tokens have been streamed to the caller, so there is nothing to
 *      reconcile. Implementation: race the first `textDelta`/`toolCall`/`error`
 *      event against `AbortSignal.timeout(handshakeMs)`. On error/timeout,
 *      tear down the primary stream and start the secondary.
 *
 *   2. **After the first chunk** — mid-stream disconnect, provider crash. A
 *      naive retry on the secondary would re-send a fresh prompt and emit a
 *      second "assistant" message over the wire, producing duplicated or
 *      conflicting state in the UI. Correct handling requires either
 *      (a) replay the partial text as a synthetic "user" message to the
 *      secondary and resume (complex, provider-specific), or
 *      (b) surface the error to the caller and let the session resume flow
 *      (already present via `SessionStatus.Event.TaskCancelled` + /resume)
 *      reissue the request. We pick (b): propagate the error unchanged.
 *
 * Integration plan (deferred — requires streamText wrapper refactor):
 *
 *   - Introduce `buildLanguageModel(primaryID, secondaryID?)` in provider.ts
 *     that returns a `wrapLanguageModel`-compatible LMv2 middleware which:
 *       * calls primary.doStream()
 *       * buffers the first `ReadableStream` read into a small window
 *       * on handshake error / first-chunk-timeout, retries secondary.doStream()
 *       * otherwise forwards the primary stream untouched
 *   - Gate on `experimental.provider.fallback`:
 *       "local"  => primary=<configured-cloud>, secondary=<local-llm-server @ :14097>
 *       "cloud"  => primary=<local-llm>, secondary=<first-configured-cloud>
 *       null     => no wrap, LMv2 identity
 *   - The decision is made once at request setup (`session/llm.ts` buildModel)
 *     so the streamText call signature does NOT change.
 *
 * Until the wrapper lands, this module exposes the non-streaming helper below
 * plus `isNetworkRetryable` for reuse in the wrapper.
 */

/**
 * Try `primary`, and on a retryable network failure, try `secondary` once.
 *
 * Both callbacks are expected to be idempotent enough that a second call is
 * safe. For streaming calls where partial state leaks on failure, wrap your
 * own recovery logic instead of using this helper.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  secondary: () => Promise<T>,
  opts: FallbackOptions = {},
): Promise<T> {
  const check = opts.shouldFallback ?? isNetworkRetryable
  try {
    return await primary()
  } catch (err) {
    if (!check(err)) throw err
    log.warn("primary failed, falling back to secondary", {
      label: opts.label,
      error: (err as Error)?.message ?? String(err),
    })
    try {
      return await secondary()
    } catch (err2) {
      log.warn("secondary also failed", {
        label: opts.label,
        error: (err2 as Error)?.message ?? String(err2),
      })
      throw err2
    }
  }
}

/**
 * Resolve which fallback direction is active based on the runtime config.
 * Returns `null` when the feature is disabled (default).
 *
 * Consumed by the streamText wrapper (once implemented) to decide whether to
 * wrap the primary model with a secondary. Exposed here so tests can exercise
 * the resolution without reaching into Config internals.
 */
export type FallbackDirection = "local" | "cloud" | null

/**
 * Wrap two `LanguageModelV3` instances so that handshake-class failures on
 * `primary.doStream` (connection refused, 5xx before the first chunk, timeout)
 * cause a single retry against `secondary`. Once the first chunk is received
 * from primary, errors propagate unchanged (no mid-stream retry — see design
 * note above for rationale).
 *
 * The returned model appears as a regular `LanguageModelV3`. The `provider`
 * and `modelId` fields are inherited from primary for observability.
 *
 * Gate this at the call site on `experimental.provider.fallback`. When the
 * flag is null/unset, the caller must pass the primary model unwrapped, so
 * behaviour is byte-identical to the pre-wrapper code path.
 */
export function withStreamingFallback(
  primary: LanguageModelV3,
  secondary: LanguageModelV3,
  opts: { label?: string } = {},
): LanguageModelV3 {
  const label = opts.label ?? `${primary.provider}/${primary.modelId}`

  const doStream = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
    // Handshake retry: attempt primary. If the promise itself rejects (pre-stream
    // failure), or if the first pull from the stream fails synchronously with a
    // retryable error, switch to secondary. If the primary returns a stream AND
    // the first chunk reads cleanly, we forward the rest of that stream as-is.
    let primaryResult: LanguageModelV3StreamResult
    try {
      primaryResult = await primary.doStream(options)
    } catch (err) {
      if (!isNetworkRetryable(err)) throw err
      log.warn("primary handshake failed, falling back to secondary", {
        label,
        error: (err as Error)?.message ?? String(err),
      })
      return secondary.doStream(options)
    }

    // Peek the first chunk. If it is a `stream-start` warning followed by an
    // `error` part (or if the reader throws on first read), we treat this as a
    // handshake failure too — the primary TCP/HTTP succeeded but the provider
    // immediately signalled an error before emitting any content.
    const reader = primaryResult.stream.getReader()
    let firstBatch: LanguageModelV3StreamPart[] = []
    let preChunkError: unknown
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        firstBatch.push(value)
        // Stop buffering once we see a token-bearing or terminal part.
        if (
          value.type === "text-delta" ||
          value.type === "reasoning-delta" ||
          value.type === "tool-input-delta" ||
          value.type === "tool-input-start" ||
          value.type === "finish"
        ) {
          break
        }
        if (value.type === "error") {
          preChunkError = (value as { type: "error"; error: unknown }).error
          break
        }
      }
    } catch (err) {
      preChunkError = err
    }

    if (preChunkError && isNetworkRetryable(preChunkError)) {
      log.warn("primary errored before first chunk, falling back to secondary", {
        label,
        error: (preChunkError as Error)?.message ?? String(preChunkError),
      })
      // Drain/ignore the rest of primary's stream — it's already dead.
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      return secondary.doStream(options)
    }

    // Stitch: re-emit the buffered parts, then continue pulling from primary.
    // Any error after this point propagates — we do NOT attempt secondary.
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        try {
          for (const part of firstBatch) controller.enqueue(part)
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason)
        } catch {
          // ignore
        }
      },
    })

    return { stream, request: primaryResult.request, response: primaryResult.response }
  }

  const doGenerate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
    try {
      return await primary.doGenerate(options)
    } catch (err) {
      if (!isNetworkRetryable(err)) throw err
      log.warn("primary doGenerate failed, falling back to secondary", {
        label,
        error: (err as Error)?.message ?? String(err),
      })
      return secondary.doGenerate(options)
    }
  }

  return {
    specificationVersion: "v3",
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate,
    doStream,
  }
}

export async function resolveFallbackDirection(): Promise<FallbackDirection> {
  try {
    const { Config } = await import("../config/config")
    const cfg = await Config.get()
    const dir = (cfg as any)?.experimental?.provider?.fallback
    if (dir === "local" || dir === "cloud") return dir
    return null
  } catch {
    return null
  }
}
