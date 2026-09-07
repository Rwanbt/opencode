/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * HTTP Request executor (Phase 1) � a real runtime executor, not a stub.
 *
 * Contract:
 * - The attempt is allocated BEFORE any dispatch (effectKey per node),
 *   so a crash after the side effect but before the acknowledgement
 *   lands in UNKNOWN_EXTERNAL_STATE and follows the ratified
 *   reconcile-only path. No blind retry, ever.
 * - Config values may embed `$node` expressions (resolved by the
 *   driver before calling here; this module also accepts pre-resolved
 *   literals).
 * - Bounded: timeout, response bytes, redirects. Every failure is a
 *   typed `NodeExecutionError` carrying `retryable`.
 * - Redaction of sensitive headers/body happens at the journal and
 *   projection layers, never here: the executor returns exact data.
 * - No credentials in Phase 1: headers are literal config only. Any
 *   future credential reference must resolve through the secret
 *   broker, never inline secrets.
 */
import { NodeExecutionError, NODE_HTTP_MAX_REDIRECTS, NODE_HTTP_RESPONSE_MAX_BYTES, NODE_HTTP_TIMEOUT_MS, type NodeConfig } from "./io.js"

export type HttpRequestConfig = {
  readonly method: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly query?: Record<string, string>
  readonly body?: unknown
  readonly timeoutMs?: number
}

export type HttpResponseData = {
  readonly status: number
  readonly finalUrl: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

export function parseHttpConfig(config: NodeConfig): HttpRequestConfig {
  const method = config["method"]
  const url = config["url"]
  if (typeof method !== "string" || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(method)) {
    throw new NodeExecutionError("NODE_CONFIG_INVALID", `http node needs a valid method, got: ${JSON.stringify(method) ?? "missing"}`, false)
  }
  if (typeof url !== "string" || url.length === 0) {
    throw new NodeExecutionError("NODE_CONFIG_INVALID", "http node needs a non-empty url string", false)
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new NodeExecutionError("NODE_CONFIG_INVALID", `http node url is not absolute: ${url}`, false)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NodeExecutionError("NODE_CONFIG_INVALID", `http node url must be http(s): ${url}`, false)
  }
  const headers = config["headers"]
  if (headers !== undefined && (typeof headers !== "object" || headers === null || Array.isArray(headers))) {
    throw new NodeExecutionError("NODE_CONFIG_INVALID", "http node headers must be a string map", false)
  }
  const query = config["query"]
  if (query !== undefined && (typeof query !== "object" || query === null || Array.isArray(query))) {
    throw new NodeExecutionError("NODE_CONFIG_INVALID", "http node query must be a string map", false)
  }
  const timeoutMs = config["timeoutMs"]
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 0)) {
    throw new NodeExecutionError("NODE_CONFIG_INVALID", "http node timeoutMs must be a non-negative integer", false)
  }
  return {
    method: method.toUpperCase(),
    url,
    headers: headers as Record<string, string> | undefined,
    query: query as Record<string, string> | undefined,
    body: config["body"],
    timeoutMs: (timeoutMs as number | undefined) ?? NODE_HTTP_TIMEOUT_MS,
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/** Fetch failure causes where no byte provably left this process (DNS refused,
 * connection refused/unreachable). Anything else after dispatch - timeout,
 * reset, hangup - is conservatively UNKNOWN: the provider may have committed.
 */
const NEVER_DISPATCHED_CAUSE_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENETUNREACH",
])

function causeCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } }).cause
  return typeof cause?.code === "string" ? cause.code : undefined
}

/** Headers stripped on cross-origin hops and protocol downgrades. */
const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"])

function stripCredentials(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADERS.has(key.toLowerCase())) out[key] = value
  }
  return out
}

function isCrossOriginOrDowngrade(from: URL, to: URL): boolean {
  if (from.origin !== to.origin) return true
  return from.protocol === "https:" && to.protocol === "http:"
}

