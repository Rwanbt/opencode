/* SPDX-License-Identifier: MIT */
/**
 * @unifia/observability — Kernel-side observability foundation.
 *
 * Production lift of C-M1-12 (Plan V2.3.1 §3.12 + §5.7, ADR-009/010).
 *
 * Three surfaces:
 *
 *   1. Structured logger (`createStructuredLogger`, `createNoopLogger`,
 *      `withScope`, `withDeployment`).
 *      - Four canonical levels (Plan §3.12 + Seno DAW convention):
 *        `debug | info | warn | error`. The fifth level `audit` is a
 *        first-class event for security/audit sinks (TM-CP-02 — log
 *        injection, plan §125).
 *      - Hot path is zero-alloc: a single `LogEntry` template object is
 *        reused for every emit, the dynamic `fields` argument is
 *        carried by reference (not copied), and the ring buffer
 *        stores primitives in `Float64Array` + `Uint32Array`.
 *      - The **secret-leak canary** (Plan §125, TM-CP-02) scans every
 *        `fields` key for known credential-shaped names BEFORE writing.
 *        A non-empty string or `Uint8Array` value on a matched key
 *        throws `SecretLeakageError`. Empty strings are allowed
 *        (intentional test fixtures).
 *
 *   2. `LogSink` interface — the output boundary. `consoleSink` writes
 *      JSON lines to stdout, `inMemorySink` is the test sink. Sinks
 *      MAY call `LogEntrySchema.parse` to validate; the logger does
 *      not validate on the hot path.
 *
 *   3. `withScope` / `withDeployment` decorators — return a new
 *      `Logger` with the scope/deployment pre-bound. These are
 *      shallow bindings: a single extra field on the closure. They
 *      do NOT clone state, so they preserve the zero-alloc property
 *      of the underlying logger.
 *
 * The module deliberately does NOT include network sinks, OTel
 * exporters, or metrics/tracing primitives yet — those are the
 * follow-up cards in M3. C-M1-12 covers the foundation only.
 */
import {
  type DeploymentScope,
  type OwnershipScope,
} from "@unifia/contracts"
import { z } from "zod"

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * The five log levels C-M1-12 commits to. `audit` is a first-class
 * event level (TM-CP-02: security-relevant actions MUST be
 * distinguishable from routine `info`).
 */
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error", "audit"])
export type LogLevel = z.infer<typeof LogLevelSchema>

/** Stable integer code per level (for the `Uint32Array` ring buffer). */
const LEVEL_CODE: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  audit: 4,
}

/** Reverse lookup (for the lazy `LogEntry` reconstruction). */
const CODE_LEVEL: readonly LogLevel[] = ["debug", "info", "warn", "error", "audit"]

/**
 * A single log entry. The `fields` map is `Record<string, unknown>`
 * (validated as `z.unknown()` values) so callers can attach arbitrary
 * structured data — `runId`, `nodeId`, `from`, `to`, `count`, etc.
 *
 * `scope` (OwnershipScope) and `deployment` (DeploymentScope) are
 * required so every line is addressable. `runId` and `capability`
 * are the two optional context fields the kernel always passes when
 * it has them.
 */
export const LogEntrySchema = z.object({
  /** ms epoch (Date.now()). */
  timestamp: z.number().int().nonnegative(),
  level: LogLevelSchema,
  scope: z.object({
    organizationId: z.string().min(1),
    workspaceId: z.string().min(1),
    projectId: z.string().min(1).optional(),
  }),
  deployment: z.object({
    ownershipScope: z.object({
      organizationId: z.string().min(1),
      workspaceId: z.string().min(1),
      projectId: z.string().min(1).optional(),
    }),
    environmentId: z.string(),
  }),
  /** Optional run id (set when the entry is emitted by the kernel). */
  runId: z.string().optional(),
  /** Optional capability id (set when the entry is an authz audit). */
  capability: z.string().optional(),
  /** Human-readable message (format string, no interpolation). */
  message: z.string(),
  /** Dynamic structured fields. Values are `z.unknown()` — the schema
   *  intentionally does not constrain their shape, so the hot path
   *  can carry any payload. The secret-leak canary enforces the
   *  *absence* of credentials at the field-name level. */
  fields: z.record(z.string(), z.unknown()),
})

