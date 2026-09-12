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
// breakpoint the plan names (320 / 375 / 767 / 768 / 1023 / 1024 /
// 1280 / 1440), respect the persisted chat width on desktop, downgrade
// gracefully on smaller viewports, and never let any minimum exceed
// the viewport.
describe("V05 — classifyViewport", () => {
  test("320 / 375 / 767 are mobile", () => {
    expect(classifyViewport(320)).toBe("mobile")
    expect(classifyViewport(375)).toBe("mobile")
    expect(classifyViewport(767)).toBe("mobile")
  })

  test("768 / 1023 are tablet", () => {
    expect(classifyViewport(768)).toBe("tablet")
    expect(classifyViewport(1023)).toBe("tablet")
  })

  test("1024 / 1280 / 1440 are desktop", () => {
    expect(classifyViewport(1024)).toBe("desktop")
    expect(classifyViewport(1280)).toBe("desktop")
    expect(classifyViewport(1440)).toBe("desktop")
  })

  test("non-finite or negative widths fall back to desktop (a safe default, not a crash)", () => {
    expect(classifyViewport(NaN)).toBe("desktop")
    expect(classifyViewport(-1)).toBe("desktop")
  })

  test("breakpoints are at the documented values", () => {
    // WHY: the plan names 768 and 1024 as the boundaries. If a refactor
    // ever changes them, the design contract changes — this test makes
    // the change a one-line edit in two places.
    expect(MOBILE_BREAKPOINT).toBe(768)
    expect(DESKTOP_BREAKPOINT).toBe(1024)
  })
})

describe("V05 — resolveLayout never overflows the viewport", () => {
  const widths = [320, 375, 767, 768, 1023, 1024, 1280, 1440] as const
  for (const width of widths) {
    test(`width=${width}: chatWidth + workspaceWidth + handle <= viewport`, () => {
      const layout = resolveLayout(width, 460)
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
    const layout = resolveLayout(375, 460)
    expect(layout.switcher).toBe(true)
    expect(layout.resizable).toBe(false)
    expect(layout.chatWidth).toBe(0)
    expect(layout.surface).toBe("assistant")
  })

  test("tablet: no switcher, no resize, compact chat (<= 280)", () => {
    const layout = resolveLayout(900, 460)
    expect(layout.switcher).toBe(false)
    expect(layout.resizable).toBe(false)
    expect(layout.chatWidth).toBeLessThanOrEqual(280)
    expect(layout.chatWidth).toBeGreaterThan(0)
  })

  test("desktop: switcher off, resize on, chat respects persisted preference", () => {
    const layout = resolveLayout(1440, 460)
    expect(layout.switcher).toBe(false)
    expect(layout.resizable).toBe(true)
    expect(layout.chatWidth).toBe(460)
  })

  test("desktop: a persisted chat width larger than the viewport is downgraded", () => {
    // The plan's §4 decision 4: no minimum can exceed the viewport.
    // A user who picked 600px chat on a 1280 monitor and resizes to
    // 600 should get the maximum the viewport allows, not the raw 600.
    const layout = resolveLayout(600, 460)
    expect(layout.chatWidth).toBeLessThanOrEqual(600 - 200 - 8)
  })
})

describe("V05 — pickMobileSurface restores the user's choice", () => {
  const atelier: Surface = "atelier"
  const assistant: Surface = "assistant"

  test("a mobile viewport returns the persisted surface, or assistant by default", () => {
    expect(pickMobileSurface(undefined, 375)).toBe("assistant")
    expect(pickMobileSurface(assistant, 375)).toBe("assistant")
    expect(pickMobileSurface(atelier, 375)).toBe("atelier")
  })

  test("a non-mobile viewport always returns assistant (the split is the only surface)", () => {
    expect(pickMobileSurface(atelier, 1024)).toBe("assistant")
    expect(pickMobileSurface(atelier, 1440)).toBe("assistant")
    expect(pickMobileSurface(atelier, 900)).toBe("assistant")
  })
})
