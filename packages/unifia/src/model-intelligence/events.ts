/**
 * Bus events typés pour model-intelligence.
 * (cf. plan §17 — events consommables par UI TUI existante)
 *
 * Pour cette version provisoire : implémentation minimale type-safe avec
 * subscribe/unsubscribe et dispatch synchrone. Pas de persistance.
 */

export type ModelIntelligenceEvent =
  | { type: "model-intelligence.sync.started"; sourceID: string; atUTC: string }
  | { type: "model-intelligence.sync.completed"; sourceID: string; durationMs: number; atUTC: string }
  | { type: "model-intelligence.sync.failed"; sourceID: string; error: string; atUTC: string }
  | { type: "model-intelligence.model.added"; providerID: string; modelID: string; atUTC: string }
  | {
      type: "model-intelligence.model.deprecated"
      providerID: string
      modelID: string
      replacedBy: { providerID: string; modelID: string } | null
      atUTC: string
    }
  | {
      type: "model-intelligence.source.license.changed"
      sourceID: string
      oldLicense: string | null
      newLicense: string | null
      atUTC: string
    }

type Listener = (event: ModelIntelligenceEvent) => void | Promise<void>

export class EventBus {
  private listeners: Listener[] = []

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  async publish(event: ModelIntelligenceEvent): Promise<void> {
    await Promise.all(this.listeners.map((l) => l(event)))
  }

  listenerCount(): number {
    return this.listeners.length
  }
}

export const defaultBus = new EventBus()