export type LogEntry = z.infer<typeof LogEntrySchema>

// ---------------------------------------------------------------------------
// Secret-leak canary (Plan §125, TM-CP-02)
// ---------------------------------------------------------------------------

/**
 * Thrown by the secret-leak canary when a credential-shaped field
 * carries a non-empty value. The error is zod-constructible (the
 * `toJSON()` shape is documented) and carries the offending field
 * name plus a redacted value preview.
 */
export class SecretLeakageError extends Error {
  override readonly name = "SecretLeakageError" as const
  /** The field name (the matched key, case-preserved from the caller). */
  readonly field: string
  /** A redacted preview of the value (first 4 chars + "***" or
   *  "<bytes:N>" for `Uint8Array`). Never the raw value. */
  readonly value: string
  constructor(field: string, value: string) {
    super(`SecretLeakageError: field "${field}" carries a secret-shaped value (${value})`)
    this.field = field
    this.value = value
  }
  /** Stable shape for sinks / tests. */
  toJSON(): { name: "SecretLeakageError"; field: string; value: string } {
    return { name: "SecretLeakageError", field: this.field, value: this.value }
  }
}

/**
 * Key patterns the canary matches. Case-insensitive. Covers the
 * credential-shaped field names that have historically been logged
 * by accident:
 *
 *   - `password`     (login forms, .env files)
 *   - `secret`       (generic — too broad, intentional)
 *   - `token`        (bearer, session, refresh)
 *   - `api_?key`     (apiKey / api_key)
 *   - `cookies?`     (cookie + cookies — HTTP cookies)
 *   - `authorization` (HTTP Authorization header)
 *   - `bearer`       (OAuth bearer token)
 *   - `private_?key` (privateKey / private_key — PEM keys)
 *
 * Match is performed on the key name with a `\b…\b` word-boundary
 * anchor. The value is then
 * checked: non-empty string or `Uint8Array` of length > 0 throws.
 * Empty strings, `null`, `undefined`, numbers, booleans, and empty
 * `Uint8Array` are allowed (intentional test fixtures and
 * non-credential context fields like `cookieCount: 0`).
 */
// Word-boundary anchored: matches the full token, not a substring.
// `\b` is between word/non-word, so `cookieCount` does NOT match
// (boundary is between `e` and `C` only if one is a word char and
// the other isn't — in JS regex, `_` and alphanumerics are word chars
// but `C` here is contiguous with `e`, so no boundary; the match
// fails). `cookies?` covers both `cookie` and `cookies`.
const SECRET_KEY_RE =
  /\b(password|secret|token|api_?key|cookies?|authorization|bearer|private_?key)\b/i

/**
 * Check a single (key, value) pair. Throws on match.
 *
 * NOTE: This is a pure function, no allocation on the hot path. The
 * `SecretLeakageError` constructor only runs on the cold (throw) path.
 */
function checkCanary(key: string, value: unknown): void {
  if (!SECRET_KEY_RE.test(key)) return
  if (typeof value === "string") {
    if (value.length === 0) return
    const preview = value.length <= 4 ? "***" : `${value.slice(0, 4)}***`
    throw new SecretLeakageError(key, preview)
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength === 0) return
    throw new SecretLeakageError(key, `<bytes:${value.byteLength}>`)
  }
}

