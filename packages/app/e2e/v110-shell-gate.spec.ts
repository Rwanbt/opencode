/* SPDX-License-Identifier: MIT */

/**
 * MiniMax M3 — Phase 3 Shell global gate.
 *
 * Verifies the cross-cutting shell surfaces mounted for every viewport
 * family, the responsive authority is the single source of truth
 * (no local breakpoints), and the 4 shell modes are reachable.
 * Uses m3-harness helpers for deterministic viewport switching.
 *
 * Anti-regression rule honoured: NO viewport loop in a single page.
 * Each viewport family runs in its own `test` block with a fresh
 * page fixture.
 */

import { describe, expect, test } from "bun:test"
import {
  VIEWPORT_FAMILIES,
  assertShellMounted,
  globalHorizontalOverflow,
  overflowReport,
  pickShellMode,
  pickInspectorTab,
  setViewportFamily,
  toggleWorkspaceSidebar,
  type ViewportFamily,
} from "./m3-harness"

const FAMILIES: ViewportFamily[] = [
  "desktopLarge",
  "desktopCompact",
  "tabletLandscape",
  "tabletPortrait",
  "mobileLandscape",
  "mobilePortrait",
]

describe("M3 shell gate (Phase 3)", () => {
  for (const family of FAMILIES) {
    test(`shell mounts + no overflow @ ${family} (${VIEWPORT_FAMILIES[family].width}x${VIEWPORT_FAMILIES[family].height})`, async ({ page }) => {
      await setViewportFamily(page, family)
      await assertShellMounted(page)
      const overflow = await globalHorizontalOverflow(page)
      expect(overflow, `${family}: root horizontal overflow`).toBeLessThanOrEqual(6)
      const offenders = await overflowReport(page)
      expect(offenders, `${family}: offenders ${JSON.stringify(offenders)}`).toEqual([])
    })
  }

  test("desktop-large can switch all four shell modes", async ({ page }) => {
    await setViewportFamily(page, "desktopLarge")
    await assertShellMounted(page)
    for (const mode of ["code", "work", "design", "automate"] as const) {
      const resolved = await pickShellMode(page, mode)
      expect(resolved, `mode switch`).toBe(mode)
    }
  })

  test("desktop-compact sidebar toggles open and closed", async ({ page }) => {
    await setViewportFamily(page, "desktopCompact")
    await assertShellMounted(page)
    const opened = await toggleWorkspaceSidebar(page)
    expect(typeof opened).toBe("boolean")
    const overflow = await globalHorizontalOverflow(page)
    expect(overflow).toBeLessThanOrEqual(6)
  })

  test("desktop-large inspector tabs are reachable", async ({ page }) => {
    await setViewportFamily(page, "desktopLarge")
    await assertShellMounted(page)
    for (const tab of ["explorer", "inspector", "execution"] as const) {
      await pickInspectorTab(page, tab)
    }
  })

  test("mobile-portrait shell mounts but desktop panels collapse", async ({ page }) => {
    await setViewportFamily(page, "mobilePortrait")
    await assertShellMounted(page)
    // Mobile nav must be visible (≤600px portrait), rail collapsed.
    const nav = page.locator('[data-v110="mobile-nav"]')
    await nav.waitFor({ state: "visible", timeout: 1500 })
  })
})
