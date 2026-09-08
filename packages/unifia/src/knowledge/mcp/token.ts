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
  writeSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"
import type { McpKnowledgeCapability } from "@unifia/contracts/knowledge"
import { MCP_KNOWLEDGE_METHODS } from "@unifia/contracts/knowledge"
import { WriteLock, fsyncDirectory, renameDurable, sleepSync } from "../mutation/durability.js"

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

/**
 * Counter making each temporary file name unique within a process.
 *
 * The pid alone is not enough: one process can persist twice while an
 * earlier temporary is still on disk after a failure.
 */
let tmpCounter = 0

/**
 * How long a persist waits for another process to finish before refusing.
 *
 * `WriteLock` refuses a contended lock immediately, which is right for the
 * vault writer: a mutation is a user-visible operation and queueing behind
 * another one silently is worse than saying the vault is busy. A token
 * store is the opposite case — the critical section is one small file
 * write, contention is ordinary, and refusing would turn it into a failed
 * issuance. So the wait lives here, in the caller that wants it, and stays
 * bounded so a genuinely wedged holder still surfaces.
 */
const STORE_LOCK_WAIT_MS = 5_000
const STORE_LOCK_POLL_MS = 10

/** True for the "someone else holds the lock" refusal, and nothing else. */
function isLockContention(e: unknown): boolean {
  return e instanceof Error && /locked by another writer/.test(e.message)
}

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

  /**
   * Load the store, under the same lock a write takes.
   *
   * Reading without it is what makes a concurrent publish fail on Windows:
   * `MoveFileEx` refuses while any handle is open on the destination, so an
   * unsynchronised reader turns another process's completed write into an
   * `EPERM`. Serialising the read costs one short critical section and
   * removes the collision entirely.
   */
  private hydrateFromDisk(): void {
    const file = this.path as string
    const dir = dirname(file)
    if (!existsSync(dir)) {
      this.applyEntries(decodeStoreFile(file))
      return
    }
    const lock = new WriteLock(join(dir, `${basename(file)}.lock`))
    this.applyEntries(withBoundedWait(lock, () => decodeStoreFile(file)))
  }

  /**
   * Load `entries` into memory.
   *
   * A tombstoned id keeps its token record when one is present, marked
   * revoked: `get()` answers with historical metadata after a restart
   * rather than pretending the token never existed. `resolve()` refuses it
   * either way.
   */
  private applyEntries(entries: Record<string, PersistedEntry>): void {
    for (const [id, entry] of Object.entries(entries)) {
      if ("tombstone" in entry) {
        this.tombstones.set(id, entry.tombstone.at)
        const existing = this.tokens.get(id)
        if (existing !== undefined) {
          existing.revokedAt = new Date(entry.tombstone.at).toISOString()
        }
        continue
      }
      this.tokens.set(id, entry.token)
    }
  }

  /**
   * Write the store back, without losing what another process wrote.
   *
   * The first version rewrote the file from this registry's memory alone,
   * through a temporary whose name was a constant. Three things followed
   * from that. Two processes persisting at once opened the same
   * `store.tmp` with `"w"`, so one truncated the other's half-written file
   * and the rename could publish it. Nothing serialised the
   * read-modify-write, so a daemon that had loaded the file an hour ago
   * erased every token issued since. And the rename was never followed by
   * a directory `fsync`, so a crash could lose a revocation the caller had
   * been told was durable.
   *
   * So: take the same cross-process lock the vault writer uses, re-read
   * the file inside it, merge, write through a temporary unique to this
   * process and call, and flush the directory entry as well as the file.
   *
   * The merge is a union, and revocation wins. A tombstone can never be
   * displaced by a token record: revoking is monotonic, and a concurrent
   * `issue` of an id that another process has just revoked must not
   * reanimate it.
   */
  private persist(): void {
    if (this.path === undefined) return
    const file = this.path
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const lock = new WriteLock(join(dir, `${basename(file)}.lock`))
    withBoundedWait(lock, () => {
      // Whatever another process committed since we loaded is authoritative
      // for the ids we know nothing about.
      const merged = this.mergedEntries(decodeStoreFile(file))

      const json = JSON.stringify({ tokens: merged } satisfies PersistedPayload, null, 2)
      const jsonBuf = Buffer.from(json, "utf8")
      const out = Buffer.alloc(5 + jsonBuf.length)
      out[0] = PERSISTENT_FORMAT_VERSION
      out.writeUInt32LE(jsonBuf.length, 1)
      jsonBuf.copy(out, 5)

      tmpCounter += 1
      const tmp = `${file}.${process.pid}.${tmpCounter}.tmp`
      const fd = openSync(tmp, "wx", PERSISTENT_FILE_MODE)
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
      renameDurable(tmp, file)
      // The bytes were flushed above; this flushes the name that points at
      // them, which is what makes the new store survive a crash.
      fsyncDirectory(dir)

      // The file now holds strictly more than this registry did. Adopt it,
      // so the next persist starts from the union rather than re-deriving
      // a smaller view.
      this.adopt(merged)
    })
  }

  /**
   * Union of what is on disk and what this registry holds, revocation-first.
   */
  private mergedEntries(
    onDisk: Record<string, PersistedEntry>,
  ): Record<string, PersistedEntry> {
    const merged: Record<string, PersistedEntry> = { ...onDisk }

    const tombstone = (id: string, at: number): void => {
      merged[id] = { tombstone: { revoked: true, at } }
    }

    for (const [id, t] of this.tokens.entries()) {
      if (t.revokedAt !== null) {
        tombstone(id, this.tombstones.get(id) ?? Date.parse(t.revokedAt))
        continue
      }
      // Never overwrite a tombstone with a live token.
      const existing = merged[id]
      if (existing !== undefined && "tombstone" in existing) continue
      merged[id] = { token: t }
    }
    for (const [id, at] of this.tombstones.entries()) {
      tombstone(id, at)
    }
    return merged
  }

  /**
   * Adopt the committed view, keeping the revoked records already in memory.
   *
   * Dropping them would make `get()` on a token this process just revoked
   * answer "never existed" instead of "revoked".
   */
  private adopt(entries: Record<string, PersistedEntry>): void {
    const revokedInMemory = new Map<string, McpKnowledgeToken>()
    for (const [id, t] of this.tokens.entries()) {
      if (t.revokedAt !== null) revokedInMemory.set(id, t)
    }
    this.tokens = revokedInMemory
    this.tombstones = new Map()
    this.applyEntries(entries)
  }
}