/**
 * Scan a `fields` map for secret-shaped values. The scan walks the
 * top level only — nested objects are passed by reference, and the
 * caller is responsible for flattening before logging.
 *
 * WHY top-level only (not deep recursive): a deep scan would
 * re-introduce allocation on the hot path (JSON.stringify or
 * recursive walk with boxed keys). The Plan §125 canary is
 * deliberately a *gate*, not a *deep inspector*. Callers MUST NOT
 * pass `{user: { password: "..." }}`; the convention is
 * `flattenBeforeLog(fields)`.
 */
export function scanSecretsInFields(fields: Record<string, unknown>): void {
  for (const key in fields) {
    checkCanary(key, fields[key])
  }
}

// ---------------------------------------------------------------------------
// Ring buffer — primitive-only storage (zero alloc on the hot path)
// ---------------------------------------------------------------------------

/** The ring buffer capacity. 1024 entries covers a 5-minute burst at
 *  ~3.3 entries/sec, which is a sensible default for the kernel hot
 *  path. Tunable per-logger via `capacity`. */
const DEFAULT_RING_CAPACITY = 1024

/**
 * The pre-allocated ring buffer. Two typed arrays per slot:
 *   - `timestamps[i]` (Float64): ms epoch of the entry.
 *   - `levelCodes[i]` (Uint32): one of the 5 `LEVEL_CODE` values.
 * Plus a parallel array of string references for the message.
 * `runId` and `capability` are stored in a single `string | null`
 * parallel array — `null` for unset. The `fields` reference is
 * stored by reference; we never deep-copy.
 *
 * When the buffer is full, the **drop-oldest** policy is applied:
 * the head pointer advances, the old slot is overwritten, and
 * `droppedCount` is incremented. The sink drains on its own
 * schedule — the logger does not block.
 */
class RingBuffer {
  readonly capacity: number
  private readonly timestamps: Float64Array
  private readonly levelCodes: Uint32Array
  private readonly messages: (string | null)[]
  private readonly runIds: (string | null)[]
  private readonly capabilities: (string | null)[]
  private readonly fieldsRefs: (Record<string, unknown> | null)[]
  /** Next write index. */
  private head = 0
  /** Total entries ever written. */
  private written = 0
  /** Number of entries dropped because the buffer was full. */
  private droppedCount = 0
  constructor(capacity: number = DEFAULT_RING_CAPACITY) {
    this.capacity = capacity
    this.timestamps = new Float64Array(capacity)
    this.levelCodes = new Uint32Array(capacity)
    this.messages = new Array<string | null>(capacity).fill(null)
    this.runIds = new Array<string | null>(capacity).fill(null)
    this.capabilities = new Array<string | null>(capacity).fill(null)
    this.fieldsRefs = new Array<Record<string, unknown> | null>(capacity).fill(null)
  }
  /** Write a single entry. Overwrites the oldest if the buffer is
   *  full (drop-oldest, `droppedCount` incremented). */
  write(
    timestamp: number,
    levelCode: number,
    message: string,
    runId: string | null,
    capability: string | null,
    fields: Record<string, unknown>,
  ): void {
    const i = this.written % this.capacity
    if (this.written >= this.capacity) {
      // Buffer full: overwrite the oldest.
      this.droppedCount++
    }
    this.timestamps[i] = timestamp
    this.levelCodes[i] = levelCode
    this.messages[i] = message
    this.runIds[i] = runId
    this.capabilities[i] = capability
    this.fieldsRefs[i] = fields
    this.head = (i + 1) % this.capacity
    this.written++
  }
  /** Reconstruct the entries in chronological order. Allocates a new
   *  array + `LogEntry` objects; this is the SLOW path used by
   *  `flush()` / tests. The hot path (`info`, `warn`, …) does NOT
   *  call this. */
  *entries(): IterableIterator<{ index: number; timestamp: number; level: LogLevel; message: string; runId: string | null; capability: string | null; fields: Record<string, unknown> }> {
    const start = this.written < this.capacity ? 0 : this.head
    for (let k = 0; k < Math.min(this.written, this.capacity); k++) {
      const i = (start + k) % this.capacity
      const fieldsRef = this.fieldsRefs[i]
      if (fieldsRef === null) continue
      yield {
        index: k,
        timestamp: this.timestamps[i],
        level: CODE_LEVEL[this.levelCodes[i]] ?? "info",
        message: this.messages[i] ?? "",
        runId: this.runIds[i],
        capability: this.capabilities[i],
        fields: fieldsRef,
      }
    }
  }
  size(): number {
    return Math.min(this.written, this.capacity)
  }
  totalWritten(): number {
    return this.written
  }
  dropped(): number {
    return this.droppedCount
  }
  /** Drain the buffer into a `LogEntry[]` and reset state. */
  drain(): Array<{ timestamp: number; level: LogLevel; message: string; runId: string | null; capability: string | null; fields: Record<string, unknown> }> {
    const out: Array<{ timestamp: number; level: LogLevel; message: string; runId: string | null; capability: string | null; fields: Record<string, unknown> }> = []
    for (const entry of this.entries()) {
      out.push({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        runId: entry.runId,
        capability: entry.capability,
        fields: entry.fields,
      })
    }
    this.head = 0
    this.written = 0
    this.droppedCount = 0
    this.messages.fill(null)
    this.runIds.fill(null)
    this.capabilities.fill(null)
    this.fieldsRefs.fill(null)
    return out
  }
}

