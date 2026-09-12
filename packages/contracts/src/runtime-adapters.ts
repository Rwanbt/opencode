/* SPDX-License-Identifier: MIT */
import type { RuntimeAdapter, RuntimeEvent, RuntimeInfo, SendPromptInput, Session, WorkspaceScope } from "./runtime.ts"

type SessionState = { session: Session; events: RuntimeEvent[]; history: RuntimeEvent[]; nextSequence: number; waiters: Array<(result: IteratorResult<RuntimeEvent>) => void>; cancelled: boolean }

/**
 * A backend MAY optionally support a native push hook for new sessions
 * (E13/RFC-0001). When it does, the boundary adapter forwards the
 * callback; when it does not, the adapter returns a no-op unsubscribe
 * and the workbench server falls back to its bounded polling loop.
 *
 * WHY optional: requiring every backend to implement push is a
 * breaking change to the runtime-impl contract that E13i is not
 * chartered to land. The OpenCode bus subscription is a follow-up
 * tracked in RFC-0001 question ouverte #1; until it lands, the
 * polling fallback is the path OpenCode takes.
 */
export interface PushCapableBackend {
  onSessionCreated?(workspaceId: string, callback: (session: Session) => void): () => void
}

/** Deterministic adapter used to prove the runtime port without external I/O. */
export class FakeRuntimeAdapter implements RuntimeAdapter {
  private readonly sessions = new Map<string, SessionState>()
  private readonly createListeners = new Map<string, Set<(session: Session) => void>>()
  private nextSession = 1
  public readonly hasPushHook = true
  public constructor(private readonly now: () => number = () => Date.now()) {}
  public async getInfo(): Promise<RuntimeInfo> { return { id: "fake", version: "p3-contract-test", capabilities: [], healthy: true } }
  public async listSessions(scope: WorkspaceScope): Promise<Session[]> {
    return [...this.sessions.values()].filter((state) => state.session.workspaceId === scope.workspaceId).map((state) => ({ ...state.session }))
  }
  public async createSession(input: { workspaceId: string }): Promise<Session> {
    const session: Session = { id: `fake-session-${this.nextSession++}`, workspaceId: input.workspaceId, runtimeId: "fake", createdAt: this.now(), messageCount: 0 }
    this.sessions.set(session.id, { session, events: [], history: [], nextSequence: 1, waiters: [], cancelled: false })
    // E13: fire the push hook synchronously after the session is registered.
    // A listener that throws must not abort the create — wrap in try/catch
    // and surface via console.warn (a real adapter would log structured).
    const listeners = this.createListeners.get(input.workspaceId)
    if (listeners) for (const listener of [...listeners]) {
      try { listener({ ...session }) } catch (reason) { console.warn("onSessionCreated listener threw", reason) }
    }
    return { ...session }
  }
  public async sendPrompt(input: SendPromptInput): Promise<void> {
    const state = this.sessions.get(input.sessionId)
    if (!state) throw new Error("session-not-found")
    if (state.cancelled) throw new Error("session-cancelled")
    state.session.messageCount += 1
    this.emit(state, { sessionId: state.session.id, type: "text", data: input.prompt, timestamp: this.now() })
  }
  public subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent> {
    const state = this.sessions.get(input.sessionId)
    if (!state) throw new Error("session-not-found")
    const pending = state.history.filter((event) => (event.sequence ?? 0) > (input.afterSequence ?? 0))
    state.events.length = 0
    return { [Symbol.asyncIterator]: () => ({ next: (): Promise<IteratorResult<RuntimeEvent>> => {
      const event = pending.shift() ?? state.events.shift()
      if (event) return Promise.resolve({ done: false, value: event })
      if (state.cancelled) return Promise.resolve({ done: true, value: undefined })
      return new Promise((resolve) => state.waiters.push(resolve))
    } }) }
  }
  public async cancelSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) throw new Error("session-not-found")
    state.cancelled = true
    for (const resolve of state.waiters.splice(0)) resolve({ done: true, value: undefined })
  }
  public onSessionCreated(scope: WorkspaceScope, callback: (session: Session) => void): () => void {
    const set = this.createListeners.get(scope.workspaceId) ?? new Set<(session: Session) => void>()
    this.createListeners.set(scope.workspaceId, set)
    set.add(callback)
    return () => {
      const current = this.createListeners.get(scope.workspaceId)
      if (!current) return
      current.delete(callback)
      if (current.size === 0) this.createListeners.delete(scope.workspaceId)
    }
  }
  private emit(state: SessionState, event: RuntimeEvent): void {
    const sequenced = { ...event, sequence: state.nextSequence++ }
    state.history.push(sequenced)
    const resolve = state.waiters.shift()
    if (resolve) resolve({ done: false, value: sequenced })
    else state.events.push(sequenced)
  }
}
export interface OpenCodeRuntimeBackend extends PushCapableBackend {
  listSessions(workspaceId: string): Promise<Session[]>
  createSession(workspaceId: string): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<void>
  subscribeEvents(sessionId: string, afterSequence?: number): AsyncIterable<RuntimeEvent>
  cancelSession(sessionId: string): Promise<void>
}

