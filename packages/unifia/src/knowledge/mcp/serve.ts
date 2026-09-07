/* SPDX-License-Identifier: MIT */
/**
 * MCP knowledge daemon (card C26).
 *
 * `composeMcpServer()` produced an authenticated, bounded server that nothing
 * exposed, and a token lived only as long as the process that issued it. This
 * module is the process: it holds one server and one registry for its whole
 * lifetime and answers JSON-RPC over an injected transport, so a token issued
 * at startup stays valid for every call that follows.
 *
 * Framing and error codes come from `@unifia/mcp-transport`; this file adds
 * only the dispatch and the mapping from knowledge failures to JSON-RPC
 * errors. A second JSON-RPC implementation would be a second place for the
 * two to disagree.
 */

import {
  JSON_RPC_ERRORS,
  isRequest,
  type JsonRpcMessage,
  type MessageTransport,
} from "@unifia/mcp-transport"
import { z } from "zod"
import type { McpKnowledgeCapability } from "@unifia/contracts/knowledge"
import {
  MCP_KNOWLEDGE_METHODS,
  McpKnowledgeSearchRequestSchema,
  McpKnowledgeGetRequestSchema,
  McpKnowledgeBacklinksRequestSchema,
  McpKnowledgeTraceRequestSchema,
  McpKnowledgeProposeRequestSchema,
} from "@unifia/contracts/knowledge"
import { composeMcpServer, type ComposedMcp } from "./compose.js"
import {
  McpOversizedPayload,
  McpRateLimitExceeded,
  McpUnauthorized,
  type McpCallContext,
} from "./server.js"

/**
 * The transport envelope.
 *
 * Authentication is carried beside the payload, never inside it: the business
 * schemas are `.strict()` and do not declare a token, and mixing the two
 * would mean either loosening every contract or validating credentials with
 * a schema that knows nothing about them.
 */
const EnvelopeSchema = z
  .object({
    token: z.string().min(1),
    request: z.unknown(),
  })
  .strict()

/**
 * `knowledge_status` has no request schema in the contracts because the
 * server method takes no request. The envelope still names a workspace, so it
 * is validated here rather than trusted.
 */
const StatusRequestSchema = z.object({ workspace: z.string().min(1) }).strict()

/** Method to official request schema. One table, no rules restated. */
const REQUEST_SCHEMAS: Record<McpKnowledgeCapability, z.ZodTypeAny> = {
  knowledge_search: McpKnowledgeSearchRequestSchema,
  knowledge_get: McpKnowledgeGetRequestSchema,
  knowledge_backlinks: McpKnowledgeBacklinksRequestSchema,
  knowledge_trace: McpKnowledgeTraceRequestSchema,
  knowledge_status: StatusRequestSchema,
  knowledge_propose: McpKnowledgeProposeRequestSchema,
}

/** A payload that failed its schema. Distinct from an authorisation failure. */
export class InvalidRequestParams extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidRequestParams"
  }
}

export interface ServeInput {
  workspaceRoot: string
  transport: MessageTransport
  /** Token lifetime for the session token minted at startup. */
  ttlMs?: number
  /** Methods the session token may call. Defaults to the read-only set. */
  methods?: readonly McpKnowledgeCapability[]
}

export interface ServeHandle {
  /** The token a client must present. Valid for the daemon's lifetime. */
  tokenId: string
  composed: ComposedMcp
  /** Resolves when the transport closes. */
  done: Promise<void>
}

/** Map a failure onto a JSON-RPC error body without leaking internals. */
function toErrorBody(e: unknown): { code: number; message: string } {
  if (e instanceof McpUnauthorized) {
    return { code: JSON_RPC_ERRORS.unauthorized, message: e.message }
  }
  if (e instanceof McpRateLimitExceeded) {
    return { code: JSON_RPC_ERRORS.rateLimited, message: e.message }
  }
  if (e instanceof McpOversizedPayload || e instanceof InvalidRequestParams) {
    return { code: JSON_RPC_ERRORS.invalidParams, message: e.message }
  }
  // Anything else is internal: report the kind, never the stack.
  return {
    code: JSON_RPC_ERRORS.internal,
    message: e instanceof Error ? e.message : String(e),
  }
}

