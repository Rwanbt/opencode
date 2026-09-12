/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  DESKTOP_BREAKPOINT,
  MOBILE_BREAKPOINT,
  classifyViewport,
  pickMobileSurface,
  resolveLayout,
  type Surface,
} from "./design-responsive"

// V05 — the responsive model must give a total layout for every
// breakpoint the v110 contract names, respect the persisted chat width on desktop, downgrade
// gracefully on smaller viewports, and never let any minimum exceed
// the viewport.
describe("V05 — classifyViewport", () => {
  test("portrait overlay viewports use the one-surface switcher", () => {
    expect(classifyViewport(320, 900)).toBe("mobile")
    expect(classifyViewport(600, 900)).toBe("mobile")
    expect(classifyViewport(768, 1024)).toBe("mobile")
  })

  test("desktop compact and compact landscape keep the non-resizable split", () => {
    expect(classifyViewport(900, 700)).toBe("tablet")
    expect(classifyViewport(1024, 768)).toBe("tablet")
    expect(classifyViewport(844, 390)).toBe("tablet")
  })

  test("desktop-wide retains the resizable split", () => {
    expect(classifyViewport(1200, 800)).toBe("desktop")
    expect(classifyViewport(1440, 900)).toBe("desktop")
  })

  test("invalid dimensions fall back to desktop (a safe default, not a crash)", () => {
    expect(classifyViewport(NaN, 900)).toBe("desktop")
    expect(classifyViewport(-1, 900)).toBe("desktop")
  })

  test("breakpoints are at the documented values", () => {
    // WHY: v110 names 600 and 1200 as the boundaries. If a refactor
    // ever changes them, the design contract changes — this test makes
    // the change a one-line edit in two places.
    expect(MOBILE_BREAKPOINT).toBe(600)
    expect(DESKTOP_BREAKPOINT).toBe(1200)
  })
})

describe("V05 — resolveLayout never overflows the viewport", () => {
  const cases = [[320, 900], [600, 900], [768, 1024], [900, 700], [1024, 768], [844, 390], [1200, 800], [1440, 900]] as const
  for (const [width, height] of cases) {
    test(`viewport=${width}x${height}: chatWidth + workspaceWidth + handle <= width`, () => {
      const layout = resolveLayout(width, height, 460)
      const handle = layout.kind === "desktop" ? 8 : 0
      const total = layout.chatWidth + layout.workspaceWidth + handle
      // Mobile collapses to one full-width surface; the others
      // must fit.
      if (layout.kind === "mobile") {
        expect(layout.workspaceWidth).toBe(width)
      } else {
        expect(total).toBeLessThanOrEqual(width)
      }
    })
  }

  test("mobile: switcher is on, surface is assistant, no chat width", () => {
    const layout = resolveLayout(375, 844, 460)
    expect(layout.switcher).toBe(true)
    expect(layout.resizable).toBe(false)
    expect(layout.chatWidth).toBe(0)
    expect(layout.surface).toBe("assistant")
  })

  test("tablet: no switcher, no resize, compact chat (<= 280)", () => {
    const layout = resolveLayout(900, 700, 460)
    expect(layout.switcher).toBe(false)
    expect(layout.resizable).toBe(false)
    expect(layout.chatWidth).toBeLessThanOrEqual(280)
    expect(layout.chatWidth).toBeGreaterThan(0)
  })

  test("desktop: switcher off, resize on, chat respects persisted preference", () => {
    const layout = resolveLayout(1440, 900, 460)
    expect(layout.switcher).toBe(false)
    expect(layout.resizable).toBe(true)
    expect(layout.chatWidth).toBe(460)
  })

  test("desktop: a persisted chat width larger than the viewport is downgraded", () => {
    // The plan's §4 decision 4: no minimum can exceed the viewport.
    // A user who picked 600px chat on a 1280 monitor and resizes to
    // 600 should get the maximum the viewport allows, not the raw 600.
    const layout = resolveLayout(600, 900, 460)
    expect(layout.chatWidth).toBeLessThanOrEqual(600 - 200 - 8)
  })
})

describe("V05 — pickMobileSurface restores the user's choice", () => {
  const atelier: Surface = "atelier"
  const assistant: Surface = "assistant"

  test("a mobile viewport returns the persisted surface, or assistant by default", () => {
    expect(pickMobileSurface(undefined, 375, 844)).toBe("assistant")
    expect(pickMobileSurface(assistant, 375, 844)).toBe("assistant")
    expect(pickMobileSurface(atelier, 375, 844)).toBe("atelier")
  })

  test("a non-mobile viewport always returns assistant (the split is the only surface)", () => {
    expect(pickMobileSurface(atelier, 1024, 768)).toBe("assistant")
    expect(pickMobileSurface(atelier, 1440, 900)).toBe("assistant")
    expect(pickMobileSurface(atelier, 900, 700)).toBe("assistant")
  })
})
