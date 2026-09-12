/* SPDX-License-Identifier: MIT */
/**
 * Cross-mode E2E (P7.2).
 *
 * Per runbook §17 P7.2: a single decision is created in Design,
 * read by Code, surfaced in Work. The same `KnowledgeService`
 * serves all three modes; no per-mode cache.
 *
 * V1: a state machine that records the lifecycle of a single
 * decision through the three modes. No UI; the orchestrator
 * wires the in-memory services.
 */

import type { KnowledgeId, KnowledgeLocator, KnowledgeRef } from "@unifia/contracts/knowledge"
import { classifyText } from "../context/dataflow.js"

export type Mode = "design" | "code" | "work"

export interface DecisionRecord {
  id: KnowledgeId
  locator: KnowledgeLocator
  versionHash: string
  title: string
  body: string
  restrictions: { remoteModel: "allow" | "deny"; localModel: "allow" | "deny" }
}

export interface CrossModeEvent {
  mode: Mode
  kind: "created" | "read" | "surfaced"
  id: KnowledgeId
  timestamp: string
}

export class CrossModePipeline {
  private evts: CrossModeEvent[] = []
  private decisions = new Map<KnowledgeId, DecisionRecord>()

  designCreates(input: {
    id: KnowledgeId
    locator: KnowledgeLocator
    versionHash: string
    title: string
    body: string
    timestamp: string
  }): CrossModeEvent {
    const text = `${input.title}\n${input.body}`
    const c = classifyText(text)
    if (c.classification === "secret") {
      throw new Error(`refusing to create a decision classified as secret: ${c.reason}`)
    }
    const record: DecisionRecord = {
      id: input.id,
      locator: input.locator,
      versionHash: input.versionHash,
      title: input.title,
      body: input.body,
      restrictions: { remoteModel: "deny", localModel: "allow" },
    }
    this.decisions.set(input.id, record)
    const e: CrossModeEvent = { mode: "design", kind: "created", id: input.id, timestamp: input.timestamp }
    this.evts.push(e)
    return e
  }

  codeReads(id: KnowledgeId, timestamp: string): { record: DecisionRecord; event: CrossModeEvent } {
    const record = this.decisions.get(id)
    if (record === undefined) {
      throw new Error(`decision not found: ${id}`)
    }
    const event: CrossModeEvent = { mode: "code", kind: "read", id, timestamp }
    this.evts.push(event)
    return { record, event }
  }

  workSurfaces(id: KnowledgeId, timestamp: string): { ref: KnowledgeRef; event: CrossModeEvent } {
    const record = this.decisions.get(id)
    if (record === undefined) {
      throw new Error(`decision not found: ${id}`)
    }
    const event: CrossModeEvent = { mode: "work", kind: "surfaced", id, timestamp }
    this.evts.push(event)
    return {
      ref: {
        id: record.id,
        locator: record.locator,
        versionHash: record.versionHash,
        hashAlgorithm: "blake3",
      },
      event,
    }
  }

  events(): readonly CrossModeEvent[] {
    return [...this.evts]
  }

  decisionCount(): number {
    return this.decisions.size
  }
}
