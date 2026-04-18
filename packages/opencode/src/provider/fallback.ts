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
