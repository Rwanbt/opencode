/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { extractMapKeyMaterial, MapKeyExtractionError } from "../src/workflow-map-key.ts"

describe("extractMapKeyMaterial", () => {
  test("uses the item itself for hash keys", () => {
    const item = { id: "item-1" }
    expect(extractMapKeyMaterial({ strategy: "hash" }, item)).toBe(item)
  })

  test("uses the requested field without depending on item position", () => {
    expect(extractMapKeyMaterial({ strategy: "field", field: "id" }, { id: "item-1" })).toBe("item-1")
  })

  test("rejects missing fields and non-object items", () => {
    expect(() => extractMapKeyMaterial({ strategy: "field", field: "id" }, {})).toThrow(
      MapKeyExtractionError,
    )
    expect(() => extractMapKeyMaterial({ strategy: "field", field: "id" }, null)).toThrow(
      MapKeyExtractionError,
    )
  })
})
