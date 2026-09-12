/* SPDX-License-Identifier: MIT */

/**
 * Transport-agnostic JSON-RPC client: request/response correlation, deadlines,
 * cancellation, per-caller rate limiting and per-method authorisation.
 *
 * The client owns no protocol semantics beyond JSON-RPC itself. It deliberately
 * knows nothing about any specific MCP server, and connects to no external
 * provider: wiring a provider is a separate, provenance-reviewed decision.
 */

import {
  JSON_RPC_ERRORS,
  JsonRpcError,
  isFailure,
  isResponse,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
} from "./jsonrpc.js"
import type { MessageTransport } from "./stdio.js"

/** Port, not an implementation: the host injects its own limiter. */
export type RateLimiter = { take(key: string): boolean }

/** Port, not an implementation: the host decides which methods a caller may invoke. */
export type MethodAuthorizer = { authorize(method: string, caller: string): boolean }

export type JsonRpcClientOptions = {
  /** Default deadline applied to every call that does not override it. */
  timeoutMs?: number
  rateLimiter?: RateLimiter
  authorizer?: MethodAuthorizer
  /** Identity used as the rate-limit key and passed to the authorizer. */
  caller?: string
}

export type CallOptions = { timeoutMs?: number; signal?: AbortSignal }

const DEFAULT_TIMEOUT_MS = 30_000
const CANCELLED_NOTIFICATION = "notifications/cancelled"

type Pending = {
  resolve(result: unknown): void
  reject(error: Error): void
  dispose(): void
}

export class JsonRpcClient {
  readonly #transport: MessageTransport
  readonly #pending = new Map<JsonRpcId, Pending>()
  readonly #timeoutMs: number
  readonly #rateLimiter?: RateLimiter
  readonly #authorizer?: MethodAuthorizer
  readonly #caller: string
  #nextId = 1
  #draining = false
  #closed = false

  constructor(transport: MessageTransport, options: JsonRpcClientOptions = {}) {
    this.#transport = transport
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#rateLimiter = options.rateLimiter
    this.#authorizer = options.authorizer
    this.#caller = options.caller ?? "local"
  }

  /** Starts draining the transport. Idempotent. */
  start(): void {
    if (this.#draining) return
    this.#draining = true
    void this.#drain()
  }

  async call(method: string, params?: unknown, options: CallOptions = {}): Promise<unknown> {
    this.#guard(method)
    this.start()
    const id = this.#nextId++
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    return new Promise<unknown>((resolve, reject) => {
      this.#register(id, method, resolve, reject, timeoutMs, options.signal)
      this.#transport
        .send(params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params })
        .catch((error: unknown) => this.#settle(id, error instanceof Error ? error : new Error("send failed")))
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.#guard(method)
    const message: JsonRpcNotification = params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params }
    await this.#transport.send(message)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#rejectAll(new JsonRpcError(JSON_RPC_ERRORS.internal, "transport closed"))
    await this.#transport.close()
  }

  #guard(method: string): void {
    if (this.#closed) throw new JsonRpcError(JSON_RPC_ERRORS.internal, "client is closed")
    // WHY: authorisation is checked before the rate limiter so an unauthorised
    // method never consumes the caller's budget.
    if (this.#authorizer && !this.#authorizer.authorize(method, this.#caller)) {
      throw new JsonRpcError(JSON_RPC_ERRORS.unauthorized, `method is not authorised: ${method}`)
    }
    if (this.#rateLimiter && !this.#rateLimiter.take(this.#caller)) {
      throw new JsonRpcError(JSON_RPC_ERRORS.rateLimited, "caller exceeded its request budget")
    }
  }

  #register(id: JsonRpcId, method: string, resolve: (value: unknown) => void, reject: (error: Error) => void, timeoutMs: number, signal?: AbortSignal): void {
    const abandon = (error: JsonRpcError) => {
      // WHY: the peer is told to stop working on a request we stopped waiting
      // for. Failure to deliver the notification must not mask the original
      // timeout or cancellation, so it is swallowed deliberately.
      void this.notify(CANCELLED_NOTIFICATION, { requestId: id, reason: error.message }).catch(() => {})
      this.#settle(id, error)
    }
    const timer = setTimeout(() => abandon(new JsonRpcError(JSON_RPC_ERRORS.timeout, `request timed out after ${timeoutMs}ms: ${method}`)), timeoutMs)
    const onAbort = () => abandon(new JsonRpcError(JSON_RPC_ERRORS.cancelled, `request cancelled: ${method}`))
    signal?.addEventListener("abort", onAbort, { once: true })
    this.#pending.set(id, {
      resolve,
      reject,
      dispose: () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
      },
    })
    if (signal?.aborted) onAbort()
  }

  #settle(id: JsonRpcId, outcome: Error): void {
    const pending = this.#pending.get(id)
    if (!pending) return
    this.#pending.delete(id)
    pending.dispose()
    pending.reject(outcome)
  }

  #deliver(message: JsonRpcMessage): void {
    if (!isResponse(message)) return
    if (message.id === null) return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    pending.dispose()
    if (isFailure(message)) pending.reject(new JsonRpcError(message.error.code, message.error.message, message.error.data))
    else pending.resolve(message.result)
  }

  #rejectAll(error: Error): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id, error)
  }

  async #drain(): Promise<void> {
    try {
      for await (const message of this.#transport.receive()) this.#deliver(message)
      this.#rejectAll(new JsonRpcError(JSON_RPC_ERRORS.internal, "transport ended"))
    } catch (error) {
      this.#rejectAll(error instanceof Error ? error : new JsonRpcError(JSON_RPC_ERRORS.internal, "transport failed"))
    }
  }
}
