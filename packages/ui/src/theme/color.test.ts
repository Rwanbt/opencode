import { describe, expect, test } from "bun:test"
import {
  hexToRgb,
  rgbToHex,
  rgbToOklch,
  oklchToRgb,
  hexToOklch,
  oklchToHex,
  fitOklch,
  mixColors,
  shift,
  blend,
  lighten,
  darken,
  withAlpha,
  generateScale,
  generateNeutralScale,
  generateAlphaScale,
} from "./color"
import type { HexColor } from "./types"

const HEX = /^#[0-9a-f]{6}$/

describe("hexToRgb", () => {
  test("parses 6-digit hex", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 })
  })

  test("expands 3-digit shorthand", () => {
    expect(hexToRgb("#fff")).toEqual(hexToRgb("#ffffff"))
    expect(hexToRgb("#f00")).toEqual(hexToRgb("#ff0000"))
  })

  test("ignores the alpha byte of 8-digit hex", () => {
    expect(hexToRgb("#ff000080")).toEqual(hexToRgb("#ff0000"))
  })

  test("tolerates a missing leading #", () => {
    expect(hexToRgb("00ff00" as HexColor)).toEqual({ r: 0, g: 1, b: 0 })
  })

  test("returns channels in the [0, 1] range", () => {
    const { r, g, b } = hexToRgb("#8040c0")
    for (const v of [r, g, b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe("rgbToHex", () => {
  test("formats normalized channels", () => {
    expect(rgbToHex(1, 1, 1)).toBe("#ffffff")
    expect(rgbToHex(0, 0, 0)).toBe("#000000")
  })

  test("clamps out-of-gamut channels instead of overflowing", () => {
    expect(rgbToHex(2, -1, 0.5)).toBe("#ff0080")
  })

  test("round-trips with hexToRgb", () => {
    for (const hex of ["#000000", "#ffffff", "#123456", "#abcdef", "#7f7f7f"] as HexColor[]) {
      const { r, g, b } = hexToRgb(hex)
      expect(rgbToHex(r, g, b)).toBe(hex)
    }
  })
})

describe("oklch conversions", () => {
  test("rgb -> oklch -> rgb round-trips within tolerance", () => {
    for (const hex of ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#888888"] as HexColor[]) {
      const { r, g, b } = hexToRgb(hex)
      const back = oklchToRgb(rgbToOklch(r, g, b))
      expect(back.r).toBeCloseTo(r, 4)
      expect(back.g).toBeCloseTo(g, 4)
      expect(back.b).toBeCloseTo(b, 4)
    }
  })

  test("hexToOklch matches rgbToOklch on the same color", () => {
    const { r, g, b } = hexToRgb("#3b82f6")
    expect(hexToOklch("#3b82f6")).toEqual(rgbToOklch(r, g, b))
  })

  test("oklchToHex always returns a valid 6-digit hex", () => {
    expect(oklchToHex({ l: 0.6, c: 0.15, h: 250 })).toMatch(HEX)
  })

  test("pure white and black have expected lightness extremes", () => {
    expect(hexToOklch("#ffffff").l).toBeCloseTo(1, 2)
    expect(hexToOklch("#000000").l).toBeCloseTo(0, 5)
  })
})

describe("fitOklch", () => {
  test("clamps lightness to [0, 1] and chroma to >= 0", () => {
    const fitted = fitOklch({ l: 1.5, c: -0.2, h: 90 })
    expect(fitted.l).toBeLessThanOrEqual(1)
    expect(fitted.l).toBeGreaterThanOrEqual(0)
    expect(fitted.c).toBeGreaterThanOrEqual(0)
  })

  test("wraps hue into [0, 360)", () => {
    expect(fitOklch({ l: 0.5, c: 0.1, h: 400 }).h).toBeCloseTo(40, 6)
    expect(fitOklch({ l: 0.5, c: 0.1, h: -30 }).h).toBeCloseTo(330, 6)
  })

  test("reduces chroma until the color is in sRGB gamut", () => {
    // Wildly out-of-gamut chroma must be pulled back so oklchToRgb stays in range.
    const fitted = fitOklch({ l: 0.7, c: 5, h: 30 })
    const rgb = oklchToRgb(fitted)
    for (const v of [rgb.r, rgb.g, rgb.b]) {
      expect(v).toBeGreaterThanOrEqual(-1e-9)
      expect(v).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

describe("mixColors", () => {
  test("amount 0 yields the first color, amount 1 the second", () => {
    expect(mixColors("#ff0000", "#0000ff", 0)).toBe(oklchToHex(hexToOklch("#ff0000")))
    expect(mixColors("#ff0000", "#0000ff", 1)).toBe(oklchToHex(hexToOklch("#0000ff")))
  })

  test("a half mix sits between the endpoints in lightness", () => {
    const mid = hexToOklch(mixColors("#000000", "#ffffff", 0.5))
    expect(mid.l).toBeGreaterThan(0.1)
    expect(mid.l).toBeLessThan(0.9)
  })

  test("takes the shortest path around the hue wheel", () => {
    // 350° and 10° are 20° apart across 0°, not 340° the long way.
    const a = oklchToHex({ l: 0.6, c: 0.12, h: 350 })
    const b = oklchToHex({ l: 0.6, c: 0.12, h: 10 })
    const h = hexToOklch(mixColors(a, b, 0.5)).h
    const nearZero = h < 30 || h > 330
    expect(nearZero).toBe(true)
  })
})

describe("lighten / darken / shift", () => {
  test("lighten raises lightness, darken lowers it", () => {
    const base = hexToOklch("#777777").l
    expect(hexToOklch(lighten("#777777", 0.2)).l).toBeGreaterThan(base)
    expect(hexToOklch(darken("#777777", 0.2)).l).toBeLessThan(base)
  })

  test("lighten/darken clamp at the lightness extremes", () => {
    expect(hexToOklch(lighten("#ffffff", 0.5)).l).toBeLessThanOrEqual(1)
    expect(hexToOklch(darken("#000000", 0.5)).l).toBeGreaterThanOrEqual(0)
  })

  test("shift with no deltas is a near-identity round-trip", () => {
    expect(shift("#3b82f6", {})).toBe(oklchToHex(hexToOklch("#3b82f6")))
  })
})

describe("blend", () => {
  test("alpha 1 returns the foreground, alpha 0 the background", () => {
    expect(blend("#ff0000", "#0000ff", 1)).toBe("#ff0000")
    expect(blend("#ff0000", "#0000ff", 0)).toBe("#0000ff")
  })

  test("alpha 0.5 averages the channels", () => {
    expect(blend("#000000", "#ffffff", 0.5)).toBe("#808080")
  })
})

describe("withAlpha", () => {
  test("emits an rgba() string with 0-255 channels", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)")
    expect(withAlpha("#00ff00", 1)).toBe("rgba(0, 255, 0, 1)")
  })
})

describe("scale generators", () => {
  const seed: HexColor = "#3b82f6"

  for (const isDark of [true, false]) {
    test(`generateScale returns 12 valid hex colors (dark=${isDark})`, () => {
      const scale = generateScale(seed, isDark)
      expect(scale).toHaveLength(12)
      for (const hex of scale) expect(hex).toMatch(HEX)
    })

    test(`generateNeutralScale returns 12 valid hex colors (dark=${isDark})`, () => {
      const scale = generateNeutralScale(seed, isDark)
      expect(scale).toHaveLength(12)
      for (const hex of scale) expect(hex).toMatch(HEX)
    })

    test(`generateNeutralScale with ink returns 12 valid hex colors (dark=${isDark})`, () => {
      const scale = generateNeutralScale(seed, isDark, "#101010")
      expect(scale).toHaveLength(12)
      for (const hex of scale) expect(hex).toMatch(HEX)
    })

    test(`generateAlphaScale returns 12 valid hex colors (dark=${isDark})`, () => {
      const alpha = generateAlphaScale(generateScale(seed, isDark), isDark)
      expect(alpha).toHaveLength(12)
      for (const hex of alpha) expect(hex).toMatch(HEX)
    })
  }
})
