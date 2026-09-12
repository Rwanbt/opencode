/* SPDX-License-Identifier: MIT */

export type WorkbenchLifecyclePhase =
  | "initializing"
  | "opening"
  | "issuing"
  | "handshaking"
  | "ready"
  | "rolling_back"
  | "failed"
  | "cleanup_failed"

export type WorkbenchLifecycleState = {
  phase: WorkbenchLifecyclePhase
  key: string
  error?: unknown
}

export class WorkbenchCleanupError extends Error {
  readonly primary: unknown

  constructor(primary: unknown, cleanup: unknown) {
    super(`workbench cleanup failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`)
    this.name = "WorkbenchCleanupError"
    this.primary = primary
    this.cause = cleanup
  }
}

type AttemptContext = {
  signal: AbortSignal
  setPhase(phase: WorkbenchLifecyclePhase): void
  acquire(cleanup: () => Promise<void>): void
}

type Attempt<T> = {
  promise: Promise<T>
  cleanup: () => Promise<void>
  abort: () => void
  state: WorkbenchLifecycleState
}

export class WorkbenchLifecycle {
  readonly #attempts = new Map<string, Attempt<unknown>>()
  readonly #listeners = new Set<(state: WorkbenchLifecycleState) => void>()

  subscribe(listener: (state: WorkbenchLifecycleState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  state(key: string): WorkbenchLifecycleState | undefined {
    return this.#attempts.get(key)?.state
  }

  connect<T>(key: string, operation: (context: AttemptContext) => Promise<T>, timeoutMs = 10_000): Promise<T> {
    const existing = this.#attempts.get(key)
    if (existing) return existing.promise as Promise<T>

    const controller = new AbortController()
    const cleanups: Array<() => Promise<void>> = []
    let closed = false
    let cleaned = false
    const state: WorkbenchLifecycleState = { phase: "initializing", key }
    const publish = (phase: WorkbenchLifecyclePhase, error?: unknown) => {
      state.phase = phase
      state.error = error
      for (const listener of this.#listeners) listener({ ...state })
    }
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      closed = true
      if (cleanups.length === 0) return
      publish("rolling_back")
      let firstError: unknown
      for (const revoke of cleanups.splice(0).reverse()) {
        try { await revoke() } catch (error) { firstError ??= error }
      }
      if (firstError !== undefined) throw firstError
    }
    const timeout = setTimeout(() => controller.abort(new Error("workbench connection deadline exceeded")), timeoutMs)
    const promise = (async () => {
      try {
        const value = await Promise.race([
          operation({
            signal: controller.signal,
            setPhase: (phase) => publish(phase),
            acquire: (revoke) => {
              if (closed) { void revoke().catch(() => undefined); return }
              cleanups.push(revoke)
            },
          }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
          }),
        ])
        publish("ready")
        return value
      } catch (primary) {
        try {
          await cleanup()
        } catch (cleanupError) {
          publish("cleanup_failed", cleanupError)
          throw new WorkbenchCleanupError(primary, cleanupError)
        }
        publish("failed", primary)
        throw primary
      } finally {
        clearTimeout(timeout)
      }
    })()
    const attempt: Attempt<T> = { promise, cleanup, abort: () => controller.abort(new Error("workbench attempt cancelled")), state }
    this.#attempts.set(key, attempt as Attempt<unknown>)
    void promise.catch(() => undefined)
    return promise
  }

  async retry(key: string): Promise<void> {
    const attempt = this.#attempts.get(key)
    if (!attempt) return
    attempt.abort()
    await attempt.promise.catch(() => undefined)
    await attempt.cleanup()
    this.#attempts.delete(key)
  }

  async shutdown(): Promise<void> {
    for (const [key, attempt] of this.#attempts) {
      attempt.abort()
      await attempt.promise.catch(() => undefined)
      await attempt.cleanup()
      this.#attempts.delete(key)
    }
  }
}