async function readBoundedBody(response: Response, abort: () => void, expectedBytes: number | null): Promise<string> {
  // Streamed with a byte counter: a chunked multi-gigabyte body without
  // Content-Length must abort BEFORE materializing, and the AbortController
  // stays armed for the whole body (a stalled body still times out).
  // Lengths are UTF-8 bytes everywhere, never JS string units.
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        bytes += value.byteLength
        if (bytes > NODE_HTTP_RESPONSE_MAX_BYTES) {
          abort()
          try {
            await reader.cancel()
          } catch {
            // The abort() above already tore the stream down, so cancel()
            // may legitimately reject on an ended reader. The over-limit
            // error below is the outcome that must reach the caller.
          }
          throw new NodeExecutionError(
            "HTTP_RESPONSE_TOO_LARGE",
            "http response body exceeds limit",
            false,
          )
        }
        chunks.push(value)
      }
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (expectedBytes !== null && bytes !== expectedBytes) {
    // Framing violation: fewer (or more) bytes than declared. Some fetch
    // implementations detect this themselves; the explicit check keeps the
    // guarantee for any injected fetchImpl. A truncated body is a mid-flight
    // unknown, never a success.
    throw new NodeExecutionError(
      "HTTP_NETWORK_ERROR",
      `http response truncated: read ${bytes} of ${expectedBytes} declared bytes`,
      false,
    )
  }
  return new TextDecoder().decode(merged)
}
export async function executeHttpRequest(
  config: HttpRequestConfig,
  fetchImpl: typeof fetch = fetch,
  startedAt: number = Date.now(),
): Promise<{ data: HttpResponseData; durationMs: number }> {
  const target = new URL(config.url)
  if (config.query) {
    for (const [key, value] of Object.entries(config.query)) target.searchParams.set(key, String(value))
  }
  // timeoutMs 0 honors the IR contract ("no timeout"): no timer is armed.
  // Absent/unset falls back to the bounded default. The controller stays
  // alive for the whole operation either way.
  const timeoutMs = config.timeoutMs ?? NODE_HTTP_TIMEOUT_MS
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  // Redirects are followed manually (not fetch-default) so the redirect
  // budget is explicit, deterministic and fail-closed, credentials never
  // cross origins, and the final URL is always recorded.
  let currentUrl = target.toString()
  let currentMethod = config.method
  let currentBody = config.body === undefined ? undefined : typeof config.body === "string" ? config.body : JSON.stringify(config.body)
  let hopHeaders: Record<string, string> = { ...(config.headers ?? {}) }
  let response: Response | undefined
  try {
    for (let hop = 0; hop <= NODE_HTTP_MAX_REDIRECTS; hop++) {
      const attempt = await fetchImpl(currentUrl, {
        method: currentMethod,
        headers: hopHeaders,
        body: currentBody,
        redirect: "manual",
        signal: controller.signal,
      })
      const location = attempt.headers.get("location")
      if (attempt.status >= 300 && attempt.status < 400 && location) {
        if (hop === NODE_HTTP_MAX_REDIRECTS) {
          throw new NodeExecutionError("HTTP_STATUS_ERROR", `http request exceeded ${NODE_HTTP_MAX_REDIRECTS} redirects`, false)
        }
        const next = new URL(location, currentUrl)
        if (isCrossOriginOrDowngrade(new URL(currentUrl), next)) hopHeaders = stripCredentials(hopHeaders)
        currentUrl = next.toString()
        if (attempt.status === 301 || attempt.status === 302 || attempt.status === 303) {
          if (currentMethod !== "GET" && currentMethod !== "HEAD") { currentMethod = "GET"; currentBody = undefined }
        }
        continue
      }
      response = attempt
      break
    }
    if (!response) throw new NodeExecutionError("HTTP_NETWORK_ERROR", `http request produced no response: ${config.method}`, true)
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new NodeExecutionError("HTTP_TIMEOUT", `http request timed out after ${timeoutMs}ms`, true)
    }
    const code = causeCode(error)
    if (code !== undefined && NEVER_DISPATCHED_CAUSE_CODES.has(code)) {
      throw new NodeExecutionError("HTTP_NETWORK_ERROR", `http request never dispatched`, true)
    }
    throw new NodeExecutionError("HTTP_NETWORK_ERROR", `http request failed mid-flight, outcome unknown`, false)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  // Body read failures past the headers are mid-flight unknowns (truncation, reset
  // during streaming): the provider may have committed. Typed non-retryable.
  let text: string
  try {
  const contentLength = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > NODE_HTTP_RESPONSE_MAX_BYTES) {
    throw new NodeExecutionError("HTTP_RESPONSE_TOO_LARGE", `http response declares over-limit bytes`, false)
  }
  // HEAD/204/304 carry no body by spec despite any declared length.
  const noBody = currentMethod === "HEAD" || response.status === 204 || response.status === 304
  const expectedBytes = !noBody && Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null
  text = await readBoundedBody(response, () => controller.abort(), expectedBytes)
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error
    throw new NodeExecutionError("HTTP_NETWORK_ERROR", "response body unreadable, outcome unknown", false)
  }
  const contentType = response.headers.get("content-type") ?? ""
  let body: unknown = text
  if (contentType.includes("application/json") && text.length > 0) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = text
    }
  }
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  if (!response.ok) {
    throw new NodeExecutionError(
      "HTTP_STATUS_ERROR",
      `http request failed with status`,
      isRetryableStatus(response.status),
    )
  }
  return { data: { status: response.status, finalUrl: currentUrl, headers, body }, durationMs: Date.now() - startedAt }
}
