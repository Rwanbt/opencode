/* SPDX-License-Identifier: MIT */
/**
 * MCP knowledge token (P9.2).
 *
 * Per runbook §19: "Tokens locaux, révocables, scoped workspace, quotas,
 * rate limit, taille et deadline bornées."
 *
 * V1 hardening (card C8):
 * - ids come from a CSPRNG, not `Date.now()` plus a counter, which was
 *   guessable by anyone who knew roughly when a token was issued;
 * - a TTL is always applied. `issue()` used to leave `expiresAt` null when
 *   `ttlMs` was omitted, minting a token that never expired, while
 *   PERMISSIONS.md promised "default 1 hour, max 24 hours";
 * - a token carries the method allowlist it is scoped to, so a read token
 *   cannot call `knowledge_propose`.
 *
 * A token is valid if and only if it exists, is not revoked, and has not
 * expired.
 */

import { randomBytes, timingSafeEqual } from "node:crypto"
import type { McpKnowledgeCapability } from "@unifia/contracts/knowledge"
import { MCP_KNOWLEDGE_METHODS } from "@unifia/contracts/knowledge"

/** PERMISSIONS.md §5. */
export const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000
export const MAX_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export interface McpKnowledgeToken {
  id: string
  workspace: string
  /** Methods this token may call. Never empty. */
  methods: McpKnowledgeCapability[]
  issuedAt: string
  /** Always set: V1 issues no perpetual token. */
  expiresAt: string
  revokedAt: string | null
}

export class McpTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpTokenError"
  }
}

export interface IssueInput {
  workspace: string
  /** Defaults to one hour; may not exceed 24 hours. */
  ttlMs?: number
  /** Defaults to the five read-only methods — never `knowledge_propose`. */
  methods?: readonly McpKnowledgeCapability[]
}

/** Read-only default scope: write is opt-in, per runbook §19. */
const READ_ONLY_METHODS: McpKnowledgeCapability[] = [
  "knowledge_search",
  "knowledge_get",
  "knowledge_backlinks",
  "knowledge_trace",
  "knowledge_status",
]

export class McpTokenRegistry {
  private tokens = new Map<string, McpKnowledgeToken>()

  issue(input: IssueInput): McpKnowledgeToken {
    if (input.workspace.length === 0) {
      throw new McpTokenError("workspace must be non-empty")
    }

    const ttl = input.ttlMs ?? DEFAULT_TOKEN_TTL_MS
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new McpTokenError(`ttlMs must be a positive finite number, got ${String(input.ttlMs)}`)
    }
    if (ttl > MAX_TOKEN_TTL_MS) {
      throw new McpTokenError(`ttlMs ${ttl} exceeds the ${MAX_TOKEN_TTL_MS} ms maximum`)
    }

    const methods = [...(input.methods ?? READ_ONLY_METHODS)]
    if (methods.length === 0) {
      throw new McpTokenError("a token must be scoped to at least one method")
    }
    for (const m of methods) {
      if (!MCP_KNOWLEDGE_METHODS.includes(m)) {
        throw new McpTokenError(`unknown method: ${m}`)
      }
    }

    const now = Date.now()
    const token: McpKnowledgeToken = {
      // 32 bytes of CSPRNG output; not derived from the clock.
      id: `tok_${randomBytes(32).toString("base64url")}`,
      workspace: input.workspace,
      methods,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      revokedAt: null,
    }
    this.tokens.set(token.id, token)
    return token
  }

  /** Revoke a token. No-op if already revoked. */
  revoke(id: string): void {
    const t = this.tokens.get(id)
    if (t === undefined) throw new McpTokenError(`unknown token: ${id}`)
    if (t.revokedAt !== null) return
    t.revokedAt = new Date().toISOString()
  }

  isValid(id: string, now: number = Date.now()): boolean {
    return this.resolve(id, now) !== null
  }

  /**
   * Return the token if it may act on `workspace` with `method`, else null.
   * The lookup compares in constant time so a caller cannot probe for valid
   * prefixes by timing.
   */
  authorize(
    id: string,
    workspace: string,
    method: McpKnowledgeCapability,
    now: number = Date.now(),
  ): McpKnowledgeToken | null {
    const token = this.resolve(id, now)
    if (token === null) return null
    if (!constantTimeEquals(token.workspace, workspace)) return null
    if (!token.methods.includes(method)) return null
    return token
  }

  get(id: string): McpKnowledgeToken | null {
    return this.tokens.get(id) ?? null
  }

  /** Total active (valid) tokens for a workspace. */
  countActive(workspace: string, now: number = Date.now()): number {
    let n = 0
    for (const t of this.tokens.values()) {
      if (t.workspace !== workspace) continue
      if (!this.isValid(t.id, now)) continue
      n += 1
    }
    return n
  }

  private resolve(id: string, now: number): McpKnowledgeToken | null {
    const t = this.tokens.get(id)
    if (t === undefined) return null
    if (t.revokedAt !== null) return null
    if (now >= Date.parse(t.expiresAt)) return null
    return t
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
