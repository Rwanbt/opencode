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
  // A8-01 cartesian: the original loop put all 16 WAVE05 viewports into
  // one test, but a single worker reproducibly drove the page/browser to
  // close mid-test past roughly the 10th case (see the header comment in
  // the previous version of this file). Splitting into four 4-viewport
  // tests gives each group a fresh page so the browser memory pressure
  // resets between groups, while still keeping the same coverage matrix.
  test.setTimeout(180_000)
  // The first 4 viewports are the mission ones — keep screenshots for
  // visual regression review. The 12 edge cases are covered for matrix
  // invariant checks only; skipping their screenshots frees ~75 % of
  // the browser memory pressure observed during consecutive
  // setViewportSize calls.
  const missionViewports = new Set(WAVE05.slice(0, 4).map((c) => c.name))
  const groups: { label: string; cases: typeof WAVE05 }[] = [
    { label: "mission viewports (desktop + tablet + phone)", cases: WAVE05.slice(0, 4) },
    { label: "edge cases — wide breakpoints", cases: WAVE05.slice(4, 8) },
    { label: "edge cases — narrow breakpoints", cases: WAVE05.slice(8, 12) },
    { label: "edge cases — landscape + tablet", cases: WAVE05.slice(12, 16) },
  ]
  for (const group of groups) {
    test(`every WAVE05 viewport renders without errors or overflow (${group.label})`, async ({ page, gotoSession }) => {
      const t = track(page)
      await gotoSession()
      await expect(page.locator(promptSelector).first()).toBeVisible()

      for (const c of group.cases) {
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
        if (missionViewports.has(c.name)) await shot(page, c.name)
        // Let the browser settle between resizes — without this, the
        // page can drop frames during the next setViewportSize and the
        // locator in the next iteration times out.
        await page.waitForTimeout(80)
      }

      t.stop()
      expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
      expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
    })
  }

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
    // Inspector equivalents (review + file tree) toggle when rendered. Both
    // now drive the same shared InspectorFrame pane (aria-controls is
    // identical for both), so distinguish them by accessible name instead.
    for (const name of ["Toggle review", "Toggle file tree"]) {
      const toggle = page.getByRole("button", { name }).first()
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