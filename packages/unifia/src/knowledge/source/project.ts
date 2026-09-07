/* SPDX-License-Identifier: MIT */
/**
 * Project knowledge source.
 *
 * The project space is the repository itself. It is read-write
 * for project documents (AGENTS.md, AI_CONTEXT.md, docs/adr/,
 * KNOWN_FAILURE_PATTERNS.md, etc.).
 *
 * ADR-KNOW-0002: project space root = `./` (the repository root).
 */

import type {
  KnowledgeSpace,
  KnowledgeSpaceKind,
  KnowledgeLocator,
  KnowledgeId,
} from "@unifia/contracts/knowledge"
import {
  PROJECT_ROOT_LOCATOR,
} from "@unifia/contracts/knowledge"
import type {
  KnowledgeSource,
  ListOptions,
  ListedNote,
  SourceEvent,
} from "./source.js"
import type { ParsedDocument } from "../parser/parser.js"

export interface ProjectSourceConfig {
  projectRef: string
  rootLocator?: KnowledgeLocator
  label?: string
}

export class ProjectSource implements KnowledgeSource {
  readonly space: KnowledgeSpace
  private readonly impl: KnowledgeSource

  constructor(config: ProjectSourceConfig, impl: KnowledgeSource) {
    this.space = {
      kind: "project" satisfies KnowledgeSpaceKind,
      id: config.projectRef,
      label: config.label ?? config.projectRef,
      rootLocator: config.rootLocator ?? PROJECT_ROOT_LOCATOR,
    }
    this.impl = impl
  }

  list(options: ListOptions): Promise<ListedNote[]> {
    return this.impl.list(options)
  }
  read(locator?: KnowledgeLocator, id?: KnowledgeId): Promise<ParsedDocument | null> {
    return this.impl.read(locator, id)
  }
  watch(onChange: (event: SourceEvent) => void): () => void {
    return this.impl.watch(onChange)
  }
}
