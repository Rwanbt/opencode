/* SPDX-License-Identifier: MIT */

/**
 * Newline-delimited JSON framing over an injected byte stream.
 *
 * This is the framing MCP uses for its stdio transport: one JSON-RPC message
 * per line, and a message may never contain a raw newline. JSON.stringify
 * escapes newlines inside strings, so encoding is safe by construction and the
 * decoder can split on U+000A without a state machine.
 *
 * The byte streams are injected rather than read from process.stdin/stdout so
 * the transport is testable without spawning a child process, and so a caller
 * cannot accidentally bind it to the wrong descriptor.
 */

import { JSON_RPC_ERRORS, JsonRpcError, parseJsonRpcMessage, type JsonRpcMessage } from "./jsonrpc.js"

export type ByteSink = { write(chunk: Uint8Array): void | Promise<void>; close?(): void | Promise<void> }

export type MessageTransport = {
  send(message: JsonRpcMessage): Promise<void>
  receive(): AsyncIterable<JsonRpcMessage>
  close(): Promise<void>
}

/**
 * Upper bound on a single framed message.
 *
 * WHY: without it a peer that never emits a newline forces the decoder to
 * accumulate its entire output in memory. The limit turns that into a bounded,
 * reported failure.
 */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024

export class StdioTransport implements MessageTransport {
  readonly #source: AsyncIterable<Uint8Array>
  readonly #sink: ByteSink
  readonly #maxMessageBytes: number
  #closed = false

  constructor(source: AsyncIterable<Uint8Array>, sink: ByteSink, maxMessageBytes = MAX_MESSAGE_BYTES) {
    this.#source = source
    this.#sink = sink
    this.#maxMessageBytes = maxMessageBytes
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.#closed) throw new JsonRpcError(JSON_RPC_ERRORS.internal, "transport is closed")
    const encoded = new TextEncoder().encode(`${JSON.stringify(message)}\n`)
    if (encoded.byteLength > this.#maxMessageBytes) throw new JsonRpcError(JSON_RPC_ERRORS.internal, "outgoing message exceeds the framing limit")
    await this.#sink.write(encoded)
  }

  async *receive(): AsyncIterable<JsonRpcMessage> {
    const decoder = new TextDecoder()
    let pending = ""
    for await (const chunk of this.#source) {
      pending += decoder.decode(chunk, { stream: true })
      let newlineIndex = pending.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex)
        pending = pending.slice(newlineIndex + 1)
        const message = decodeLine(line)
        if (message) yield message
        newlineIndex = pending.indexOf("\n")
      }
      if (pending.length > this.#maxMessageBytes) throw new JsonRpcError(JSON_RPC_ERRORS.parse, "unterminated message exceeds the framing limit")
    }
    // WHY: trailing bytes without a newline are an incomplete frame. Parsing
    // them would accept a truncated message as if the peer had finished.
    if (pending.trim().length > 0) throw new JsonRpcError(JSON_RPC_ERRORS.parse, "stream ended mid-message")
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#sink.close?.()
  }
}

function decodeLine(line: string): JsonRpcMessage | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  let decoded: unknown
  try {
    decoded = JSON.parse(trimmed)
  } catch {
    throw new JsonRpcError(JSON_RPC_ERRORS.parse, "frame is not valid JSON")
  }
  return parseJsonRpcMessage(decoded)
}

/** In-memory transport pair for tests and for a same-process peer. */
export function createLoopbackPair(): readonly [MessageTransport, MessageTransport] {
  const left = new MessageQueue()
  const right = new MessageQueue()
  return [new QueueTransport(right, left), new QueueTransport(left, right)] as const
}

class MessageQueue {
  readonly #buffered: JsonRpcMessage[] = []
  readonly #waiting: ((message: JsonRpcMessage | undefined) => void)[] = []
  #closed = false

  push(message: JsonRpcMessage): void {
    const waiter = this.#waiting.shift()
    if (waiter) waiter(message)
    else this.#buffered.push(message)
  }

  close(): void {
    this.#closed = true
    while (this.#waiting.length > 0) this.#waiting.shift()?.(undefined)
  }

  next(): Promise<JsonRpcMessage | undefined> {
    const buffered = this.#buffered.shift()
    if (buffered) return Promise.resolve(buffered)
    if (this.#closed) return Promise.resolve(undefined)
    return new Promise((resolve) => this.#waiting.push(resolve))
  }
}

class QueueTransport implements MessageTransport {
  constructor(private readonly outbound: MessageQueue, private readonly inbound: MessageQueue) {}

  async send(message: JsonRpcMessage): Promise<void> {
    // WHY: round-tripping through the codec keeps the loopback honest — a
    // message the real transport would reject must not pass here either.
    this.outbound.push(parseJsonRpcMessage(JSON.parse(JSON.stringify(message))))
  }

  async *receive(): AsyncIterable<JsonRpcMessage> {
    for (;;) {
      const message = await this.inbound.next()
      if (!message) return
      yield message
    }
  }

  async close(): Promise<void> {
    this.outbound.close()
    this.inbound.close()
  }
}
