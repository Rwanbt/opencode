/* SPDX-License-Identifier: MIT */

/**
 * MultiWorkspaceRouter and WorkbenchOrchestrator — Plan V3 section 17.
 *
 * Two of the seven "modules prioritaires" of Phase 5, and the one exit
 * criterion of that phase that nothing satisfied: *multi-workspace fonctionne
 * sans relancer inutilement le cœur*.
 *
 * That sentence is the whole design constraint. The naive shape — one runtime
 * per workspace, created on demand — reintroduces exactly what plan section 8.2
 * forbids: several agentic runtimes alive at once, each with its own sessions
 * and its own idea of what is running. So the router owns **one** runtime and
 * routes by scope, and the orchestrator owns workspace lifecycle without ever
 * touching the runtime's.
 */

import type { RuntimeAdapter, RuntimeEvent, SendPromptInput, Session, WorkspaceScope } from "@unifia/contracts"

export type WorkspaceId = string

export type WorkspaceLease = {
  readonly workspaceId: WorkspaceId
  readonly openedAt: number
  readonly lastUsedAt: number
}

export class WorkspaceLimitError extends Error {
  constructor(limit: number) {
    super(`workspace limit reached: ${limit}`)
    this.name = "WorkspaceLimitError"
  }
}

export class UnknownWorkspaceError extends Error {
  constructor(workspaceId: string) {
    super(`workspace is not open: ${workspaceId}`)
    this.name = "UnknownWorkspaceError"
  }
}

/**
 * Routes every workspace to a single shared runtime.
 *
 * WHY it holds one adapter and not a map of them: the runtime is the session
 * authority (plan section 5). Giving each workspace its own would duplicate
 * that authority, and switching workspace would mean starting a core — the cost
 * the exit criterion exists to forbid. Isolation is enforced by scoping every
 * call, not by multiplying runtimes.
 */
export class MultiWorkspaceRouter {
  readonly #runtime: RuntimeAdapter
  readonly #sessionOwners = new Map<string, WorkspaceId>()
  #routedCalls = 0

  constructor(runtime: RuntimeAdapter) {
    this.#runtime = runtime
  }

  /** Number of calls routed. Lets a test assert no runtime was re-created. */
  get routedCalls(): number {
    return this.#routedCalls
  }

  async listSessions(scope: WorkspaceScope): Promise<Session[]> {
    this.#routedCalls += 1
    const sessions = await this.#runtime.listSessions(scope)
    // WHY re-filtered: a backend that ignores the scope would leak another
    // workspace's sessions through the router. The router does not assume its
    // runtime is well behaved.
    const scoped = sessions.filter((session) => session.workspaceId === scope.workspaceId)
    for (const session of scoped) this.#sessionOwners.set(session.id, scope.workspaceId)
    return scoped
  }

  async createSession(workspaceId: WorkspaceId): Promise<Session> {
    this.#routedCalls += 1
    const session = await this.#runtime.createSession({ workspaceId })
    if (session.workspaceId !== workspaceId) throw new Error("runtime returned a session scoped to another workspace")
    this.#sessionOwners.set(session.id, workspaceId)
    return session
  }

  /** @throws when the session does not belong to the calling workspace. */
  async sendPrompt(workspaceId: WorkspaceId, input: SendPromptInput): Promise<void> {
    this.#assertOwnership(workspaceId, input.sessionId)
    this.#routedCalls += 1
    await this.#runtime.sendPrompt(input)
  }

  subscribeEvents(workspaceId: WorkspaceId, sessionId: string, afterSequence?: number): AsyncIterable<RuntimeEvent> {
    this.#assertOwnership(workspaceId, sessionId)
    this.#routedCalls += 1
    return this.#runtime.subscribeEvents({ sessionId, afterSequence })
  }

  async cancelSession(workspaceId: WorkspaceId, sessionId: string): Promise<void> {
    this.#assertOwnership(workspaceId, sessionId)
    this.#routedCalls += 1
    await this.#runtime.cancelSession(sessionId)
  }

