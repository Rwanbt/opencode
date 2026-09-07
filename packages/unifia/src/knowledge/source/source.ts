/* SPDX-License-Identifier: MIT */
/**
 * Knowledge source registry.
 *
 * A `KnowledgeSource` is a read interface over a `KnowledgeSpace`.
 * V1 has four source kinds: personal, project, session, external.
 *
 * The source registry lists, reads, and watches notes. Mutations
 * are NOT a source responsibility: they go through
 * `KnowledgeService` and `NativeKnowledgePort`.
 *
 * ADR-KNOW-0004 puts control state (locks, watch tokens) in
 * Class C, not in the source. Sources are stateless and can be
 * re-created.
 */

import type {
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeSpace,
  KnowledgeSpaceKind,
  NoteFrontmatter,
} from "@unifia/contracts/knowledge"
import type { ParsedDocument } from "../parser/parser.js"

export interface ListOptions {
  /** Restrict to a prefix; empty = all. */
  prefix?: KnowledgeLocator
  /** Maximum number of entries to return. */
  limit?: number
  /** Return only notes whose lifecycle is in this set. */
  lifecycles?: ReadonlyArray<NoteFrontmatter["unifia_lifecycle"]>
}

export interface ListedNote {
  ref: {
    id: KnowledgeId
    locator: KnowledgeLocator
  }
  type: NoteFrontmatter["unifia_type"]
  lifecycle: NoteFrontmatter["unifia_lifecycle"]
  updatedAt: string
}

export interface KnowledgeSource {
  readonly space: KnowledgeSpace
  /** List notes available in this space. */
  list(options: ListOptions): Promise<ListedNote[]>
  /** Read a note by locator or by id. */
  read(locator?: KnowledgeLocator, id?: KnowledgeId): Promise<ParsedDocument | null>
  /** Subscribe to changes. Returns an unsubscribe function. */
  watch(
    onChange: (event: SourceEvent) => void,
  ): () => void
}

export type SourceEvent =
  | { kind: "added"; locator: KnowledgeLocator; id: KnowledgeId }
  | { kind: "changed"; locator: KnowledgeLocator; id: KnowledgeId }
  | { kind: "removed"; locator: KnowledgeLocator; id: KnowledgeId }
  | { kind: "moved"; from: KnowledgeLocator; to: KnowledgeLocator; id: KnowledgeId }

/** Registry of all sources currently in scope. */
export class SourceRegistry {
  private readonly sources: KnowledgeSource[] = []
  private readonly unsubscribers: Array<() => void> = []

  register(source: KnowledgeSource): void {
    this.sources.push(source)
  }

  byKind(kind: KnowledgeSpaceKind): KnowledgeSource | undefined {
    return this.sources.find((s) => s.space.kind === kind)
  }

  all(): readonly KnowledgeSource[] {
    return this.sources
  }

  watchAll(onChange: (event: SourceEvent & { space: KnowledgeSpaceKind }) => void): () => void {
    const unsubs: Array<() => void> = []
    for (const s of this.sources) {
      unsubs.push(
        s.watch((event) => {
          onChange({ ...event, space: s.space.kind })
        }),
      )
    }
    const dispose = () => {
      for (const u of unsubs) u()
    }
    this.unsubscribers.push(dispose)
    return dispose
  }

  dispose(): void {
    for (const u of this.unsubscribers) u()
    this.unsubscribers.length = 0
  }
}
