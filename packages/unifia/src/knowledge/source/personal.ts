/* SPDX-License-Identifier: MIT */
/**
 * Personal knowledge source.
 *
 * Default root: `UnifiaVault/` (per ADR-KNOW-0002). The personal
 * space is the user's own vault: full read/write access.
 *
 * The runtime implementation is owned by `NativeKnowledgePort`
 * (Rust). This TS file only defines the *contract* a personal
 * source must satisfy and provides a registry adapter for tests.
 */

import type {
  KnowledgeSpace,
  KnowledgeSpaceKind,
  KnowledgeLocator,
  KnowledgeId,
} from "@unifia/contracts/knowledge"
import { PERSONAL_ROOT_LOCATOR } from "@unifia/contracts/knowledge"
import type {
  KnowledgeSource,
  ListOptions,
  ListedNote,
  SourceEvent,
  ScanCoverage,
} from "./source.js"
import type { ParsedDocument } from "../parser/parser.js"

export interface PersonalSourceConfig {
  /** Personal vault root locator. Defaults to `UnifiaVault/`. */
  rootLocator?: KnowledgeLocator
  /** Identifier of the personal space. */
  spaceId: string
  /** Human-readable label. */
  label?: string
}

export class PersonalSource implements KnowledgeSource {
  readonly space: KnowledgeSpace
  private readonly impl: KnowledgeSource

  constructor(config: PersonalSourceConfig, impl: KnowledgeSource) {
    this.space = {
      kind: "personal" satisfies KnowledgeSpaceKind,
      id: config.spaceId,
      label: config.label ?? "Personal",
      rootLocator: config.rootLocator ?? PERSONAL_ROOT_LOCATOR,
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
