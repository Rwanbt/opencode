/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { clampSize, delta, drag, FAST, orientation, STEP } from "@/tokens/resizer"

describe("v110 resizer contract", () => {
  test("arrow step is 16px, Shift fast-step is 24px", () => {
    expect(STEP).toBe(16)
    expect(FAST).toBe(24)
    expect(delta("ArrowLeft", false)).toBe(-16)
    expect(delta("ArrowUp", false)).toBe(-16)
    expect(delta("ArrowRight", false)).toBe(16)
    expect(delta("ArrowDown", false)).toBe(16)
    expect(delta("ArrowLeft", true)).toBe(-24)
    expect(delta("ArrowRight", true)).toBe(24)
  })

  test("unhandled keys stay undefined", () => {
    expect(delta("Home", false)).toBeUndefined()
    expect(delta("End", true)).toBeUndefined()
    expect(delta("Tab", false)).toBeUndefined()
    expect(delta("a", false)).toBeUndefined()
  })

  test("axis x is a vertical separator, axis y a horizontal one", () => {
    expect(orientation("x")).toBe("vertical")
    expect(orientation("y")).toBe("horizontal")
  })

  test("clampSize keeps sizes inside bounds and maps NaN to min", () => {
    expect(clampSize(100, 10, 50)).toBe(50)
    expect(clampSize(5, 10, 50)).toBe(10)
    expect(clampSize(30, 10, 50)).toBe(30)
    expect(clampSize(Number.NaN, 10, 50)).toBe(10)
  })

  test("drag grows the sized panel toward the pointer", () => {
    expect(drag(300, 100, 120, "start")).toBe(320)
    expect(drag(300, 100, 80, "start")).toBe(280)
    expect(drag(300, 100, 120, "end")).toBe(280)
    expect(drag(300, 100, 80, "end")).toBe(320)
  })
})
