/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM,
  VIEWPORT_IDS,
  VIEWPORT_PRESETS,
  ZOOM_PRESETS,
  effectiveScale,
  findViewport,
  fitScale,
  type ViewportId,
} from "../src/viewport"

describe("VIEWPORT_PRESETS — invariants", () => {
  test("contient desktop, tablet, mobile avec leurs dimensions spec", () => {
    expect(VIEWPORT_PRESETS).toHaveLength(3)
    const desktop = findViewport("desktop")
    const tablet = findViewport("tablet")
    const mobile = findViewport("mobile")
    expect(desktop).toEqual({ id: "desktop", width: 1440, height: 900, label: "Desktop · 1440×900" })
    expect(tablet).toEqual({ id: "tablet", width: 768, height: 1024, label: "Tablet · 768×1024" })
    expect(mobile).toEqual({ id: "mobile", width: 390, height: 844, label: "Mobile · 390×844" })
    expect(VIEWPORT_IDS).toEqual(["desktop", "tablet", "mobile"])
  })

  test("toutes les dimensions sont positives et finies", () => {
    for (const v of VIEWPORT_PRESETS) {
      expect(v.width).toBeGreaterThan(0)
      expect(v.height).toBeGreaterThan(0)
      expect(Number.isFinite(v.width)).toBe(true)
      expect(Number.isFinite(v.height)).toBe(true)
    }
  })
})

describe("fitScale — plafonnement à 1", () => {
  test("un grand canvas ne grossit pas un viewport : scale = 1", () => {
    // canvas 2000x1500, desktop 1440x900 → 1.38 et 1.66 → min plafonné à 1
    expect(fitScale("desktop", 2000, 1500)).toBe(1)
    expect(fitScale("tablet", 4000, 3000)).toBe(1)
    expect(fitScale("mobile", 4000, 3000)).toBe(1)
  })

  test("un canvas plus petit que le viewport : scale < 1 (le plus contraignant des deux axes)", () => {
    // canvas 720x600, desktop 1440x900 → 0.5 et 0.666 → 0.5
    expect(fitScale("desktop", 720, 600)).toBeCloseTo(0.5, 6)
    // canvas 500x500, mobile 390x844 → 1.28 et 0.59 → 0.59
    expect(fitScale("mobile", 500, 500)).toBeCloseTo(500 / 844, 6)
    // canvas 300x900, tablet 768x1024 → 0.39 et 0.879 → 0.39
    expect(fitScale("tablet", 300, 900)).toBeCloseTo(300 / 768, 6)
  })

  test("un canvas de taille exacte : scale = 1", () => {
    expect(fitScale("desktop", 1440, 900)).toBe(1)
    expect(fitScale("tablet", 768, 1024)).toBe(1)
    expect(fitScale("mobile", 390, 844)).toBe(1)
  })

  test("un canvas très petit : scale très petit (mais toujours > 0)", () => {
    const s = fitScale("mobile", 50, 50)
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
    expect(s).toBeCloseTo(50 / 844, 6)
  })

  test("canvas ≤ 0 → fallback safe 1 (defensive, ne devrait pas arriver)", () => {
    expect(fitScale("desktop", 0, 0)).toBe(1)
    expect(fitScale("desktop", -100, 500)).toBe(1)
  })

  test("canvas non fini (NaN/Infinity) → fallback safe 1", () => {
    expect(fitScale("desktop", Number.NaN, 500)).toBe(1)
    expect(fitScale("desktop", 500, Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe("effectiveScale — composition fitScale × zoom", () => {
  test("zoom 100% sur grand canvas = 1 (fitScale plafonné)", () => {
    expect(effectiveScale("desktop", 2000, 1500, 100)).toBe(1)
  })

  test("zoom 50% sur grand canvas = 0.5 (le plafond 1 reste, le zoom rétrécit)", () => {
    expect(effectiveScale("desktop", 2000, 1500, 50)).toBeCloseTo(0.5, 6)
  })

  test("zoom 200% sur canvas qui rentre = 2 (pas de plafond sur le zoom utilisateur)", () => {
    // canvas 2000x1500, desktop 1440x900 → fit = 1, zoom 200% → 2
    expect(effectiveScale("desktop", 2000, 1500, 200)).toBeCloseTo(2, 6)
  })

  test("zoom 75% sur petit canvas = fit × 0.75", () => {
    // canvas 720x600, desktop → fit 0.5, zoom 75% → 0.375
    expect(effectiveScale("desktop", 720, 600, 75)).toBeCloseTo(0.375, 6)
  })

  test("zoom invalide (0 ou NaN) → fallback 1 (le fit s'applique normalement)", () => {
    expect(effectiveScale("desktop", 720, 600, 0)).toBeCloseTo(0.5, 6)
    expect(effectiveScale("desktop", 720, 600, Number.NaN)).toBeCloseTo(0.5, 6)
  })
})

describe("defaults + constantes", () => {
  test("DEFAULT_VIEWPORT = 'desktop'", () => {
    expect(DEFAULT_VIEWPORT).toBe("desktop")
  })

  test("DEFAULT_ZOOM = 100", () => {
    expect(DEFAULT_ZOOM).toBe(100)
  })

  test("ZOOM_PRESETS contient 50, 75, 100, 125, 150, 200", () => {
    expect(ZOOM_PRESETS).toEqual([50, 75, 100, 125, 150, 200])
  })

  test("findViewport fallback sur desktop si id inconnu (defensive)", () => {
    const fake = "unknown" as ViewportId
    expect(findViewport(fake)).toEqual(VIEWPORT_PRESETS[0])
  })
})
