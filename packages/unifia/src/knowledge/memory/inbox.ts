/* SPDX-License-Identifier: MIT */
/**
 * Inbox (P4.3).
 *
 * Per ADR-KNOW-0009 §"Inbox", the Inbox is limited to:
 * - contradictions,
 * - low-confidence extractions,
 * - merge decisions,
 * - supersession proposals.
 *
 * It is NOT a daily chore. The Inbox accumulates; the user
 * processes it in batch.
 */

import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

export type InboxReason =
  | "contradiction"
  | "low_confidence"
  | "merge_proposal"
  | "supersession_proposal"

export interface InboxItem {
  id: KnowledgeId
  locator: KnowledgeLocator
  reason: InboxReason
  detectedAt: string
  /** Confidence score, 0..1. Low confidence = < 0.7. */
  confidence: number
}

export class Inbox {
  private readonly items: InboxItem[] = []

  push(item: InboxItem): void {
    this.items.push(item)
  }

  all(): readonly InboxItem[] {
    return this.items
  }

  byReason(reason: InboxReason): InboxItem[] {
    return this.items.filter((i) => i.reason === reason)
  }

  lowConfidence(threshold = 0.7): InboxItem[] {
    return this.items.filter((i) => i.confidence < threshold)
  }

  remove(id: KnowledgeId): void {
    const i = this.items.findIndex((it) => it.id === id)
    if (i >= 0) this.items.splice(i, 1)
  }

  clear(): void {
    this.items.length = 0
  }

  count(): number {
    return this.items.length
  }
}
