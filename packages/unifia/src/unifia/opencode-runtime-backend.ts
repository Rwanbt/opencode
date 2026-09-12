import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { WorkspaceID } from "@/control-plane/schema"
import { SessionEventHubRegistry, type OpenCodeRuntimeBackend } from "@unifia/contracts"
import type { RuntimeEvent, SendPromptInput, Session as UnifiaSession } from "@unifia/contracts"

type BusEvent = { type?: string; properties?: Record<string, unknown> }

function toSession(info: Session.Info): UnifiaSession {
  return {
    id: info.id,
    workspaceId: info.workspaceID ?? info.projectID,
    runtimeId: "opencode",
    createdAt: info.time.created,
    messageCount: 0,
  }
}

function toRuntimeEvent(event: BusEvent, sessionId: string): Omit<RuntimeEvent, "sequence"> {
  const eventType = event.type ?? "opencode.event"
  const type: RuntimeEvent["type"] = eventType.includes("error")
    ? "error"
    : eventType.includes("permission")
      ? "permission"
      : eventType.includes("message") || eventType.includes("part")
        ? "text"
        : "tool-result"
  return { sessionId, type, data: { source: eventType, properties: event.properties ?? {} }, timestamp: Date.now() }
}

/** Concrete OpenCode backend. Policy and audit remain outside this compatibility boundary. */
export class OpenCodeSessionBackend implements OpenCodeRuntimeBackend {
  /**
   * WHY a hub per session: this backend used to create a fresh Bus subscription
   * per call, emit events with no `sequence`, and ignore `afterSequence`
   * entirely. The server therefore never wrote an SSE `id:` line, so a client
   * had nothing to resume from, and a client that reconnected anyway received
   * only what happened next — silently losing everything that arrived while it
   * was away. "Les événements sont rejouables" is a Phase 2 exit criterion and
   * this was the one place it was not met.
   */
  readonly #hubs = new SessionEventHubRegistry()
  readonly #busSubscriptions = new Map<string, () => void>()

  public async listSessions(workspaceId: string): Promise<UnifiaSession[]> {
    const sessions: UnifiaSession[] = []
    for (const info of Session.list({ workspaceID: WorkspaceID.make(workspaceId) })) sessions.push(toSession(info))
    return sessions
  }

  public async createSession(workspaceId: string): Promise<UnifiaSession> {
    return toSession(await Session.create({ workspaceID: WorkspaceID.make(workspaceId) }))
  }

  public async sendPrompt(input: SendPromptInput): Promise<void> {
    await SessionPrompt.prompt({ sessionID: SessionID.make(input.sessionId), parts: [{ type: "text", text: input.prompt }] })
  }

  public subscribeEvents(sessionId: string, afterSequence?: number): AsyncIterable<RuntimeEvent> {
    this.#ensureBusSubscription(sessionId)
    return this.#hubs.for(sessionId).subscribe(afterSequence ?? 0)
  }

  /**
   * Attaches to the bus once per session.
   *
   * The subscription outlives any individual reader: a reader that disconnects
   * must not stop the hub from recording what happens while it is away, or the
   * replay it reconnects for would be empty by construction.
   */
  #ensureBusSubscription(sessionId: string): void {
    if (this.#busSubscriptions.has(sessionId)) return
    const hub = this.#hubs.for(sessionId)
    const unsubscribe = Bus.subscribeAll((event: BusEvent) => {
      if ((event.properties ?? {}).sessionID !== sessionId) return
      hub.publish(toRuntimeEvent(event, sessionId))
    })
    this.#busSubscriptions.set(sessionId, unsubscribe)
  }

  public async cancelSession(sessionId: string): Promise<void> {
    await SessionPrompt.cancel(SessionID.make(sessionId))
    this.#release(sessionId)
  }

  /** Releases every session. Call when the backend itself is torn down. */
  public close(): void {
    for (const sessionId of [...this.#busSubscriptions.keys()]) this.#release(sessionId)
  }

  #release(sessionId: string): void {
    this.#busSubscriptions.get(sessionId)?.()
    this.#busSubscriptions.delete(sessionId)
    this.#hubs.close(sessionId)
  }
}
