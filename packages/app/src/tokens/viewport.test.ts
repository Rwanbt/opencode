/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { CASES, classify, cohabit, COMPACT, exclusive, LANDSCAPE_H, LANDSCAPE_W, layouts, side, TABLET, WIDE } from "@/tokens/viewport"

describe("v110 viewport contract", () => {
  test("thresholds match the manifest breakpoints", () => {
    expect(WIDE).toBe(1200)
    expect(COMPACT).toBe(900)
    expect(TABLET).toBe(600)
    expect(LANDSCAPE_H).toBe(560)
    expect(LANDSCAPE_W).toBe(980)
  })

  test("certification cases classify to their own viewport", () => {
    for (const item of CASES) expect(classify(item.width, item.height)).toBe(item.id)
  })

  test("desktop boundaries", () => {
    expect(classify(1920, 1080)).toBe("desktop-wide")
    expect(classify(1200, 800)).toBe("desktop-wide")
    expect(classify(1199, 800)).toBe("desktop-compact")
    expect(classify(1024, 768)).toBe("desktop-compact")
    expect(classify(900, 700)).toBe("desktop-compact")
  })

  test("tablet, phone and landscape buckets", () => {
    expect(classify(768, 1024)).toBe("tablet-portrait")
    expect(classify(600, 900)).toBe("tablet-portrait")
    expect(classify(390, 844)).toBe("phone-portrait")
    expect(classify(599, 900)).toBe("phone-portrait")
    expect(classify(844, 390)).toBe("compact-landscape")
    expect(classify(700, 500)).toBe("compact-landscape")
    expect(classify(850, 650)).toBe("desktop-compact")
  })

  test("invalid input falls back to desktop-wide", () => {
    expect(classify(Number.NaN, 900)).toBe("desktop-wide")
    expect(classify(0, 0)).toBe("desktop-wide")
  })

  test("side mode, layouts and invariants per viewport", () => {
    expect(side("desktop-wide")).toBe("grid")
    expect(side("desktop-compact")).toBe("single")
    expect(side("tablet-portrait")).toBe("overlay")
    expect(side("phone-portrait")).toBe("overlay")
    expect(side("compact-landscape")).toBe("overlay")
    expect(layouts("desktop-wide")).toEqual(["chat", "split", "main"])
    expect(layouts("desktop-compact")).toEqual(["chat", "split", "main"])
    expect(layouts("compact-landscape")).toEqual(["chat", "split", "main"])
    expect(layouts("tablet-portrait")).toEqual(["chat", "main"])
    expect(layouts("phone-portrait")).toEqual(["chat", "main"])
    expect(cohabit("desktop-wide")).toBe(true)
    expect(cohabit("desktop-compact")).toBe(false)
    expect(exclusive("desktop-compact")).toBe(true)
    expect(exclusive("desktop-wide")).toBe(false)
  })
})
