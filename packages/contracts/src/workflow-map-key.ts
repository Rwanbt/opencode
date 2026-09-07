/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Stable map-item key material (Plan V2.3.1 §199 "stable map keys",
 * ADR-005).
 *
 * A `control.map` runs its body once per item of a collection, and each
 * iteration is a sub-run that must survive a crash and a replay. That
 * requires a *durable identity* per item: the same item must resolve to the
 * same `mapItemId` on every execution, whatever order the collection
 * arrives in.
 *
 * The identity is a content digest of the item's key material. This module
 * owns the material; it does not own the hash. `digest()` lives in
 * `@unifia/digest-runtime`, which depends on this package — deriving the
 * digest here would invert the dependency (AGENTS.md, dependency
 * direction). Splitting the two also means the digest layer imports the
 * ~50 lines it needs rather than the whole graph validator.
 *
 * See `workflow-graph.ts` for the graph-topology half of the same M2-TEST
 * card, and `graph-property.test.ts` for the properties both halves lock.
 */
import type { MapKeySpec } from "./workflow-ir.js"

export class MapKeyExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MapKeyExtractionError"
  }
}

/**
 * The stable key material of one `control.map` item, before hashing.
 *
 * - `field`: the named field's value. Throws when the item is not an
 *   object or the field is absent — a map whose key field is missing on
 *   some items cannot produce stable per-item identities, and silently
 *   falling back to the collection index would make replay unsafe.
 * - `hash`: the item itself; the digest layer canonicalizes and hashes it.
 *
 * Pure and order-independent: an item's material never depends on its
 * position in the collection. That is the property replay-safety rests on
 * (ADR-005) and the one `graph-property.test.ts` locks.
 */
export function extractMapKeyMaterial(
  spec: MapKeySpec,
  item: unknown,
): unknown {
  if (spec.strategy === "hash") return item
  const field = spec.field
  if (field === undefined) {
    throw new MapKeyExtractionError(
      "control.map: key.field is required when strategy is 'field'",
    )
  }
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    const seen = item === null ? "null" : typeof item
    throw new MapKeyExtractionError(
      `control.map: key strategy 'field' requires object items, got ${seen}`,
    )
  }
  const record = item as Record<string, unknown>
  if (!Object.hasOwn(record, field)) {
    throw new MapKeyExtractionError(
      `control.map: item is missing key field '${field}'`,
    )
  }
  return record[field]
}
