import { describe, expect, test } from "bun:test"
import { selectionGeometry } from "./terminal-selection-geometry"

describe("selectionGeometry", () => {
  const base = {
    range: { start: { x: 2, y: 3 }, end: { x: 5, y: 4 } },
    canvasRect: { left: 24, top: 100, width: 300, height: 400 },
    containerRect: { left: 0, top: 80 },
    columns: 30,
    rows: 40,
  }

  test("maps viewport cells to CSS client coordinates", () => {
    expect(selectionGeometry(base)).toEqual({
      start: { clientX: 49, clientY: 135, overlayLeft: 44, overlayTop: 60 },
      end: { clientX: 79, clientY: 145, overlayLeft: 84, overlayTop: 70 },
    })
  })

  test("keeps direction-independent endpoints usable for crossing", () => {
    const result = selectionGeometry({ ...base, range: { start: { x: 12, y: 8 }, end: { x: 4, y: 2 } } })
    expect(result?.start.overlayLeft).toBe(144)
    expect(result?.end.overlayLeft).toBe(74)
  })

  test("uses the final transformed canvas rect exactly once", () => {
    const result = selectionGeometry({ ...base, canvasRect: { left: 24, top: 76, width: 300, height: 400 } })
    expect(result?.start.overlayTop).toBe(36)
    expect(result?.start.clientY).toBe(111)
  })

  test("rejects unusable layout metrics", () => {
    expect(selectionGeometry({ ...base, columns: 0 })).toBeUndefined()
    expect(selectionGeometry({ ...base, canvasRect: { ...base.canvasRect, width: 0 } })).toBeUndefined()
  })
})