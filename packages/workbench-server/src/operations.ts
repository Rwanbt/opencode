/* SPDX-License-Identifier: MIT */

export type OperationState = "pending" | "running" | "completed" | "cancelled" | "failed"

export type WorkbenchOperation = {
  readonly id: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly createdAt: number
  state: OperationState
  finishedAt?: number
  error?: string
}

export type OperationRegistryOptions = {
  retentionMs?: number
  maxEntries?: number
}

export class OperationRegistry {
  readonly #operations = new Map<string, WorkbenchOperation>()
  readonly #byIdempotency = new Map<string, string>()
  readonly #nextId: () => string
  readonly #now: () => number
  readonly #retentionMs: number
  readonly #maxEntries: number

  constructor(nextId: () => string, now: () => number = Date.now, options: OperationRegistryOptions = {}) {
    this.#nextId = nextId
    this.#now = now
    this.#retentionMs = options.retentionMs ?? 5 * 60_000
    this.#maxEntries = options.maxEntries ?? 1_000
  }

  start(workspaceId: string, sessionId: string, idempotencyKey?: string): WorkbenchOperation {
    this.#prune()
    if (idempotencyKey) {
      const existing = this.#byIdempotency.get(idempotencyKey)
      if (existing) return this.#operations.get(existing) as WorkbenchOperation
    }
    if (this.#operations.size >= this.#maxEntries) throw new Error("operation registry capacity reached")
    const operation: WorkbenchOperation = { id: this.#nextId(), workspaceId, sessionId, createdAt: this.#now(), state: "running" }
    this.#operations.set(operation.id, operation)
    if (idempotencyKey) this.#byIdempotency.set(idempotencyKey, operation.id)
    this.#prune()
    return operation
  }

  complete(id: string): WorkbenchOperation | undefined {
    const operation = this.#operations.get(id)
    if (!operation || operation.state === "cancelled") return operation
    operation.state = "completed"
    operation.finishedAt = this.#now()
    this.#prune()
    return operation
  }

  fail(id: string, error: unknown): WorkbenchOperation | undefined {
    const operation = this.#operations.get(id)
    if (!operation || operation.state === "cancelled") return operation
    operation.state = "failed"
    operation.error = error instanceof Error ? error.message : "operation failed"
    operation.finishedAt = this.#now()
    this.#prune()
    return operation
  }

  cancel(id: string): WorkbenchOperation | undefined {
    const operation = this.#operations.get(id)
    if (!operation || operation.state === "completed" || operation.state === "failed") return undefined
    operation.state = "cancelled"
    operation.finishedAt = this.#now()
    this.#prune()
    return operation
  }

  get(id: string): WorkbenchOperation | undefined { return this.#operations.get(id) }

  #prune(): void {
    const now = this.#now()
    const terminal = [...this.#operations.values()]
      .filter((operation) => operation.finishedAt !== undefined)
      .sort((left, right) => (left.finishedAt ?? 0) - (right.finishedAt ?? 0))
    const expired = terminal.filter((operation) => now - (operation.finishedAt ?? now) >= this.#retentionMs)
    const remove = new Set([...expired, ...terminal.slice(0, Math.max(0, this.#operations.size - this.#maxEntries + 1))])
    for (const operation of remove) {
      this.#operations.delete(operation.id)
      for (const [key, operationId] of this.#byIdempotency) if (operationId === operation.id) this.#byIdempotency.delete(key)
    }
  }
}
