/* SPDX-License-Identifier: MIT */
import {
  JSON_RPC_ERRORS,
  JsonRpcClient,
  JsonRpcError,
  StdioTransport,
  createLoopbackPair,
  parseJsonRpcMessage,
  type JsonRpcMessage,
} from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

const rejects = async (run: () => Promise<unknown>, code: number, message: string): Promise<void> => {
  checks += 1
  try {
    await run()
  } catch (error) {
    if (error instanceof JsonRpcError && error.code === code) return
    throw new Error(`${message} (got ${error instanceof JsonRpcError ? error.code : String(error)})`)
  }
  throw new Error(`${message} (resolved instead of rejecting)`)
}

/**
 * The cancellation notification is fire-and-forget by design: the caller is
 * released as soon as its deadline expires, and the peer is told afterwards.
 * The assertion therefore polls instead of assuming same-tick delivery.
 */
const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
  checks += 1
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

const throws = (run: () => unknown, message: string): void => {
  checks += 1
  try {
    run()
  } catch {
    return
  }
  throw new Error(message)
}

// --- Codec ------------------------------------------------------------------
throws(() => parseJsonRpcMessage({ jsonrpc: "1.0", id: 1, method: "x" }), "codec accepted a non-2.0 version")
throws(() => parseJsonRpcMessage({ jsonrpc: "2.0", id: 1 }), "codec accepted a message with neither method, result nor error")
throws(() => parseJsonRpcMessage({ jsonrpc: "2.0", id: 1.5, method: "x" }), "codec accepted a non-integer numeric id")
throws(() => parseJsonRpcMessage({ jsonrpc: "2.0", id: 1, method: "" }), "codec accepted an empty method")
throws(() => parseJsonRpcMessage({ jsonrpc: "2.0", id: 1, method: "x", params: "scalar" }), "codec accepted a scalar params")
throws(() => parseJsonRpcMessage({ jsonrpc: "2.0", id: 1, error: { message: "no code" } }), "codec accepted an error body without a code")
throws(() => parseJsonRpcMessage([{ jsonrpc: "2.0" }]), "codec accepted an array as a message")
check(!("id" in parseJsonRpcMessage({ jsonrpc: "2.0", method: "ping" })), "codec did not treat an id-less message as a notification")
check(parseJsonRpcMessage({ jsonrpc: "2.0", id: 4, result: null }) !== undefined, "codec rejected a null result")
check((parseJsonRpcMessage({ jsonrpc: "2.0", id: null, error: { code: -1, message: "m" } }) as { id: unknown }).id === null, "codec dropped a null error id")

// --- Stdio framing ----------------------------------------------------------
const chunks = (...values: string[]): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (const value of values) yield new TextEncoder().encode(value)
  },
})
const collectSink = () => {
  const written: string[] = []
  return { written, write: (chunk: Uint8Array) => { written.push(new TextDecoder().decode(chunk)) } }
}

const sink = collectSink()
const writer = new StdioTransport(chunks(), sink)
await writer.send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
check(sink.written[0] === `{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n`, "stdio transport did not emit one newline-terminated frame")
check(!sink.written[0].slice(0, -1).includes("\n"), "stdio frame contains an embedded newline")

const embedded = collectSink()
await new StdioTransport(chunks(), embedded).send({ jsonrpc: "2.0", id: 2, method: "echo", params: { text: "line1\nline2" } })
check(embedded.written[0].split("\n").length === 2, "a newline inside a string value broke the framing")

const split = new StdioTransport(chunks('{"jsonrpc":"2.0","id":1,', '"result":7}\n{"jsonrpc":"2.0","id":2,"result":8}\n'), collectSink())
const received: JsonRpcMessage[] = []
for await (const message of split.receive()) received.push(message)
check(received.length === 2, "framing did not reassemble a message split across chunks")
check((received[0] as { result: unknown }).result === 7 && (received[1] as { result: unknown }).result === 8, "framing reassembled the wrong payloads")

const truncated = new StdioTransport(chunks('{"jsonrpc":"2.0","id":1,"result":1}'), collectSink())
await rejects(async () => { for await (const _ of truncated.receive()) void _ }, JSON_RPC_ERRORS.parse, "framing accepted a stream that ended mid-message")

const oversized = new StdioTransport(chunks("x".repeat(64)), collectSink(), 16)
await rejects(async () => { for await (const _ of oversized.receive()) void _ }, JSON_RPC_ERRORS.parse, "framing accepted an unterminated message beyond the limit")

