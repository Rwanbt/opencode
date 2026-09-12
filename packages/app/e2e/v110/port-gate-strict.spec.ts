/* SPDX-License-Identifier: MIT */

// A8-02 Wave 0.5 strict gate. Written against WAVE05_CANDIDATE_SHA
// (A1 + A2-01/02/03 + A8-01 merged into feat/ui-v110-port): every marker
// A2 committed to landing is now mandatory, not "exercised when present".
// A8-01 (port-gate.spec.ts) stays as the permissive cartesian smoke; this
// file is the hardening pass, per docs/ui-reference/v110/PLAN-8-AGENTS.md
// Wave 0.5 gate and OWNERSHIP.md's A8 mandate ("hard-fail if A2's
// committed markers are missing"). No LLM, no mocks, no waitForTimeout.

import { test, expect } from "../fixtures"
import { toggleSidebar } from "../actions"
import { promptSelector } from "../selectors"
import { classify } from "../../src/tokens/viewport"

const DESKTOP_WIDE = { width: 1440, height: 900 }
const DESKTOP_COMPACT = { width: 1024, height: 768 }
const TABLET_PORTRAIT = { width: 768, height: 1024 }
const PHONE_PORTRAIT = { width: 390, height: 844 }
const LANDSCAPE = { width: 844, height: 390 }

const SHELL_FRAME = '[data-component="v110-shell-frame"]'
const TOPBAR = '[data-component="v110-topbar"]'
const RAIL = '[data-component="sidebar-rail"]:visible'
const MOBILE_NAV = '[data-component="v110-mobile-nav"]'
const KNOWN_MODES = new Set(["code", "work", "design", "automate"])

test.describe("v110 port gate — A8-02 strict (Wave 0.5 hardening)", () => {
  test("shell frame, topbar and rail are mounted with only real SHELL_MODES", async ({ page, gotoSession }) => {
    await page.setViewportSize(DESKTOP_WIDE)
    await gotoSession()
    await expect(page.locator(promptSelector).first()).toBeVisible()

    await expect(page.locator(SHELL_FRAME), "v110 shell frame must be mounted (A2-01)").toBeVisible()
    await expect(page.locator(TOPBAR), "v110 topbar must be mounted (A2-01)").toBeVisible()

    const rail = page.locator(RAIL).first()
    await expect(rail, "v110 rail must be mounted (A2-01)").toBeVisible()
    const modeButtons = rail.locator("[data-mode]")
    const count = await modeButtons.count()
    expect(count, "rail must expose at least one real mode").toBeGreaterThan(0)
    for (let i = 0; i < count; i += 1) {
      const value = await modeButtons.nth(i).getAttribute("data-mode")
      expect(KNOWN_MODES.has(value ?? ""), `rail exposes an unregistered mode: ${value}`).toBe(true)
    }
  })

  test("mobile nav is the single navigation authority below 600px portrait, never above", async ({
    page,
    gotoSession,
  }) => {
    await gotoSession()

    for (const size of [DESKTOP_WIDE, DESKTOP_COMPACT, TABLET_PORTRAIT, LANDSCAPE]) {
      await page.setViewportSize(size)
      await expect(
        page.locator(MOBILE_NAV),
        `mobile nav must stay hidden at ${size.width}x${size.height} (classify=${classify(size.width, size.height)})`,
      ).toBeHidden()
    }

    await page.setViewportSize(PHONE_PORTRAIT)
    await expect(
      page.locator(MOBILE_NAV),
      "mobile nav must be visible at phone-portrait (A2-03 committed this marker)",
    ).toBeVisible()
  })

  test("context separator is keyboard-resizable, not just attributed", async ({ page, gotoSession }) => {
    // mod+B (layout.sidebar.toggle()), not the openSidebar button-locator
    // helper: see the CI finding on desktop-1440x900 in port-gate.spec.ts
    // — the button-locator path reproducibly hangs to the 90s test
    // timeout on real Linux CI even at a plain desktop width, for reasons
    // not fully root-caused. layout.sidebar starts closed on a fresh
    // session (context/layout.tsx default store), so one toggle opens it.
    await page.setViewportSize(DESKTOP_WIDE)
    await gotoSession()
    await toggleSidebar(page)

    const separator = page.locator('[data-v110="resize-context"]')
    await expect(separator, "context resize separator must be visible when the panel is open").toBeVisible()
    await expect(separator).toHaveAttribute("role", "separator")
    await expect(separator).toHaveAttribute("tabindex", "0")

    await separator.focus()
    const before = await separator.getAttribute("aria-valuenow")
    await page.keyboard.press("ArrowRight")
    const after = await separator.getAttribute("aria-valuenow")
    expect(after, "ArrowRight on a focused separator must change aria-valuenow").not.toBe(before)
  })

  test("desktop-compact: opening the left panel closes the inspector, and inversely", async ({
    page,
    gotoSession,
  }) => {
    // Uses the mod+B command (layout.sidebar.toggle(), commands.ts:119)
    // instead of clicking the visible toggle button: see the finding in
    // the test below ("desktop chrome, not the mobile drawer...") —
    // between 900 and 1279px the rendered button is the mobile hamburger
    // (bound to layout.mobileSidebar), not the real desktop
    // layout.sidebar this exclusion is about. The keybind reaches
    // layout.sidebar directly at any width, which is what actually
    // exercises the fix under test regardless of that separate bug.
    await page.setViewportSize(DESKTOP_COMPACT)
    await gotoSession()

    // v110: both toggle buttons share one InspectorFrame pane and the same
    // aria-controls value now (session-side-panel.tsx) — either works here.
    const inspectorToggle = page.getByRole("button", { name: "Toggle review" }).first()
    await inspectorToggle.click()
    await expect(inspectorToggle).toHaveAttribute("aria-expanded", "true")

    await toggleSidebar(page)

    await expect(
      inspectorToggle,
      "desktop-compact must close the inspector when the left panel opens (RESPONSIVE-MATRIX.md)",
    ).toHaveAttribute("aria-expanded", "false")
  })

  test("desktop chrome, not the mobile drawer, must render across the full desktop-compact band", async ({
    page,
    gotoSession,
  }) => {
    // The titlebar uses the dedicated `shell` breakpoint (900px), matching
    // tokens/viewport.ts's certified desktop-compact boundary rather than
    // Tailwind's unrelated 1280px `xl` breakpoint.
    await page.setViewportSize(DESKTOP_COMPACT)
    await gotoSession()

    const desktopToggle = page.getByRole("button", { name: /^toggle sidebar$/i }).first()
    await expect(
      desktopToggle,
      `desktop sidebar toggle must render at 1024px (classify=${classify(1024, 768)}); ` +
        "instead the xl:1280px Tailwind cutoff falls back to the mobile hamburger",
    ).toBeVisible()
  })
})