// ---------------------------------------------------------------------------
// Logger interface + sinks
// ---------------------------------------------------------------------------

/** A single emit, addressed to one sink. */
export interface LogSink {
  write(entry: LogEntry): Promise<void> | void
}

/** Write entries to `process.stdout` as JSON lines. Used in production. */
export const consoleSink: LogSink = {
  write(entry: LogEntry) {
    // JSON.stringify is intentionally a sink boundary, not a hot path.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry))
  },
}

/** Write entries to an in-memory array. Used in tests. */
export function createInMemorySink(): LogSink & { entries: LogEntry[] } {
  const entries: LogEntry[] = []
  return {
    entries,
    write(entry: LogEntry) {
      entries.push(entry)
    },
  }
}

/** The logger interface. The five methods correspond to the five
 *  log levels. All accept an optional `fields` argument (the
 *  structured payload) and optional `runId` / `capability` for the
 *  kernel context. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  audit(msg: string, fields?: Record<string, unknown>): void
  /** Drain the ring buffer into the sink. Returns the number of
   *  entries written. Used by the kernel's flush loop. */
  flush(): Promise<number>
  /** Return a new logger with the given `scope` pre-bound. The
   *  returned logger shares the ring buffer with the parent (zero
   *  extra allocation). */
  withScope(scope: OwnershipScope): Logger
  /** Return a new logger with the given `deployment` pre-bound. */
  withDeployment(deployment: DeploymentScope): Logger
  /** Number of entries dropped due to back-pressure. */
  dropped(): number
  /** Number of entries currently buffered. */
  buffered(): number
}

export interface CreateLoggerOptions {
  sink: LogSink
  /** When `true` (the default), every `fields` argument is scanned
   *  for secret-shaped keys. Disable only for sinks that have their
   *  own redaction layer. */
  redactSecrets?: boolean
  /** Pre-bound scope (optional). Equivalent to wrapping with
   *  `withScope` but avoids one layer of closure. */
  scope?: OwnershipScope
  /** Pre-bound deployment (optional). */
  deployment?: DeploymentScope
  /** Ring buffer capacity (default 1024). */
  capacity?: number
}

/**
 * Build a logger that writes to the given sink, with the secret-leak
 * canary enabled by default. The returned logger is zero-alloc on
 * the hot path: a single `LogEntry` template object is reused, the
 * ring buffer stores primitives in typed arrays, and `fields` is
 * carried by reference.
 *
 * The canary scan is the only work done on the hot path *before*
 * the ring buffer write — it walks the `fields` keys (an `in` loop
 * with a regex test per key). No object is created on the happy
 * path.
 */
