/* SPDX-License-Identifier: MIT */
/**
 * RuntimeAdapter — abstraction sur le runtime agentique
 * (OpenCode legacy ou Unifia)
 *
 * ADR-0001
 * Source : Plan V3 §7.1
 */
export type RuntimeId = "opencode" | "unifia" | "fake"

export interface RuntimeInfo {
  id: RuntimeId
  version: string
  capabilities: string[]
  healthy: boolean
}

export interface Session {
  id: string
  workspaceId: string
  runtimeId: RuntimeId
  createdAt: number
  messageCount: number
}

export interface SendPromptInput {
  sessionId: string
  prompt: string
  capabilities?: string[]
}

export interface RuntimeEvent {
  sessionId: string
  type: "text" | "tool-call" | "tool-result" | "permission" | "error"
  data: unknown
  timestamp: number
  sequence?: number
}

export interface RuntimeAdapter {
  getInfo(): Promise<RuntimeInfo>
  listSessions(scope: WorkspaceScope): Promise<Session[]>
  createSession(input: { workspaceId: string }): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<void>
  subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent>
  cancelSession(sessionId: string): Promise<void>
  /**
   * Push hook for new-session discovery (E13/RFC-0001).
   *
   * WHY: the workbench stream merges every session's events into one SSE
   * per workspace, but `RuntimeAdapter` is session-scoped. Before E13i
   * the workbench server polled `listSessions` every 5 s to discover new
   * sessions, which is wasteful when nothing changes and silently fails
   * when the runtime errors. `onSessionCreated` lets the runtime push
   * the event in O(1) latency instead of 5 s polling.
   *
   * The returned function unsubscribes the callback. Callers MUST
   * invoke it when the stream is cancelled, otherwise the runtime
   * leaks listeners (one per open SSE).
   */
  onSessionCreated(scope: WorkspaceScope, callback: (session: Session) => void): () => void
  /**
   * E13i capability flag. `true` when the adapter is wired to a
   * backend that natively pushes new-session events. The workbench
   * server reads this to choose between the push path and the
   * bounded polling fallback. A no-op unsubscribe is NOT a
   * substitute: a backend that pre-dates E13i returns a no-op for
   * every `onSessionCreated` call, so the server would never know.
   */
  readonly hasPushHook: boolean
}

export interface WorkspaceScope {
  workspaceId: string
  includeArchived?: boolean
}