/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { resolveMobileLayout } from "./use-mobile-layout"

describe("resolveMobileLayout", () => {
  test("uses the v110 overlay contract instead of legacy 768px buckets", () => {
    expect(resolveMobileLayout(600, 900, false)).toMatchObject({ isMobile: true, isTablet: true })
    expect(resolveMobileLayout(768, 1024, false)).toMatchObject({ isMobile: true, isTablet: true })
    expect(resolveMobileLayout(900, 700, false)).toMatchObject({ isMobile: false, isTablet: false })
    expect(resolveMobileLayout(844, 390, false)).toMatchObject({ isMobile: true, isTablet: false })
  })

  test("keeps native mobile controls even on a wide viewport", () => {
    expect(resolveMobileLayout(1440, 900, true).isMobile).toBe(true)
  })
})