/**
 * Decode and validate the store at `file`, or `{}` when it is absent.
 *
 * One decoder for both readers. Hydration and the merge inside `persist`
 * must agree on what the file says: if the merge were more forgiving, a
 * record it silently dropped would be erased by the very next write.
 *
 * A file that exists but cannot be understood throws. Treating it as empty
 * would let one write destroy every revocation it failed to parse.
 */
function withBoundedWait<T>(lock: WriteLock, work: () => T): T {
  const deadline = Date.now() + STORE_LOCK_WAIT_MS
  for (;;) {
    try {
      return lock.withLock(work)
    } catch (e) {
      // Only contention is retried. `work` throws `McpTokenError`, never
      // this shape, so a real failure still propagates on the first try.
      if (!isLockContention(e) || Date.now() >= deadline) throw e
      sleepSync(STORE_LOCK_POLL_MS)
    }
  }
}

function decodeStoreFile(file: string): Record<string, PersistedEntry> {
  if (!existsSync(file)) return {}
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
    throw new McpTokenError(`token store at ${file} is not valid JSON: ${(e as Error).message}`)
  }
  if (typeof payload !== "object" || payload === null) {
    throw new McpTokenError(`token store at ${file} is not a JSON object`)
  }
  const tokens = (payload as Record<string, unknown>).tokens
  if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) {
    throw new McpTokenError(`token store at ${file} is missing the "tokens" object`)
  }

  const out: Record<string, PersistedEntry> = {}
  for (const [id, value] of Object.entries(tokens as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      throw new McpTokenError(`token store at ${file} has non-object entry for "${id}"`)
    }
    const v = value as Record<string, unknown>
    if ("tombstone" in v) {
      if (!isTombstone(v.tombstone)) {
        throw new McpTokenError(`token store at ${file} has malformed tombstone for "${id}"`)
      }
      out[id] = { tombstone: v.tombstone }
      continue
    }
    if (!("token" in v)) {
      throw new McpTokenError(`token store at ${file} has unknown entry shape for "${id}"`)
    }
    if (!isToken(v.token)) {
      throw new McpTokenError(`token store at ${file} has invalid token record for "${id}"`)
    }
    if (v.token.id !== id) {
      throw new McpTokenError(
        `token store at ${file} has id mismatch: key "${id}" != token.id "${v.token.id}"`,
      )
    }
    out[id] = { token: v.token }
  }
  return out
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
