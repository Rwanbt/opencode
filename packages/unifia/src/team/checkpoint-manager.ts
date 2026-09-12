import { createHash, randomUUID } from "node:crypto"

export const CHECKPOINT_SCHEMA_VERSION = "1.0.0"
const DEFAULT_MAX_BYTES = 256 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export interface CheckpointWorktree {
  readonly path: string
  readonly branch: string
  readonly headSha: string
  readonly dirty: boolean
}

export interface CheckpointLock {
  readonly leaseId: string
  readonly workerId: string
  readonly fencingToken: number
  readonly status: string
}

export interface CheckpointBudget {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costCents: number
}

export interface CheckpointHealth {
  readonly testStatus: string
  readonly typecheckStatus: string
  readonly debtStatus: string
}

export interface CheckpointSnapshot {
  readonly checkpointId?: string
  readonly runId: string
  readonly branch: string
  readonly baseSha: string
  readonly teamHead: string
  readonly dirtyPaths: readonly string[]
  readonly worktrees: readonly CheckpointWorktree[]
  readonly locks: readonly CheckpointLock[]
  readonly databaseSha256: string
  readonly budget: CheckpointBudget
  readonly health: CheckpointHealth
}

export interface CheckpointPayload extends Omit<CheckpointSnapshot, "checkpointId"> {
  readonly checkpointId: string
  readonly createdAt: string
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION
}

export interface CheckpointDocument {
  readonly payload: CheckpointPayload
  readonly digest: string
}

export interface CheckpointStorage {
  read(path: string): string
  writeAtomic(path: string, contents: string): void
}

export interface CheckpointManagerOptions {
  readonly now?: () => string
  readonly id?: () => string
  readonly maxBytes?: number
}

export interface CheckpointRestoreExpectation {
  readonly branch?: string
  readonly baseSha?: string
  readonly teamHead?: string
}

export class CheckpointCorruptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckpointCorruptError"
  }
}

export class CheckpointIncompatibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckpointIncompatibleError"
  }
}