const badJson = new StdioTransport(chunks("not json\n"), collectSink())
await rejects(async () => { for await (const _ of badJson.receive()) void _ }, JSON_RPC_ERRORS.parse, "framing accepted a frame that is not JSON")

// --- Client: correlation, deadlines, cancellation ---------------------------
const serve = (transport: import("../src/index.js").MessageTransport, handler: (method: string, params: unknown) => unknown | Promise<unknown>, seen?: string[]) => {
  void (async () => {
    for await (const message of transport.receive()) {
      if (!("method" in message)) continue
      seen?.push(message.method)
      if (!("id" in message)) continue
      const { id, method, params } = message
      // WHY dispatched instead of awaited: awaiting the handler inside the read
      // loop would make one slow request block every later message, including
      // the cancellation notification that is supposed to unblock it. A real
      // server does not serialise requests behind a pending one either.
      void (async () => {
        try {
          await transport.send({ jsonrpc: "2.0", id, result: await handler(method, params) })
        } catch (error) {
          await transport.send({ jsonrpc: "2.0", id, error: { code: JSON_RPC_ERRORS.internal, message: String(error) } })
        }
      })()
    }
  })()
}

const [clientSide, serverSide] = createLoopbackPair()
const serverMethods: string[] = []
serve(serverSide, (method, params) => {
  if (method === "fail") throw new Error("handler exploded")
  if (method === "slow") return new Promise(() => {})
  return { method, params }
}, serverMethods)
const client = new JsonRpcClient(clientSide, { timeoutMs: 200 })

const answered = await Promise.all([client.call("a", { n: 1 }), client.call("b", { n: 2 }), client.call("c", { n: 3 })])
check(answered.map((entry) => (entry as { method: string }).method).join(",") === "a,b,c", "client mis-correlated concurrent responses")
check((answered[1] as { params: { n: number } }).params.n === 2, "client returned the wrong payload for a concurrent call")
await rejects(() => client.call("fail"), JSON_RPC_ERRORS.internal, "client did not surface a peer error as a rejection")

await rejects(() => client.call("slow", undefined, { timeoutMs: 50 }), JSON_RPC_ERRORS.timeout, "client did not enforce the call deadline")
await waitFor(() => serverMethods.includes("notifications/cancelled"), "client did not notify the peer after a timeout")

const controller = new AbortController()
const cancelled = client.call("slow", undefined, { signal: controller.signal })
controller.abort()
await rejects(() => cancelled, JSON_RPC_ERRORS.cancelled, "client did not reject an aborted call")

const preAborted = AbortSignal.abort()
await rejects(() => client.call("slow", undefined, { signal: preAborted }), JSON_RPC_ERRORS.cancelled, "client did not reject a call with an already-aborted signal")

// --- Client: authorisation and rate limiting --------------------------------
const [guardedClientSide, guardedServerSide] = createLoopbackPair()
const guardedSeen: string[] = []
serve(guardedServerSide, (method) => ({ method }), guardedSeen)
let budget = 2
const guarded = new JsonRpcClient(guardedClientSide, {
  timeoutMs: 200,
  caller: "principal-1",
  authorizer: { authorize: (method) => method.startsWith("tools/") || method === "notifications/cancelled" },
  rateLimiter: { take: () => (budget > 0 ? (budget -= 1) >= 0 : false) },
})
check((await guarded.call("tools/list") as { method: string }).method === "tools/list", "authorised method was rejected")
await rejects(() => guarded.call("secret/read"), JSON_RPC_ERRORS.unauthorized, "unauthorised method was not refused")
check(!guardedSeen.includes("secret/read"), "an unauthorised method reached the peer")
check(budget === 1, "an unauthorised method consumed the rate-limit budget")
await guarded.call("tools/call")
await rejects(() => guarded.call("tools/call"), JSON_RPC_ERRORS.rateLimited, "the rate limiter did not refuse a call over budget")

await client.close()
await rejects(() => client.call("a"), JSON_RPC_ERRORS.internal, "a closed client still accepted calls")

const [orphanClientSide, orphanServerSide] = createLoopbackPair()
const orphan = new JsonRpcClient(orphanClientSide, { timeoutMs: 5_000 })
const abandoned = orphan.call("never")
await orphanServerSide.close()
await rejects(() => abandoned, JSON_RPC_ERRORS.internal, "a pending call was not rejected when the transport ended")

console.log(`McpTransport: ${checks}/${checks} passed`)
