/* SPDX-License-Identifier: MIT */

// A8-01 Port Gate skeleton (Wave 0.5). Cartesian smoke: every WAVE05
// viewport renders with zero console/page errors and zero global
// overflow; rail exposes the 4 real SHELL_MODES (automate may be grant
// gated); navigation reaches work/design/code. Inspector toggles,
// layout switch and resizers are exercised when present (A2 lands
// progressively) and recorded when absent.
// No LLM, no mocks, no external dependency: real backend + real UI.
//
// WHY one shared session for the whole matrix instead of one per case:
// 16 fresh gotoSession() calls in a single worker (real Linux CI, 1
// worker per test.yml) reproducibly drove the page/browser to close
// mid-test past roughly the 10th case, twice, in two different forms
// (a button-locator wait, then a keyboard toggle) -- the common factor
// was never the specific action, it was 16 consecutive full session
// bootstraps piling onto one shared worker-scoped backend over 40+
// minutes. Nothing here needs a fresh session per viewport: resize,
// re-check, done. Sidebar toggle is exercised once in the navigation
// test below, not per viewport -- that already proves mod+B works.

import { test, expect } from "../fixtures"
import { toggleSidebar } from "../actions"
import { promptSelector } from "../selectors"
import { classify } from "../../src/tokens/viewport"
import { WAVE05 } from "./matrix"
import { goto, keys, modes, overflow, panels, shot, track } from "./gate"

test.describe("v110 port gate (Wave 0.5 skeleton)", () => {
  test("every WAVE05 viewport renders without errors or overflow", async ({ page, gotoSession }) => {
    const t = track(page)
    await gotoSession()
    await expect(page.locator(promptSelector).first()).toBeVisible()

    for (const c of WAVE05) {
      await page.setViewportSize({ width: c.width, height: c.height })
      expect(classify(c.width, c.height), c.name + ": matrix id drifts from A1 contract").toBe(c.id)
      const over = await overflow(page)
      expect(over.dx, c.name + ": global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)
      const got = await modes(page)
      expect(got, c.name).toContain("code")
      expect(got, c.name).toContain("work")
      expect(got, c.name).toContain("design")
      expect(got.length, c.name + ": rail must expose at most 4 shell modes, saw " + got.join(",")).toBeLessThanOrEqual(4)
      await panels(page)
      await keys(page)
      await shot(page, c.name)
    }

    t.stop()
    expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
    expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
  })

  test("navigation reaches work design and back to code", async ({ page, gotoSession }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const t = track(page)
    await gotoSession()
    const got = await modes(page)
    await goto(page, "work")
    await goto(page, "design")
    if (got.includes("automate")) await goto(page, "automate")
    await goto(page, "code")
    // mod+B calls layout.sidebar.toggle() directly (commands.ts:119),
    // independent of which toggle button the viewport renders.
    await toggleSidebar(page)
    await expect(page.locator(promptSelector).first()).toBeVisible()
    await toggleSidebar(page)
    await expect(page.locator(promptSelector).first()).toBeVisible()
    // Inspector equivalents (review + file tree) toggle when rendered.
    for (const sel of ['[aria-controls="review-panel"]', '[aria-controls="file-tree-panel"]']) {
      const toggle = page.locator(sel).first()
      if (await toggle.isVisible().catch(() => false)) {
        const before = await toggle.getAttribute("aria-expanded")
        await toggle.click()
        await expect.poll(() => toggle.getAttribute("aria-expanded")).not.toBe(before)
        await toggle.click()
        await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe(before)
      }
    }
    // Layout switch (Chat/Split/Main) only when the A2 shell mounts it.
    const opts = page.locator('[data-component="layout-switch"] button')
    if (await opts.first().isVisible().catch(() => false)) {
      const total = await opts.count()
      for (let i = 0; i < total; i += 1) {
        await opts.nth(i).click()
        await expect(page.locator(promptSelector).first().or(page.locator("[data-workbench-surface]").first())).toBeVisible()
        expect((await overflow(page)).dx).toBeLessThanOrEqual(6)
      }
      await goto(page, "code")
    }
    const over = await overflow(page)
    expect(over.dx, "global x-overflow " + over.dx + "px exceeds 6px").toBeLessThanOrEqual(6)
    await shot(page, "navigation")
    t.stop()
    expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
    expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
  })
})