/** Boundary adapter for the existing OpenCode runtime; all I/O stays in the injected backend. */
export class OpenCodeRuntimeAdapter implements RuntimeAdapter {
  /**
   * E13i: `true` when the underlying backend implements a native push
   * hook. The workbench server uses this flag to decide between the
   * push path and the bounded polling fallback — calling
   * `onSessionCreated` against a non-push backend returns a no-op
   * unsubscribe (a quiet success), which would otherwise hide the
   * lack of push support behind a "subscribed" return value.
   */
  public readonly hasPushHook: boolean
  public constructor(private readonly backend: OpenCodeRuntimeBackend, private readonly version: string = "unknown") {
    this.hasPushHook = typeof backend.onSessionCreated === "function"
  }
  public async getInfo(): Promise<RuntimeInfo> {
    return { id: "opencode", version: this.version, capabilities: [], healthy: true }
  }
  public listSessions(scope: WorkspaceScope): Promise<Session[]> { return this.backend.listSessions(scope.workspaceId) }
  public createSession(input: { workspaceId: string }): Promise<Session> { return this.backend.createSession(input.workspaceId) }
  public sendPrompt(input: SendPromptInput): Promise<void> { return this.backend.sendPrompt(input) }
  public subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent> { return this.backend.subscribeEvents(input.sessionId, input.afterSequence) }
  public cancelSession(sessionId: string): Promise<void> { return this.backend.cancelSession(sessionId) }
  public onSessionCreated(scope: WorkspaceScope, callback: (session: Session) => void): () => void {
    // WHY a guarded delegate: a backend that pre-dates E13i has no
    // `onSessionCreated` method. Calling it would throw; returning a
    // no-op unsubscribe lets the workbench server's polling fallback
    // take over without crashing the SSE stream.
    const hook = this.backend.onSessionCreated
    if (typeof hook !== "function") return () => undefined
    return hook.call(this.backend, scope.workspaceId, callback)
  }
}
export interface UnifiaRuntimeBackend extends OpenCodeRuntimeBackend {}
export class UnifiaRuntimeAdapter implements RuntimeAdapter {
  public readonly hasPushHook: boolean
  public constructor(private readonly backend: UnifiaRuntimeBackend, private readonly version: string = "unknown") {
    this.hasPushHook = typeof backend.onSessionCreated === "function"
  }
  public async getInfo(): Promise<RuntimeInfo> {
    return { id: "unifia", version: this.version, capabilities: [], healthy: true }
  }
  public listSessions(scope: WorkspaceScope): Promise<Session[]> { return this.backend.listSessions(scope.workspaceId) }
  public createSession(input: { workspaceId: string }): Promise<Session> { return this.backend.createSession(input.workspaceId) }
  public sendPrompt(input: SendPromptInput): Promise<void> { return this.backend.sendPrompt(input) }
  public subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent> { return this.backend.subscribeEvents(input.sessionId, input.afterSequence) }
  public cancelSession(sessionId: string): Promise<void> { return this.backend.cancelSession(sessionId) }
  public onSessionCreated(scope: WorkspaceScope, callback: (session: Session) => void): () => void {
    const hook = this.backend.onSessionCreated
    if (typeof hook !== "function") return () => undefined
    return hook.call(this.backend, scope.workspaceId, callback)
  }
}