  /** Forgets a workspace's session ownership. The runtime is left untouched. */
  forget(workspaceId: WorkspaceId): void {
    for (const [sessionId, owner] of [...this.#sessionOwners]) if (owner === workspaceId) this.#sessionOwners.delete(sessionId)
  }

  #assertOwnership(workspaceId: WorkspaceId, sessionId: string): void {
    const owner = this.#sessionOwners.get(sessionId)
    if (owner !== workspaceId) throw new Error(`session ${sessionId} does not belong to workspace ${workspaceId}`)
  }
}

export type OrchestratorOptions = {
  /** Upper bound on concurrently open workspaces. */
  maxOpenWorkspaces?: number
  /** Close a workspace untouched for this long. 0 disables eviction. */
  idleTimeoutMs?: number
  now?: () => number
}

export type OrchestratorHealth = {
  runtimeId: string
  runtimeHealthy: boolean
  openWorkspaces: number
  routedCalls: number
  leases: readonly WorkspaceLease[]
}

const DEFAULT_MAX_OPEN_WORKSPACES = 16

/**
 * Owns workspace lifecycle on top of a single runtime.
 *
 * The orchestrator never creates or disposes the runtime: it is injected and
 * outlives every workspace. Opening, switching and closing workspaces are
 * bookkeeping operations, which is precisely what makes switching cheap.
 */
export class WorkbenchOrchestrator {
  readonly #router: MultiWorkspaceRouter
  readonly #runtime: RuntimeAdapter
  readonly #leases = new Map<WorkspaceId, { openedAt: number; lastUsedAt: number }>()
  readonly #maxOpen: number
  readonly #idleTimeoutMs: number
  readonly #now: () => number

  constructor(runtime: RuntimeAdapter, options: OrchestratorOptions = {}) {
    this.#runtime = runtime
    this.#router = new MultiWorkspaceRouter(runtime)
    this.#maxOpen = options.maxOpenWorkspaces ?? DEFAULT_MAX_OPEN_WORKSPACES
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 0
    this.#now = options.now ?? Date.now
  }

  get router(): MultiWorkspaceRouter {
    return this.#router
  }

  get openWorkspaces(): readonly WorkspaceId[] {
    return [...this.#leases.keys()]
  }

  /** Idempotent: re-opening an open workspace refreshes its lease. */
  open(workspaceId: WorkspaceId): WorkspaceLease {
    this.evictIdle()
    const existing = this.#leases.get(workspaceId)
    if (existing) {
      existing.lastUsedAt = this.#now()
      return { workspaceId, ...existing }
    }
    if (this.#leases.size >= this.#maxOpen) throw new WorkspaceLimitError(this.#maxOpen)
    const lease = { openedAt: this.#now(), lastUsedAt: this.#now() }
    this.#leases.set(workspaceId, lease)
    return { workspaceId, ...lease }
  }

  /** Marks a workspace as the active one. This is bookkeeping, not a restart. */
  use(workspaceId: WorkspaceId): void {
    const lease = this.#leases.get(workspaceId)
    if (!lease) throw new UnknownWorkspaceError(workspaceId)
    lease.lastUsedAt = this.#now()
  }

  close(workspaceId: WorkspaceId): boolean {
    if (!this.#leases.delete(workspaceId)) return false
    this.#router.forget(workspaceId)
    return true
  }

  /** Closes workspaces untouched beyond the idle timeout. Returns those closed. */
  evictIdle(): readonly WorkspaceId[] {
    if (this.#idleTimeoutMs <= 0) return []
    const deadline = this.#now() - this.#idleTimeoutMs
    const evicted: WorkspaceId[] = []
    for (const [workspaceId, lease] of [...this.#leases]) {
      if (lease.lastUsedAt <= deadline) {
        this.close(workspaceId)
        evicted.push(workspaceId)
      }
    }
    return evicted
  }

  async health(): Promise<OrchestratorHealth> {
    const info = await this.#runtime.getInfo()
    return {
      runtimeId: info.id,
      runtimeHealthy: info.healthy,
      openWorkspaces: this.#leases.size,
      routedCalls: this.#router.routedCalls,
      leases: [...this.#leases].map(([workspaceId, lease]) => ({ workspaceId, ...lease })),
    }
  }

  /** Releases every workspace. The injected runtime is deliberately untouched. */
  shutdown(): readonly WorkspaceId[] {
    const closed = [...this.#leases.keys()]
    for (const workspaceId of closed) this.close(workspaceId)
    return closed
  }
}
