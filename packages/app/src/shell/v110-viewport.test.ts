/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe as summary, legacy, type Viewport } from "@/shell/v110-viewport"

// A2-03 gate: minimal responsive matrix green at contract level.
// Runtime Port Gate (viewport x mode x layout, zero x-overflow) is A8.
describe("a2 responsive matrix", () => {
  test("certification viewports classify to their viewport", () => {
    const cases: Array<[number, number, Viewport]> = [
      [1440, 900, "desktop-wide"],
      [1280, 800, "desktop-wide"],
      [1024, 768, "desktop-compact"],
      [768, 1024, "tablet-portrait"],
      [390, 844, "phone-portrait"],
      [360, 800, "phone-portrait"],
      [844, 390, "compact-landscape"],
    ]
    for (const [width, height, id] of cases) expect(summary(width, height).id).toBe(id)
  })
  test("thresholds cut cleanly with no second taxonomy", () => {
    expect(summary(1200, 800).id).toBe("desktop-wide")
    expect(summary(1199, 800).id).toBe("desktop-compact")
    expect(summary(900, 700).id).toBe("desktop-compact")
    expect(summary(899, 1000).id).toBe("tablet-portrait")
    expect(summary(850, 650).id).toBe("desktop-compact")
    expect(summary(600, 900).id).toBe("tablet-portrait")
    expect(summary(599, 900).id).toBe("phone-portrait")
    expect(summary(844, 560).id).toBe("compact-landscape")
    expect(summary(844, 561).id).not.toBe("compact-landscape")
  })
  test("side invariants and layouts per viewport", () => {
    expect(summary(1440, 900).side).toBe("grid")
    expect(summary(1440, 900).wide).toBe(true)
    expect(summary(1024, 768).side).toBe("single")
    expect(summary(1024, 768).single).toBe(true)
    expect(summary(768, 1024).side).toBe("overlay")
    expect(summary(390, 844).side).toBe("overlay")
    expect(summary(844, 390).side).toBe("overlay")
    expect(summary(1440, 900).layouts).toEqual(["chat", "split", "main"])
    expect(summary(1024, 768).layouts).toEqual(["chat", "split", "main"])
    expect(summary(844, 390).layouts).toEqual(["chat", "split", "main"])
    expect(summary(768, 1024).layouts).toEqual(["chat", "main"])
    expect(summary(390, 844).layouts).toEqual(["chat", "main"])
  })
  test("legacy buckets map onto v110 without a second authority", () => {
    expect(legacy(360)).toBe("mobile")
    expect(legacy(800)).toBe("tablet")
    expect(legacy(1400)).toBe("desktop")
    expect(summary(700, 1000).id).toBe("tablet-portrait")
    expect(summary(950, 700).id).toBe("desktop-compact")
  })
  test("shell imports only the A1 contract (P1-1, P1-6)", () => {
    const dir = join(import.meta.dir, ".");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue
      if (file.endsWith(".test.ts")) continue
      const src = readFileSync(join(dir, file), "utf8")
      expect(/from\s+["\'][^"\']*use-mobile-layout["\']/.test(src)).toBe(false)
      expect(/from\s+["\'][^"\']*design-responsive["\']/.test(src)).toBe(false)
    }
  })
})
