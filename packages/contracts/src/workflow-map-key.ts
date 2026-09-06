/* SPDX-License-Identifier: MIT */
import type { MapKeySpec } from "./workflow-ir.js"

export class MapKeyExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MapKeyExtractionError"
  }
}

export function extractMapKeyMaterial(spec: MapKeySpec, item: unknown): unknown {
  if (spec.strategy === "hash") return item
  if (spec.field === undefined) {
    throw new MapKeyExtractionError("control.map: key.field is required when strategy is 'field'")
  }
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new MapKeyExtractionError(
      `control.map: key strategy 'field' requires object items, got ${item === null ? "null" : typeof item}`,
    )
  }
  const record = item as Record<string, unknown>
  if (!Object.hasOwn(record, spec.field)) {
    throw new MapKeyExtractionError(`control.map: item is missing key field '${spec.field}'`)
  }
  return record[spec.field]
}
