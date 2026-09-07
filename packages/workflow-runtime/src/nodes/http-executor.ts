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

export async function executeHttpRequest(
  config: HttpRequestConfig,
  fetchImpl: typeof fetch = fetch,
  startedAt: number = Date.now(),
): Promise<{ data: HttpResponseData; durationMs: number }> {
  const target = new URL(config.url)
  if (config.query) {
    for (const [key, value] of Object.entries(config.query)) target.searchParams.set(key, String(value))
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, config.timeoutMs ?? NODE_HTTP_TIMEOUT_MS))
  // Redirects are followed manually (not fetch-default) so the redirect
  // budget is explicit, deterministic and fail-closed: over budget is a
  // typed non-retryable error, and the final URL is always recorded.
  let currentUrl = target.toString()
  let currentMethod = config.method
  let currentBody = config.body === undefined ? undefined : typeof config.body === "string" ? config.body : JSON.stringify(config.body)
  let response: Response | undefined
  try {
    for (let hop = 0; hop <= NODE_HTTP_MAX_REDIRECTS; hop++) {
      const attempt = await fetchImpl(currentUrl, {
        method: currentMethod,
        headers: config.headers,
        body: currentBody,
        redirect: "manual",
        signal: controller.signal,
      })
      const location = attempt.headers.get("location")
      if (attempt.status >= 300 && attempt.status < 400 && location) {
        if (hop === NODE_HTTP_MAX_REDIRECTS) {
          throw new NodeExecutionError("HTTP_STATUS_ERROR", `http request exceeded ${NODE_HTTP_MAX_REDIRECTS} redirects: ${config.method} ${target.host}${target.pathname}`, false)
        }
        currentUrl = new URL(location, currentUrl).toString()
        // 301/302/303 downgrade POST to GET per fetch semantics; 307/308 keep method+body.
        if (attempt.status === 301 || attempt.status === 302 || attempt.status === 303) {
          if (currentMethod !== "GET" && currentMethod !== "HEAD") { currentMethod = "GET"; currentBody = undefined }
        }
        continue
      }
      response = attempt
      break
    }
    if (!response) throw new NodeExecutionError("HTTP_NETWORK_ERROR", `http request produced no response: ${config.method} ${target.host}${target.pathname}`, true)
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new NodeExecutionError("HTTP_TIMEOUT", `http request timed out after ${config.timeoutMs}ms: ${config.method} ${target.host}${target.pathname}`, true)
    }
    throw new NodeExecutionError("HTTP_NETWORK_ERROR", `http request failed: ${error instanceof Error ? error.message : String(error)}`, true)
  } finally {
    clearTimeout(timeout)
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > NODE_HTTP_RESPONSE_MAX_BYTES) {
    throw new NodeExecutionError("HTTP_RESPONSE_TOO_LARGE", `http response declares ${contentLength} bytes, limit is ${NODE_HTTP_RESPONSE_MAX_BYTES}`, false)
  }
  const text = await response.text()
  if (text.length > NODE_HTTP_RESPONSE_MAX_BYTES) {
    throw new NodeExecutionError("HTTP_RESPONSE_TOO_LARGE", `http response body exceeds ${NODE_HTTP_RESPONSE_MAX_BYTES} bytes`, false)
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
      `http request failed with status ${response.status}: ${config.method} ${target.host}${target.pathname}`,
      isRetryableStatus(response.status),
    )
  }
  return { data: { status: response.status, finalUrl: currentUrl, headers, body }, durationMs: Date.now() - startedAt }
}
