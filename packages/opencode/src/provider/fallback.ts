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
