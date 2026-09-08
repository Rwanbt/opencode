/* SPDX-License-Identifier: MIT */
/**
 * TS adapter for the Rust WAL (P2.3).
 *
 * The Rust side owns the file-backed WAL. The TS side defines the
 * shape of an entry, validates pre-conditions, and exposes a
 * pure `planReplay` that mirrors the Rust implementation.
 */

import type { KnowledgeVersionHash } from "@unifia/contracts/knowledge"

export type WalKind =
  | "create"
  | "update"
  | "delete"
  | "move"
  | "promote"
  | "supersede"
  | "archive"
  | "restore"

export interface WalEntry {
  seq: number
  kind: WalKind
  locator: string
  /**
   * The path the note used to live at, for `move` and `restore` entries only.
   *
   * `move` renames a note: the destination is `locator`, the source is
   * `previousLocator`. `restore` returns a trashed note to its original
   * vault location: the destination is `locator`, the trash path is the
   * `previousLocator`. Other kinds omit the field.
   *
   * `previousLocator` is what makes a crash between the commit and the
   * unlink-of-source recoverable: a re-opened writer looks at every WAL
   * entry that has one, sees whether the destination already has the
   * recorded hash, and if it does, removes the source. Without it, a
   * crash mid-`move` or mid-`restore` would leave two silent copies.
   */
  previousLocator?: string
  previousHash: KnowledgeVersionHash | null
  newHash: KnowledgeVersionHash | null
  auditId: string
  source: string
  reason: string
  timestamp: string
}

export class WalValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WalValidationError"
  }
}

export function validateEntry(input: {
  kind: WalKind
  locator: string
  previousHash: WalEntry["previousHash"]
  newHash: WalEntry["newHash"]
  source: string
  reason: string
}): void {
  if (input.locator.length === 0) {
    throw new WalValidationError("locator must be non-empty")
  }
  if (input.source.length === 0) {
    throw new WalValidationError("source must be non-empty")
  }
  if (input.reason.length === 0) {
    throw new WalValidationError("reason must be non-empty")
  }
  if (input.kind === "create" && input.previousHash !== null) {
    throw new WalValidationError("create must have no previous hash")
  }
  // Only a physical delete leaves no new content. Archive rewrites the note's
  // lifecycle and keeps the file (ADR-KNOW-0009 §4), so it carries a new hash
  // like any other update; grouping the two here made archive impossible to
  // record, and therefore impossible to perform at all.
  if (input.kind === "delete" && input.newHash !== null) {
    throw new WalValidationError("delete must have no new hash")
  }
  if (input.kind === "archive" && input.newHash === null) {
    throw new WalValidationError("archive must have a new hash: it rewrites the note")
  }
}

export interface ReplayPlan {
  toApply: WalEntry[]
  toSkip: WalEntry[]
}

export function planReplay(entries: readonly WalEntry[]): ReplayPlan {
  const seen = new Set<string>()
  const toApply: WalEntry[] = []
  const toSkip: WalEntry[] = []
  for (const e of entries) {
    if (seen.has(e.auditId)) {
      toSkip.push(e)
    } else {
      seen.add(e.auditId)
      toApply.push(e)
    }
  }
  return { toApply, toSkip }
}
