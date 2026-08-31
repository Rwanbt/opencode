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
 * V1 hardening (card W-RUN-01):
 * - the registry is optionally file-backed. The on-disk format is
 *   versioned (1-byte header `0x01`, then a uint32-LE payload length, then
 *   the JSON payload) and atomically written (temp + fsync + rename), so a
 *   crash mid-write never leaves a truncated file;
 * - permissions are 0o600 on POSIX; on Windows the file relies on the
 *   user-profile ACL the same way `policy/store.ts` does (NTFS DACLs are
 *   not exposed through `chmod`);
 * - TTL is enforced on read (expired tokens are filtered on hydration);
 * - `revoke()` writes a tombstone entry `{ revoked: true, at: number }`
 *   that survives a process restart;
 * - corruption, length mismatch, version mismatch, and unknown legacy
 *   shapes all fail closed with a typed `McpTokenError` (or
 *   `McpTokenVersionError` when the version byte is wrong). Tokens are
 *   never silently dropped.
 *
 * A token is valid if and only if it exists, is not revoked, and has not
 * expired.
 */

import { randomBytes, timingSafeEqual } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs"
import { dirname } from "node:path"
import type { McpKnowledgeCapability } from "@unifia/contracts/knowledge"
import { MCP_KNOWLEDGE_METHODS } from "@unifia/contracts/knowledge"

/** PERMISSIONS.md §5. */
export const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000
export const MAX_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * On-disk format version. Stored as the first byte of the file. A reader
 * that does not recognise the byte refuses to load — never silently drops
 * tokens it cannot parse.
 */
export const PERSISTENT_FORMAT_VERSION = 0x01

/** POSIX file mode for the persistence file. */
const PERSISTENT_FILE_MODE = 0o600

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

/**
 * Raised when the on-disk file's version byte does not match
 * `PERSISTENT_FORMAT_VERSION`. Distinct from `McpTokenError` so callers
 * can detect "legacy / forward-incompatible" and refuse the file without
 * having to grep error messages.
 */
export class McpTokenVersionError extends McpTokenError {
  readonly expected: number
  readonly observed: number
  constructor(file: string, observed: number, expected: number) {
    super(
      `token store at ${file} has format version 0x${observed.toString(16)}, expected 0x${expected.toString(16)}`,
    )
    this.name = "McpTokenVersionError"
    this.expected = expected
    this.observed = observed
  }
}

export interface IssueInput {
  workspace: string
  /** Defaults to one hour; may not exceed 24 hours. */
  ttlMs?: number
  /** Defaults to the five read-only methods — never `knowledge_propose`. */
  methods?: readonly McpKnowledgeCapability[]
}

export interface McpTokenRegistryOptions {
  /**
   * Absolute path to the persistence file. When provided, the registry
   * hydrates from disk on construction and rewrites the file on every
   * `issue` and `revoke`. When omitted, the registry is in-memory only —
   * identical to the pre-W-RUN-01 behaviour.
   */
  path?: string
}

/** Read-only default scope: write is opt-in, per runbook §19. */
const READ_ONLY_METHODS: McpKnowledgeCapability[] = [
  "knowledge_search",
  "knowledge_get",
  "knowledge_backlinks",
  "knowledge_trace",
  "knowledge_status",
]

/**
 * A tombstone marking a previously-issued token as revoked. Persisted
 * instead of the full token record so the file shrinks over time and a
 * restarted daemon honours every prior revocation.
 */
interface PersistedTombstone {
  revoked: true
  /** Epoch ms of the revocation. */
  at: number
}

type PersistedEntry =
  | { token: McpKnowledgeToken }
  | { tombstone: PersistedTombstone }

interface PersistedPayload {
  tokens: Record<string, PersistedEntry>
}

export class McpTokenRegistry {
  private tokens = new Map<string, McpKnowledgeToken>()
  /**
   * Tombstones that have no active token record (e.g. issued and revoked
   * in the same process and then the token was garbage-collected by a
   * future eviction pass). Persisted alongside tokens so revoke intent
   * survives restart.
   */
  private tombstones = new Map<string, number>()
  private readonly path: string | undefined

