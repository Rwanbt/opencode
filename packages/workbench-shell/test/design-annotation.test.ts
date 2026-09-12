/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { EMPTY_ANNOTATION_STATE, addStroke, clearStrokes, newStrokeId, undoStroke, type AnnotationStroke } from "../src/design-annotation"

function stroke(id: string, points: { x: number; y: number }[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }]): AnnotationStroke {
  return { id, points }
}

describe("addStroke", () => {
  test("appends a stroke", () => {
    const next = addStroke(EMPTY_ANNOTATION_STATE, stroke("s-1"))
    expect(next.strokes).toEqual([stroke("s-1")])
  })
  test("preserves insertion order across multiple strokes", () => {
    const s1 = addStroke(EMPTY_ANNOTATION_STATE, stroke("s-1"))
    const s2 = addStroke(s1, stroke("s-2"))
    expect(s2.strokes.map((s) => s.id)).toEqual(["s-1", "s-2"])
  })
  test("a stroke with zero points is dropped", () => {
    const next = addStroke(EMPTY_ANNOTATION_STATE, stroke("s-1", []))
    expect(next).toBe(EMPTY_ANNOTATION_STATE)
  })
  test("does not mutate the input state", () => {
    const before = EMPTY_ANNOTATION_STATE
    addStroke(before, stroke("s-1"))
    expect(before.strokes).toEqual([])
  })
})

describe("clearStrokes", () => {
  test("empties all strokes", () => {
    const s1 = addStroke(addStroke(EMPTY_ANNOTATION_STATE, stroke("s-1")), stroke("s-2"))
    expect(clearStrokes(s1).strokes).toEqual([])
  })
  test("is a no-op (same reference) on an already-empty state", () => {
    expect(clearStrokes(EMPTY_ANNOTATION_STATE)).toBe(EMPTY_ANNOTATION_STATE)
  })
})

describe("undoStroke", () => {
  test("removes only the last stroke", () => {
    const s1 = addStroke(addStroke(EMPTY_ANNOTATION_STATE, stroke("s-1")), stroke("s-2"))
    const undone = undoStroke(s1)
    expect(undone.strokes.map((s) => s.id)).toEqual(["s-1"])
  })
  test("is a no-op on an empty state", () => {
    expect(undoStroke(EMPTY_ANNOTATION_STATE)).toBe(EMPTY_ANNOTATION_STATE)
  })
  test("undoing every stroke returns to empty", () => {
    const s1 = addStroke(EMPTY_ANNOTATION_STATE, stroke("s-1"))
    expect(undoStroke(s1).strokes).toEqual([])
  })
})

describe("newStrokeId", () => {
  test("generates distinct ids for different (now, rand) pairs", () => {
    const id1 = newStrokeId(1000, 0.1)
    const id2 = newStrokeId(1000, 0.2)
    const id3 = newStrokeId(2000, 0.1)
    expect(id1).not.toBe(id2)
    expect(id1).not.toBe(id3)
  })
  test("starts with the recognized 's-' prefix", () => {
    expect(newStrokeId()).toMatch(/^s-/)
  })
})
