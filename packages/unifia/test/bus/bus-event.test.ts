import { describe, expect, test } from "bun:test"
import { BusEvent } from "../../src/bus/bus-event"

describe("BusEvent.payloads", () => {
  test("orders members by type, not registration order", () => {
    // Registration happens as an import-time side effect across ~30 files,
    // so it tracks module resolution order — not guaranteed stable across
    // platforms. This is what made the generated OpenAPI spec (and SDK)
    // reproducible on one machine and drift on every other. Sorting removes
    // that dependency entirely.
    const options = (BusEvent.payloads() as unknown as { options: { shape: { type: { value: string } } }[] }).options
    const types = options.map((option) => option.shape.type.value)

    expect(types).toEqual([...types].toSorted((a, b) => a.localeCompare(b)))
  })

  test("includes every event registered so far, exactly once", () => {
    const options = (BusEvent.payloads() as unknown as { options: { shape: { type: { value: string } } }[] }).options
    const types = options.map((option) => option.shape.type.value)

    expect(new Set(types).size).toBe(types.length)
    expect(types.length).toBeGreaterThan(0)
  })
})
