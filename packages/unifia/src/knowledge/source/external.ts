/* SPDX-License-Identifier: MIT */
/**
 * External knowledge source.
 *
 * Per ADR-KNOW-0002 and plan gelé §17, an external space is
 * read-only by default. Capabilities (`read`, `watch`, `write`,
 * `metadata-write`) are explicit and must be granted by the
 * user.
 *
 * The runtime implementation is owned by `NativeKnowledgePort`
 * (Rust). The TS file only defines the contract.
 */

import type {
  KnowledgeSpace,
  KnowledgeSpaceKind,
  KnowledgeLocator,
  KnowledgeId,
  ExternalSpaceCapability,
  KnowledgeErrorKind,
} from "@unifia/contracts/knowledge"
import type {
  KnowledgeSource,
  ListOptions,
  ListedNote,
  SourceEvent,
} from "./source.js"
import type { ParsedDocument } from "../parser/parser.js"

/**
 * Raised when an operation is attempted on a mount that was not granted the
 * matching capability. Carries the `capability_unavailable` kind so callers
 * can distinguish a refusal from a backend failure.
 */
export class ExternalCapabilityError extends Error {
  readonly kind: KnowledgeErrorKind = "capability_unavailable"
  constructor(
    readonly mountId: string,
    readonly capability: ExternalSpaceCapability,
    operation: string,
  ) {
    super(
      `external mount "${mountId}" cannot ${operation}: capability "${capability}" not granted`,
    )
    this.name = "ExternalCapabilityError"
  }
}

export interface ExternalSourceConfig {
  /** Stable identifier of the mount. */
  mountId: string
  /** Human-readable label. */
  label: string
  /** Granted capabilities. Empty = read-only default. */
  capabilities?: ExternalSpaceCapability[]
}

export class ExternalSource implements KnowledgeSource {
  readonly space: KnowledgeSpace
  private readonly impl: KnowledgeSource

  constructor(config: ExternalSourceConfig, impl: KnowledgeSource) {
    const caps = config.capabilities ?? ["read"]
    this.space = {
      kind: "external" satisfies KnowledgeSpaceKind,
      id: config.mountId,
      label: config.label,
      capabilities: caps,
    }
    this.impl = impl
  }

  get canRead(): boolean {
    return (this.space.capabilities ?? []).includes("read")
  }
  get canWatch(): boolean {
    return (this.space.capabilities ?? []).includes("watch")
  }
  get canWrite(): boolean {
    return (this.space.capabilities ?? []).includes("write")
  }
  get canMetadataWrite(): boolean {
    return (this.space.capabilities ?? []).includes("metadata-write")
  }

  /**
   * Refuse before touching the backend. A capability that only describes what
   * a mount may do, without gating it, is not a permission — it is a label.
   */
  private require(capability: ExternalSpaceCapability, operation: string): void {
    if ((this.space.capabilities ?? []).includes(capability)) return
    throw new ExternalCapabilityError(this.space.id, capability, operation)
  }

  // `list` and `read` declare a Promise, so a missing capability rejects
  // rather than throwing synchronously — a caller holding `.catch()` must not
  // be bypassed by a sync throw.
  async list(options: ListOptions): Promise<ListedNote[]> {
    this.require("read", "list")
    return this.impl.list(options)
  }
  async read(locator?: KnowledgeLocator, id?: KnowledgeId): Promise<ParsedDocument | null> {
    this.require("read", "read")
    return this.impl.read(locator, id)
  }
  watch(onChange: (event: SourceEvent) => void): () => void {
    this.require("watch", "watch")
    return this.impl.watch(onChange)
  }
}
