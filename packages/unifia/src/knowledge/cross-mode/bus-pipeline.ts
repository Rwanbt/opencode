/* SPDX-License-Identifier: MIT */
/**
 * Cross-mode pipeline with DomainBus (P7.4).
 *
 * Per runbook §16 P6.2 + §17 P7.2: every cross-mode action
 * emits a domain event. V1 wraps the in-memory `CrossModePipeline`
 * with a bus-aware facade that:
 *  - emits `decision.created` after a successful Design create;
 *  - emits `tool.executed` after a successful Code read;
 *  - emits `session.ended` after a successful Work surface;
 *  - never emits an event for a refused or failed action.
 *
 * The bus is provided by the caller; the wrapper does not own
 * one. This keeps the in-process test surface clean and lets the
 * caller wire multiple pipelines to the same bus.
 */

import { CrossModePipeline, type Mode } from "./e2e.js"
import type { DomainBus, DomainEvent } from "../events/bus.js"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

let nextEventId = 1
function makeEventId(): string {
  const n = nextEventId.toString(36)
  nextEventId += 1
  return `evt-${Date.now().toString(36)}-${n}`
}

export interface CrossModeBusOptions {
  bus: DomainBus
  pipeline?: CrossModePipeline
}

export class CrossModeBusPipeline {
  readonly pipeline: CrossModePipeline
  private readonly bus: DomainBus

  constructor(opts: CrossModeBusOptions) {
    this.bus = opts.bus
    this.pipeline = opts.pipeline ?? new CrossModePipeline()
  }

  designCreates(input: {
    id: KnowledgeId
    locator: KnowledgeLocator
    versionHash: string
    title: string
    body: string
    timestamp: string
  }): void {
    const ev = this.pipeline.designCreates(input)
    this.emit({
      kind: "decision.created",
      payload: {
        id: input.id,
        locator: input.locator,
        mode: ev.mode,
        versionHash: input.versionHash,
      },
    })
  }

  codeReads(id: KnowledgeId, timestamp: string): void {
    const r = this.pipeline.codeReads(id, timestamp)
    this.emit({
      kind: "tool.executed",
      payload: {
        id,
        mode: r.event.mode,
        kind_: "read",
      },
    })
  }

  workSurfaces(id: KnowledgeId, timestamp: string): void {
    const r = this.pipeline.workSurfaces(id, timestamp)
    this.emit({
      kind: "session.ended",
      payload: {
        id,
        mode: r.event.mode,
        ref: r.ref.id,
      },
    })
  }

  /** Expose the bus for the caller to add subscribers. */
  busRef(): DomainBus {
    return this.bus
  }

  private emit(input: { kind: DomainEvent["kind"]; payload: Record<string, string> }): void {
    const e: DomainEvent = {
      id: makeEventId(),
      kind: input.kind,
      timestamp: new Date().toISOString(),
      payload: input.payload,
    }
    this.bus.emit(e)
  }
}

export type { Mode }
