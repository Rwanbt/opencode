/* SPDX-License-Identifier: MIT */

/**
 * Strict JSON-RPC 2.0 message model.
 *
 * Everything crossing a transport boundary is untrusted input: it is parsed
 * here and nowhere else, and a message that does not match the specification
 * is rejected rather than coerced. No field is inferred, and unknown message
 * shapes never reach a handler.
 */

export type JsonRpcId = string | number

export type JsonRpcRequest = { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown }
export type JsonRpcNotification = { jsonrpc: "2.0"; method: string; params?: unknown }
export type JsonRpcSuccess = { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
export type JsonRpcErrorBody = { code: number; message: string; data?: unknown }
export type JsonRpcFailure = { jsonrpc: "2.0"; id: JsonRpcId | null; error: JsonRpcErrorBody }
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

/** Reserved codes from the JSON-RPC 2.0 specification, plus Unifia extensions. */
export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Extension: the peer did not answer within the caller's deadline. */
  timeout: -32001,
  /** Extension: the caller cancelled before the peer answered. */
  cancelled: -32002,
  /** Extension: the caller exceeded its request budget. */
  rateLimited: -32003,
  /** Extension: the caller is not authorised to invoke this method. */
  unauthorized: -32004,
} as const

export class JsonRpcError extends Error {
  readonly code: number
  readonly data?: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = "JsonRpcError"
    this.code = code
    this.data = data
  }
  toBody(): JsonRpcErrorBody {
    return this.data === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, data: this.data }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is JsonRpcId =>
  typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))

function parseErrorBody(value: unknown): JsonRpcErrorBody {
  if (!isRecord(value) || typeof value.code !== "number" || typeof value.message !== "string") {
    throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "malformed JSON-RPC error body")
  }
  return "data" in value ? { code: value.code, message: value.message, data: value.data } : { code: value.code, message: value.message }
}

/**
 * Validates one decoded JSON value as a JSON-RPC 2.0 message.
 *
 * @throws JsonRpcError when the value does not match the specification.
 */
export function parseJsonRpcMessage(value: unknown): JsonRpcMessage {
  if (!isRecord(value)) throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "message must be a JSON object")
  if (value.jsonrpc !== "2.0") throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "unsupported jsonrpc version")
  const hasId = "id" in value && value.id !== null
  if ("method" in value) {
    if (typeof value.method !== "string" || value.method.length === 0) throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "method must be a non-empty string")
    if ("params" in value && !isRecord(value.params) && !Array.isArray(value.params)) throw new JsonRpcError(JSON_RPC_ERRORS.invalidParams, "params must be a structured value")
    if (!hasId) return "params" in value ? { jsonrpc: "2.0", method: value.method, params: value.params } : { jsonrpc: "2.0", method: value.method }
    if (!isId(value.id)) throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "id must be a string or safe integer")
    return "params" in value ? { jsonrpc: "2.0", id: value.id, method: value.method, params: value.params } : { jsonrpc: "2.0", id: value.id, method: value.method }
  }
  if ("error" in value) {
    if (value.id !== null && !isId(value.id)) throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "error id must be an id or null")
    return { jsonrpc: "2.0", id: (value.id ?? null) as JsonRpcId | null, error: parseErrorBody(value.error) }
  }
  if ("result" in value) {
    if (!isId(value.id)) throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "result id must be a string or safe integer")
    return { jsonrpc: "2.0", id: value.id, result: value.result }
  }
  throw new JsonRpcError(JSON_RPC_ERRORS.invalidRequest, "message is neither a request, a response nor a notification")
}

export const isRequest = (message: JsonRpcMessage): message is JsonRpcRequest =>
  "method" in message && "id" in message

export const isNotification = (message: JsonRpcMessage): message is JsonRpcNotification =>
  "method" in message && !("id" in message)

export const isResponse = (message: JsonRpcMessage): message is JsonRpcResponse =>
  !("method" in message)

export const isFailure = (message: JsonRpcMessage): message is JsonRpcFailure => "error" in message
