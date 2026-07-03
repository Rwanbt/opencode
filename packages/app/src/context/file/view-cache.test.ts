import { describe, expect, test } from "bun:test"
import { normalizeSelectedLines, equalSelectedLines } from "./view-cache"
import { selectionFromLines, type SelectedLineRange } from "./types"

// D-08: pure line-range logic of the file viewer's selection state.

describe("normalizeSelectedLines", () => {
  test("leaves a forward range untouched", () => {
    const r = normalizeSelectedLines({ start: 1, end: 3 })
    expect(r.start).toBe(1)
    expect(r.end).toBe(3)
  })

  test("leaves a single-line range untouched", () => {
    const r = normalizeSelectedLines({ start: 5, end: 5 })
    expect(r.start).toBe(5)
    expect(r.end).toBe(5)
  })

  test("swaps start/end for a reverse range", () => {
    const r = normalizeSelectedLines({ start: 3, end: 1 })
    expect(r.start).toBe(1)
    expect(r.end).toBe(3)
  })

  test("swaps sides when reversing a two-sided (diff) selection", () => {
    const r = normalizeSelectedLines({ start: 3, end: 1, side: "additions", endSide: "deletions" })
    expect(r.start).toBe(1)
    expect(r.end).toBe(3)
    expect(r.side).toBe("deletions") // the original endSide becomes the new start side
    expect(r.endSide).toBe("additions")
  })

  test("drops endSide when reversing a single-sided selection", () => {
    const r = normalizeSelectedLines({ start: 3, end: 1, side: "additions" })
    expect(r.start).toBe(1)
    expect(r.end).toBe(3)
    expect(r.side).toBe("additions")
    expect(r.endSide).toBeUndefined()
  })

  test("returns a copy, not the same reference", () => {
    const input: SelectedLineRange = { start: 1, end: 3 }
    expect(normalizeSelectedLines(input)).not.toBe(input)
  })
})

describe("equalSelectedLines", () => {
  test("two nullish values are equal", () => {
    expect(equalSelectedLines(null, null)).toBe(true)
    expect(equalSelectedLines(undefined, undefined)).toBe(true)
    expect(equalSelectedLines(null, undefined)).toBe(true)
  })

  test("one nullish and one set are not equal", () => {
    expect(equalSelectedLines(null, { start: 1, end: 3 })).toBe(false)
    expect(equalSelectedLines({ start: 1, end: 3 }, undefined)).toBe(false)
  })

  test("identical ranges are equal", () => {
    expect(equalSelectedLines({ start: 1, end: 3 }, { start: 1, end: 3 })).toBe(true)
  })

  test("a range equals its reverse (normalized)", () => {
    expect(equalSelectedLines({ start: 1, end: 3 }, { start: 3, end: 1 })).toBe(true)
  })

  test("different bounds are not equal", () => {
    expect(equalSelectedLines({ start: 1, end: 5 }, { start: 1, end: 3 })).toBe(false)
  })

  test("different sides are not equal", () => {
    expect(equalSelectedLines({ start: 1, end: 3, side: "additions" }, { start: 1, end: 3, side: "deletions" })).toBe(
      false,
    )
  })
})

describe("selectionFromLines", () => {
  test("maps a forward range to ordered line bounds", () => {
    expect(selectionFromLines({ start: 1, end: 5 })).toEqual({
      startLine: 1,
      endLine: 5,
      startChar: 0,
      endChar: 0,
    })
  })

  test("orders a reverse range (min/max)", () => {
    expect(selectionFromLines({ start: 5, end: 1 })).toEqual({
      startLine: 1,
      endLine: 5,
      startChar: 0,
      endChar: 0,
    })
  })
})