export class CheckpointStaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckpointStaleError"
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} must not be empty`)
}

function assertSha256(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new TypeError(`${field} must be a lowercase SHA-256 digest`)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableValue(child)]))
  }
  return value
}

function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(stableValue(value))
  if (encoded === undefined) throw new TypeError("checkpoint value must be JSON serializable")
  return encoded
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function validateSnapshot(snapshot: CheckpointSnapshot): void {
  for (const [field, value] of Object.entries({ runId: snapshot.runId, branch: snapshot.branch, baseSha: snapshot.baseSha, teamHead: snapshot.teamHead, databaseSha256: snapshot.databaseSha256 })) {
    if (typeof value !== "string") throw new TypeError(`${field} must be a string`)
    assertNonEmpty(value, field)
  }
  assertSha256(snapshot.databaseSha256, "databaseSha256")
  if (!Number.isInteger(snapshot.budget.inputTokens) || snapshot.budget.inputTokens < 0) throw new TypeError("budget.inputTokens must be non-negative")
  if (!Number.isInteger(snapshot.budget.outputTokens) || snapshot.budget.outputTokens < 0) throw new TypeError("budget.outputTokens must be non-negative")
  if (!Number.isInteger(snapshot.budget.costCents) || snapshot.budget.costCents < 0) throw new TypeError("budget.costCents must be non-negative")
  for (const path of snapshot.dirtyPaths) assertNonEmpty(path, "dirty path")
  for (const worktree of snapshot.worktrees) {
    assertNonEmpty(worktree.path, "worktree.path")
    assertNonEmpty(worktree.branch, "worktree.branch")
    assertNonEmpty(worktree.headSha, "worktree.headSha")
  }
  for (const lock of snapshot.locks) {
    assertNonEmpty(lock.leaseId, "lock.leaseId")
    assertNonEmpty(lock.workerId, "lock.workerId")
    if (!Number.isInteger(lock.fencingToken) || lock.fencingToken < 0) throw new TypeError("lock.fencingToken must be non-negative")
    assertNonEmpty(lock.status, "lock.status")
  }
  assertNonEmpty(snapshot.health.testStatus, "health.testStatus")
  assertNonEmpty(snapshot.health.typecheckStatus, "health.typecheckStatus")
  assertNonEmpty(snapshot.health.debtStatus, "health.debtStatus")
}

function validatePayload(payload: CheckpointPayload): void {
  assertNonEmpty(payload.checkpointId, "checkpointId")
  if (payload.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) throw new CheckpointIncompatibleError(`unsupported checkpoint schema ${payload.schemaVersion}`)
  if (!Date.parse(payload.createdAt)) throw new CheckpointCorruptError("checkpoint createdAt is invalid")
  validateSnapshot(payload)
}

export class CheckpointManager {
  readonly #now: () => string
  readonly #id: () => string
  readonly #maxBytes: number

  constructor(options: CheckpointManagerOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#id = options.id ?? (() => `checkpoint-${randomUUID()}`)
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    if (!Number.isInteger(this.#maxBytes) || this.#maxBytes <= 0) throw new RangeError("maxBytes must be positive")
  }

  create(snapshot: CheckpointSnapshot): CheckpointDocument {
    validateSnapshot(snapshot)
    const payload: CheckpointPayload = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      checkpointId: snapshot.checkpointId ?? this.#id(),
      createdAt: this.#now(),
      runId: snapshot.runId,
      branch: snapshot.branch,
      baseSha: snapshot.baseSha,
      teamHead: snapshot.teamHead,
      dirtyPaths: sortedStrings(snapshot.dirtyPaths),
      worktrees: [...snapshot.worktrees].sort((left, right) => left.path.localeCompare(right.path)),
      locks: [...snapshot.locks].sort((left, right) => left.leaseId.localeCompare(right.leaseId)),
      databaseSha256: snapshot.databaseSha256,
      budget: snapshot.budget,
      health: snapshot.health,
    }
    validatePayload(payload)
    return { payload, digest: digest(payload) }
  }

  serialize(document: CheckpointDocument): string {
    try {
      validatePayload(document.payload)
    } catch (error) {
      if (error instanceof CheckpointIncompatibleError || error instanceof CheckpointCorruptError) throw error
      throw new CheckpointCorruptError(`checkpoint payload is invalid: ${error instanceof Error ? error.message : "unknown error"}`)
    }
    if (digest(document.payload) !== document.digest) throw new CheckpointCorruptError("checkpoint digest does not match payload")
    const serialized = canonicalJson(document)
    if (new TextEncoder().encode(serialized).byteLength > this.#maxBytes) throw new RangeError(`checkpoint exceeds the ${this.#maxBytes}-byte limit`)
    return serialized
  }

  save(path: string, snapshot: CheckpointSnapshot, storage: CheckpointStorage): CheckpointDocument {
    assertNonEmpty(path, "path")
    const document = this.create(snapshot)
    storage.writeAtomic(path, this.serialize(document))
    return document
  }

  restore(path: string, storage: CheckpointStorage, expected: CheckpointRestoreExpectation = {}): CheckpointDocument {
    assertNonEmpty(path, "path")
    let parsed: unknown
    try {
      parsed = JSON.parse(storage.read(path))
    } catch (error) {
      throw new CheckpointCorruptError(`checkpoint JSON is invalid: ${error instanceof Error ? error.message : "unknown error"}`)
    }
    if (parsed === null || typeof parsed !== "object" || !("payload" in parsed) || !("digest" in parsed)) throw new CheckpointCorruptError("checkpoint envelope is invalid")
    const document = parsed as CheckpointDocument
    if (typeof document.digest !== "string" || !SHA256_PATTERN.test(document.digest)) throw new CheckpointCorruptError("checkpoint digest is invalid")
    if (document.payload === null || typeof document.payload !== "object") throw new CheckpointCorruptError("checkpoint payload is invalid")
    try {
      validatePayload(document.payload)
    } catch (error) {
      if (error instanceof CheckpointIncompatibleError || error instanceof CheckpointCorruptError) throw error
      throw new CheckpointCorruptError(`checkpoint payload is invalid: ${error instanceof Error ? error.message : "unknown error"}`)
    }
    if (digest(document.payload) !== document.digest) throw new CheckpointCorruptError("checkpoint digest does not match payload")
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (expectedValue !== undefined && document.payload[field as keyof CheckpointPayload] !== expectedValue) throw new CheckpointStaleError(`checkpoint ${field} does not match current state`)
    }
    return document
  }
}
