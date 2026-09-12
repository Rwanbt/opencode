/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Canonical node registry (Phase 1) � the single source of truth for
 * node types and their executors.
 *
 * WHY one registry: the runtime, the HTTP API, the future canvas, the
 * node picker, the inspector and the AI builder must all agree on what
 * a node type IS. A second registry (UI-side list, builder-side list)
 * would drift; there is exactly one here.
 *
 * A `NodeDefinition` is intentionally NOT a plugin system yet: custom
 * nodes register through the same `register()` call a future extension
 * host will use, but no dynamic loading exists in this phase.
 */
import type { P3Capability } from "@unifia/contracts"

export type NodeExecutorKind = "http" | "transform" | "internal" | "external"

export type NodeMetadata = {
  readonly displayName: string
  readonly description: string
  readonly category: "trigger" | "action" | "transform" | "logic" | "human"
}

export type NodeDefinition = {
  /** Stable type id, e.g. `tool.http`. Never renamed once published. */
  readonly type: string
  /** Semver-ish version, e.g. `v1`. Definitions are immutable per version. */
  readonly version: string
  readonly metadata: NodeMetadata
  /** JSON Schemas (as plain objects) for authoring-time validation. */
  readonly inputSchema: Record<string, unknown>
  readonly outputSchema: Record<string, unknown>
  readonly configSchema: Record<string, unknown>
  /** Capabilities the executor needs; enforced by the P3 gate. */
  readonly capabilities: readonly P3Capability[]
  readonly effects: readonly string[]
  /** Which executor runs nodes of this type: `http`/`transform` run in the
   * Phase 1 driver; `internal` runs inside the graph engine itself
   * (control families); `external` is dispatched outside the runtime
   * (human approval, waits, triggers). */
  readonly executor: NodeExecutorKind
}

export class NodeRegistryError extends Error {
  constructor(readonly code: "NODE_TYPE_CONFLICT" | "NODE_VERSION_UNKNOWN" | "NODE_TYPE_UNKNOWN", message: string) {
    super(message)
    this.name = "NodeRegistryError"
  }
}

/** Numeric-aware version comparison (`v2` < `v10`; lexical fallback). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[^0-9]+/).filter((part) => part.length > 0).map(Number)
  const pb = b.split(/[^0-9]+/).filter((part) => part.length > 0).map(Number)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return a < b ? -1 : a > b ? 1 : 0
}

export class NodeRegistry {
  private readonly defs = new Map<string, NodeDefinition>()

  private static key(type: string, version: string): string {
    return `${type}@${version}`
  }

  register(def: NodeDefinition): void {
    if (!def.type || !def.version) throw new NodeRegistryError("NODE_TYPE_UNKNOWN", "node type and version are required")
    const key = NodeRegistry.key(def.type, def.version)
    const existing = this.defs.get(key)
    if (existing && existing !== def) {
      throw new NodeRegistryError("NODE_TYPE_CONFLICT", `node type already registered with a different definition: ${key}`)
    }
    this.defs.set(key, def)
  }

  get(type: string, version?: string): NodeDefinition {
    if (version) {
      const exact = this.defs.get(NodeRegistry.key(type, version))
      if (!exact) throw new NodeRegistryError("NODE_VERSION_UNKNOWN", `unknown node ${type}@${version}`)
      return exact
    }
    const candidates = [...this.defs.values()].filter((d) => d.type === type).sort((a, b) => compareVersions(b.version, a.version))
    const latest = candidates[0]
    if (!latest) throw new NodeRegistryError("NODE_TYPE_UNKNOWN", `unknown node type: ${type}`)
    return latest
  }

  list(): readonly NodeDefinition[] {
    return [...this.defs.values()].sort((a, b) => (a.type < b.type ? -1 : 1))
  }
}