/**
 * Serve the six knowledge capabilities over `transport` until it closes.
 *
 * The caller owns the transport, so the daemon works over stdio, over a
 * loopback pair in a test, or over anything else that frames JSON-RPC.
 */
export function serveMcp(input: ServeInput): ServeHandle {
  const composed = composeMcpServer({ workspaceRoot: input.workspaceRoot })
  const token = composed.issue({
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    ...(input.methods !== undefined ? { methods: input.methods } : {}),
  })
  // The session token is returned to the caller so the parent process can
  // hand it to a client. It is deliberately not kept as a call context here:
  // holding one was what let an anonymous request borrow it.
  const { server } = composed

  const dispatch = async (method: string, params: unknown): Promise<unknown> => {
    // Authentication comes from the envelope and from nowhere else. This
    // used to fall back to the daemon's own token when a request carried
    // none, so an anonymous JSON-RPC call was served with the server's
    // privileged credential and returned protected vault content.
    const envelope = EnvelopeSchema.safeParse(params)
    if (!envelope.success) {
      throw new McpUnauthorized("request must carry a non-empty token")
    }
    const callCtx: McpCallContext = { tokenId: envelope.data.token }

    // Authorise before validating the payload. A caller with no right to this
    // method must not learn its schema from the error it gets back, nor spend
    // the server's validation work probing it.
    if (
      composed.tokens.authorize(
        envelope.data.token,
        composed.config.workspace,
        method as McpKnowledgeCapability,
      ) === null
    ) {
      throw new McpUnauthorized(`token is not authorised for ${method}`)
    }

    // Validate the business payload against its official schema before any
    // work: TypeScript does not check JSON arriving at runtime.
    const schema = REQUEST_SCHEMAS[method as McpKnowledgeCapability]
    const parsed = schema.safeParse(envelope.data.request)
    if (!parsed.success) {
      throw new InvalidRequestParams(
        // The issue path is safe to return; the received value is not, and
        // may hold vault content or a local path.
        `invalid params: ${parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`,
      )
    }
    const req = parsed.data as never

    switch (method) {
      case "knowledge_search":
        return server.search(req, callCtx)
      case "knowledge_get":
        return server.get(req, callCtx)
      case "knowledge_backlinks":
        return server.backlinks(req, callCtx)
      case "knowledge_trace":
        return server.trace(req, callCtx)
      case "knowledge_status":
        return server.status(callCtx)
      case "knowledge_propose":
        return server.propose(req, callCtx)
      default:
        return undefined
    }
  }

  const done = (async () => {
    for await (const message of input.transport.receive()) {
      if (!isRequest(message)) continue

      if (!MCP_KNOWLEDGE_METHODS.includes(message.method as McpKnowledgeCapability)) {
        await send(input.transport, {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: JSON_RPC_ERRORS.methodNotFound,
            message: `unknown method: ${message.method}`,
          },
        })
        continue
      }

      try {
        const result = await dispatch(message.method, message.params)
        // The request is the audit boundary, and the trail is written
        // BEFORE the answer leaves. The control log batches its writes, so
        // a daemon running for days would otherwise hold the current batch
        // in memory and a crash would take the session's whole trail with
        // it. Flushing here bounds the loss to one request — and flushing
        // before `send` is what makes the refusal below meaningful: content
        // released after a failed write is content that left untraced,
        // which is the exact outcome ADR-KNOW-0006 §6 exists to prevent.
        composed.controlLog?.flush()
        await send(input.transport, { jsonrpc: "2.0", id: message.id, result })
      } catch (e) {
        await send(input.transport, {
          jsonrpc: "2.0",
          id: message.id,
          error: toErrorBody(e),
        })
      }
    }
  })()

  return { tokenId: token.id, composed, done }
}

/** A failed send must not take the daemon down with it. */
async function send(transport: MessageTransport, message: JsonRpcMessage): Promise<void> {
  try {
    await transport.send(message)
  } catch {
    // The peer is gone; the receive loop will end on its own.
  }
}
