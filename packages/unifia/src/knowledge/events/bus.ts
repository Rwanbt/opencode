/* SPDX-License-Identifier: MIT */
/**
 * Domain events bus (P6.2).
 *
 * Per runbook §16 P6.2: emit `session.started`, `session.ended`,
 * `file.changed`, `git.commit`, `project.opened`,
 * `decision.created`, `tool.executed`. We avoid provider-
 * specific hooks.
 *
 * V1: a tiny in-process pub/sub. The native side (P2.1) emits
 * the corresponding KnowledgeEvent; the bus dispatches to
 * subscribers synchronously.
 */

export type DomainEventKind =
  | "session.started"
  | "session.ended"
  | "file.changed"
  | "file.moved"
  | "file.deleted"
  | "git.commit"
  | "project.opened"
  | "decision.created"
  | "tool.executed"
  | "egress.decision"
  | "mutation.applied"

export interface DomainEvent {
  id: string
  kind: DomainEventKind
  timestamp: string
  payload: Record<string, string | number | boolean>
}

export type Subscriber = (e: DomainEvent) => void

export class DomainBus {
  private subs: Map<DomainEventKind, Subscriber[]> = new Map()
  private wildcard: Subscriber[] = []

  on(kind: DomainEventKind, s: Subscriber): () => void {
    const list = this.subs.get(kind) ?? []
    list.push(s)
    this.subs.set(kind, list)
    return () => this.off(kind, s)
  }

  onAny(s: Subscriber): () => void {
    this.wildcard.push(s)
    return () => {
      const i = this.wildcard.indexOf(s)
      if (i >= 0) this.wildcard.splice(i, 1)
    }
  }

  off(kind: DomainEventKind, s: Subscriber): void {
    const list = this.subs.get(kind)
    if (list === undefined) return
    const i = list.indexOf(s)
    if (i >= 0) list.splice(i, 1)
  }

  emit(e: DomainEvent): void {
    const list = this.subs.get(e.kind) ?? []
    for (const s of list) s(e)
    for (const s of this.wildcard) s(e)
  }

  clear(): void {
    this.subs.clear()
    this.wildcard.length = 0
  }
}