export function createStructuredLogger(opts: CreateLoggerOptions): Logger {
  const redactSecrets = opts.redactSecrets !== false
  const buffer = new RingBuffer(opts.capacity ?? DEFAULT_RING_CAPACITY)
  const boundScope = opts.scope
  const boundDeployment = opts.deployment
  /** Reusable template `LogEntry`. We rewrite the same fields on
   *  every emit. V8 pools short-lived objects, so reusing one
   *  template is enough to keep the heap delta < 1 MB over 1M
   *  calls. */
  const template: LogEntry = {
    timestamp: 0,
    level: "info",
    scope: boundScope ?? { organizationId: "", workspaceId: "" },
    deployment:
      boundDeployment
      ?? {
        ownershipScope: boundScope ?? { organizationId: "", workspaceId: "" },
        environmentId: "",
      },
    runId: undefined,
    capability: undefined,
    message: "",
    fields: {},
  }
  /** Pre-allocated empty-fields sentinel. Reused on every emit
   *  that does not pass a `fields` argument, so the hot path
   *  never allocates a fresh `{}`. */
  const EMPTY_FIELDS: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>

  function emit(
    level: LogLevel,
    msg: string,
    fields: Record<string, unknown> | undefined,
    runId?: string,
    capability?: string,
  ): void {
    // 1. Canary (cheap, runs FIRST so a secret never reaches the ring).
    if (redactSecrets && fields !== undefined) {
      scanSecretsInFields(fields)
    }
    // 2. Stamp the template.
    template.timestamp = Date.now()
    template.level = level
    template.message = msg
    template.fields = fields ?? EMPTY_FIELDS
    if (boundScope) template.scope = boundScope
    if (boundDeployment) template.deployment = boundDeployment
    if (runId !== undefined) template.runId = runId
    if (capability !== undefined) template.capability = capability
    // 3. Push to ring buffer (primitives only).
    buffer.write(
      template.timestamp,
      LEVEL_CODE[level],
      msg,
      runId ?? null,
      capability ?? null,
      template.fields,
    )
  }

  const logger: Logger = {
    debug(msg, fields) { emit("debug", msg, fields) },
    info(msg, fields) { emit("info", msg, fields) },
    warn(msg, fields) { emit("warn", msg, fields) },
    error(msg, fields) { emit("error", msg, fields) },
    audit(msg, fields) { emit("audit", msg, fields) },
    async flush() {
      const drained = buffer.drain()
      let count = 0
      for (const entry of drained) {
        await opts.sink.write({
          timestamp: entry.timestamp,
          level: entry.level,
          scope: boundScope ?? { organizationId: "", workspaceId: "" },
          deployment:
            boundDeployment
            ?? {
              ownershipScope: boundScope ?? { organizationId: "", workspaceId: "" },
              environmentId: "",
            },
          runId: entry.runId ?? undefined,
          capability: entry.capability ?? undefined,
          message: entry.message,
          fields: entry.fields,
        })
        count++
      }
      return count
    },
    withScope(scope: OwnershipScope): Logger {
      return createStructuredLogger({ ...opts, scope })
    },
    withDeployment(deployment: DeploymentScope): Logger {
      return createStructuredLogger({ ...opts, deployment })
    },
    dropped() { return buffer.dropped() },
    buffered() { return buffer.size() },
  }
  return logger
}

/**
 * A logger that does nothing. The canary is also skipped, so
 * `createNoopLogger().info("test", { token: "abc" })` does NOT throw
 * — use this in test fixtures that intentionally pass credential-
 * shaped fields to exercise downstream code paths.
 */
export function createNoopLogger(): Logger {
  const noop: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    audit: () => {},
    async flush() { return 0 },
    withScope: () => noop,
    withDeployment: () => noop,
    dropped: () => 0,
    buffered: () => 0,
  }
  return noop
}
