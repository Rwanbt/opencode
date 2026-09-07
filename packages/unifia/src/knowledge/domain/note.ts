/* SPDX-License-Identifier: MIT */
/**
 * Domain types for the `packages/unifia` knowledge subsystem.
 *
 * These wrap the cross-package types from
 * `@unifia/contracts/knowledge` and add runtime conveniences
 * (resolvers, builders). They never widen the contracts.
 */

import type {
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeVersionHash,
  KnowledgeRef,
  KnowledgeSpace,
  KnowledgeSpaceKind,
  NoteFrontmatter,
  PortableRestrictions,
} from "@unifia/contracts/knowledge"
import type { ParsedDocument } from "../parser/parser.js"

export interface KnowledgeNote {
  ref: KnowledgeRef
  space: KnowledgeSpaceKind
  frontmatter: NoteFrontmatter
  document: ParsedDocument
}

export interface MutationPrecondition {
  expectedVersionHash: KnowledgeVersionHash
}

export interface WriteResult {
  ref: KnowledgeRef
  auditId: string
}

export function buildRef(input: {
  id: KnowledgeId
  locator: KnowledgeLocator
  versionHash: KnowledgeVersionHash
  hashAlgorithm: "blake3" | "sha256"
}): KnowledgeRef {
  return {
    id: input.id,
    locator: input.locator,
    versionHash: input.versionHash,
    hashAlgorithm: input.hashAlgorithm,
  }
}

export function defaultRestrictions(): PortableRestrictions {
  return {
    remoteModel: "deny",
    localModel: "allow",
    embeddable: "allow",
    exportable: "deny",
  }
}

export type { KnowledgeSpace }
