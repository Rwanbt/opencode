import { describe, expect, test } from "bun:test"
import { lifecycleKey, moveCursor, navigationKey, reconcileCursor } from "../../../src/cli/cmd/tui/util/team-keyboard"

// Coverage for the TEAM-M05 keyboard navigation of the Team dialog.
//
// TEAM-M02 shipped the dialog with selection bound to onMouseUp alone, so a run
// could not be reached without a pointer. In a terminal that is the surface
// where a pointer is most likely to be absent.

describe("navigationKey — only unmodified keys move the cursor", () => {
  test("arrows and vim keys move", () => {
    expect(navigationKey({ name: "up" })).toBe("up")
    expect(navigationKey({ name: "k" })).toBe("up")
    expect(navigationKey({ name: "down" })).toBe("down")
    expect(navigationKey({ name: "j" })).toBe("down")
  })

  test("home and end jump to the extremes", () => {
    expect(navigationKey({ name: "home" })).toBe("home")
    expect(navigationKey({ name: "g" })).toBe("home")
    expect(navigationKey({ name: "end" })).toBe("end")
    expect(navigationKey({ name: "G" })).toBe("end")
  })

  test("enter and space select, escape clears", () => {
    expect(navigationKey({ name: "return" })).toBe("select")
    expect(navigationKey({ name: "space" })).toBe("select")
    expect(navigationKey({ name: "escape" })).toBe("clear")
  })

  test("a modified key belongs to the application, not to the list", () => {
    // ctrl-c must stay an interrupt rather than becoming a cursor move.
    expect(navigationKey({ name: "c", ctrl: true })).toBe("none")
    expect(navigationKey({ name: "down", ctrl: true })).toBe("none")
    expect(navigationKey({ name: "k", meta: true })).toBe("none")
  })

  test("an unrelated key does nothing", () => {
    expect(navigationKey({ name: "x" })).toBe("none")
    expect(navigationKey({})).toBe("none")
  })
})

describe("lifecycleKey — active run controls", () => {
  test("maps p/r/c and preserves modified application shortcuts", () => {
    expect(lifecycleKey({ name: "p" })).toBe("pause")
    expect(lifecycleKey({ name: "r" })).toBe("resume")
    expect(lifecycleKey({ name: "c" })).toBe("cancel")
    expect(lifecycleKey({ name: "c", ctrl: true })).toBe("none")
  })
})
describe("moveCursor — clamps, never wraps", () => {
  test("moves within the list", () => {
    expect(moveCursor({ index: 1, count: 5, key: "down" })).toBe(2)
    expect(moveCursor({ index: 1, count: 5, key: "up" })).toBe(0)
  })

  test("down at the end stays at the end", () => {
    // Wrapping in a list that grows as pages load means "down" at what looked
    // like the end silently jumps to the top and the reader loses their place.
    expect(moveCursor({ index: 4, count: 5, key: "down" })).toBe(4)
  })

  test("up at the top stays at the top", () => {
    expect(moveCursor({ index: 0, count: 5, key: "up" })).toBe(0)
  })

  test("home and end reach the extremes", () => {
    expect(moveCursor({ index: 3, count: 5, key: "home" })).toBe(0)
    expect(moveCursor({ index: 1, count: 5, key: "end" })).toBe(4)
  })

  test("an empty list keeps the cursor at zero rather than going negative", () => {
    expect(moveCursor({ index: 0, count: 0, key: "up" })).toBe(0)
    expect(moveCursor({ index: 0, count: 0, key: "end" })).toBe(0)
  })

  test("a non-movement key leaves the cursor where it is", () => {
    expect(moveCursor({ index: 2, count: 5, key: "select" })).toBe(2)
    expect(moveCursor({ index: 2, count: 5, key: "none" })).toBe(2)
  })
})

describe("reconcileCursor — the list changes under the cursor", () => {
  test("a page arriving does not move the cursor", () => {
    expect(reconcileCursor({ index: 3, count: 60 })).toBe(3)
  })

  test("a shrinking list pulls the cursor back to the last row", () => {
    // Left past the end, nothing renders as current and the next keypress
    // appears to jump.
    expect(reconcileCursor({ index: 40, count: 5 })).toBe(4)
  })

  test("an emptied list resets to zero", () => {
    expect(reconcileCursor({ index: 7, count: 0 })).toBe(0)
  })
})
