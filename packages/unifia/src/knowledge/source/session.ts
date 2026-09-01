/* SPDX-License-Identifier: MIT */
/**
 * Session knowledge source.
 *
 * Per plan gelé §16, session state is ephemeral. It survives
 * compaction but dies with the session unless explicitly
 * promoted to a personal note.
 *
 * The runtime implementation is owned by `NativeKnowledgePort`
 * (Rust). The TS file only defines the contract.
 */

import type {
  KnowledgeSpace,
  KnowledgeSpaceKind,
  KnowledgeLocator,
  KnowledgeId,
} from "@unifia/contracts/knowledge"
import type {
  KnowledgeSource,
  ListOptions,
  ListedNote,
  SourceEvent,
  ScanCoverage,
} from "./source.js"
import type { ParsedDocument } from "../parser/parser.js"

export interface SessionSourceConfig {
  sessionId: string
  label?: string
}

export class SessionSource implements KnowledgeSource {
  readonly space: KnowledgeSpace
  private readonly impl: KnowledgeSource

  constructor(config: SessionSourceConfig, impl: KnowledgeSource) {
    this.space = {
      kind: "session" satisfies KnowledgeSpaceKind,
      id: config.sessionId,
      label: config.label ?? `Session ${config.sessionId}`,
    }
    this.impl = impl
  }

  list(options: ListOptions): Promise<ListedNote[]> {
    return this.impl.list(options)
  }
  /**
   * Coverage of the wrapped source's last scan.
   *
   * A decorator that drops this makes a truncated scan look complete to
   * everything upstream, which is how the flag came to exist with no reader.
   */
  get lastScan(): ScanCoverage | undefined {
    return this.impl.lastScan
  }

  read(locator?: KnowledgeLocator, id?: KnowledgeId): Promise<ParsedDocument | null> {
    return this.impl.read(locator, id)
  }
  watch(onChange: (event: SourceEvent) => void): () => void {
    return this.impl.watch(onChange)
  }
}