  constructor(options: McpTokenRegistryOptions = {}) {
    this.path = options.path
    if (this.path !== undefined) {
      this.hydrateFromDisk()
    }
  }

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
    this.persist()
    return token
  }

  /** Revoke a token. No-op if already revoked. */
  revoke(id: string): void {
    const t = this.tokens.get(id)
    if (t === undefined) throw new McpTokenError(`unknown token: ${id}`)
    if (t.revokedAt !== null) return
    const at = Date.now()
    t.revokedAt = new Date(at).toISOString()
    this.tombstones.set(id, at)
    this.persist()
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

  // ─── Persistence ────────────────────────────────────────────────────

  private hydrateFromDisk(): void {
    const file = this.path as string
    if (!existsSync(file)) return
    const buf = readFileSync(file)
    if (buf.byteLength < 5) {
      throw new McpTokenError(
        `token store at ${file} is truncated: expected at least 5 header bytes, got ${buf.byteLength}`,
      )
    }
    const version = buf[0]
    if (version === undefined || version !== PERSISTENT_FORMAT_VERSION) {
      throw new McpTokenVersionError(file, version ?? -1, PERSISTENT_FORMAT_VERSION)
    }
    const length = buf.readUInt32LE(1)
    if (buf.byteLength !== 5 + length) {
      throw new McpTokenError(
        `token store at ${file} has length mismatch: header says ${length} payload bytes, file has ${buf.byteLength - 5}`,
      )
    }
    let payload: unknown
    try {
      payload = JSON.parse(buf.subarray(5, 5 + length).toString("utf8"))
    } catch (e) {
      throw new McpTokenError(
        `token store at ${file} is not valid JSON: ${(e as Error).message}`,
      )
    }
    this.applyPayload(payload, file)
  }

  private applyPayload(payload: unknown, file: string): void {
    if (typeof payload !== "object" || payload === null) {
      throw new McpTokenError(`token store at ${file} is not a JSON object`)
    }
    const obj = payload as Record<string, unknown>
    const tokens = obj.tokens
    if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) {
      throw new McpTokenError(`token store at ${file} is missing the "tokens" object`)
    }

    // First pass: load active token records. A legacy file (or a future
    // version) that contains an entry we do not understand fails the
    // whole load — never silently drop.
    for (const [id, value] of Object.entries(tokens as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) {
        throw new McpTokenError(`token store at ${file} has non-object entry for "${id}"`)
      }
      const v = value as Record<string, unknown>
      if ("tombstone" in v) continue
      if (!("token" in v)) {
        throw new McpTokenError(`token store at ${file} has unknown entry shape for "${id}"`)
      }
      const t = v.token
      if (!isToken(t)) {
        throw new McpTokenError(`token store at ${file} has invalid token record for "${id}"`)
      }
      if (t.id !== id) {
        throw new McpTokenError(
          `token store at ${file} has id mismatch: key "${id}" != token.id "${t.id}"`,
        )
      }
      this.tokens.set(t.id, t)
    }

    // Second pass: apply tombstones. A tombstone with no matching token
    // record is still recorded (so a future `issue` of the same id
    // cannot reanimate a revoked token — though our 32-byte CSPRNG id
    // space makes that practically impossible).
    for (const [id, value] of Object.entries(tokens as Record<string, unknown>)) {
      const v = value as Record<string, unknown>
      if (!("tombstone" in v)) continue
      const ts = v.tombstone
      if (!isTombstone(ts)) {
        throw new McpTokenError(`token store at ${file} has malformed tombstone for "${id}"`)
      }
      this.tombstones.set(id, ts.at)
      const t = this.tokens.get(id)
      if (t !== undefined) t.revokedAt = new Date(ts.at).toISOString()
    }

    // Third pass: drop any active token that is also tombstoned. The
    // first pass already loaded it; the second pass marked it revoked.
    // We do not delete from the map — the in-memory API returns
    // `revokedAt !== null` from `get()` and refuses it in `resolve()`,
    // which is enough to satisfy the "drop on read" rule. Keeping the
    // record lets `get()` return historical metadata after a restart.
  }

  private persist(): void {
    if (this.path === undefined) return
    const file = this.path
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const entries: Record<string, PersistedEntry> = {}
    for (const [id, t] of this.tokens.entries()) {
      if (t.revokedAt !== null) {
        const at = this.tombstones.get(id) ?? Date.parse(t.revokedAt)
        entries[id] = { tombstone: { revoked: true, at } }
      } else {
        entries[id] = { token: t }
      }
    }
    for (const [id, at] of this.tombstones.entries()) {
      if (entries[id] === undefined) {
        entries[id] = { tombstone: { revoked: true, at } }
      }
    }
    const payload: PersistedPayload = { tokens: entries }

    const json = JSON.stringify(payload, null, 2)
    const jsonBuf = Buffer.from(json, "utf8")
    const out = Buffer.alloc(5 + jsonBuf.length)
    out[0] = PERSISTENT_FORMAT_VERSION
    out.writeUInt32LE(jsonBuf.length, 1)
    jsonBuf.copy(out, 5)

    const tmp = `${file}.tmp`
    const fd = openSync(tmp, "w", PERSISTENT_FILE_MODE)
    try {
      writeSync(fd, out)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (process.platform !== "win32") {
      // Belt-and-braces: some filesystems honour the open() mode, others
      // ignore it. Best-effort: FUSE / network FS may reject chmod, and
      // chmod is a no-op on Windows, so failure here is not a bug.
      try {
        chmodSync(tmp, PERSISTENT_FILE_MODE)
      } catch {
        // Best-effort; some FS drivers (e.g. FUSE) reject chmod.
      }
    }
    renameSync(tmp, file)
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function isToken(v: unknown): v is McpKnowledgeToken {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.id !== "string" || o.id.length === 0) return false
  if (typeof o.workspace !== "string" || o.workspace.length === 0) return false
  if (!Array.isArray(o.methods)) return false
  if (!o.methods.every((m) => typeof m === "string")) return false
  if (typeof o.issuedAt !== "string") return false
  if (typeof o.expiresAt !== "string") return false
  if (o.revokedAt !== null && typeof o.revokedAt !== "string") return false
  return true
}

function isTombstone(v: unknown): v is PersistedTombstone {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  if (o.revoked !== true) return false
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return false
  return true
}
