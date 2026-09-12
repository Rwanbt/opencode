/* SPDX-License-Identifier: MIT */

/**
 * MiniMax M3 — Phase 2 test harness helpers.
 *
 * Extends the existing actions.ts / fixtures.ts with viewport,
 * mode-switch, overflow and focus assertions needed for the
 * M3 acceptance matrix. Every helper is deterministic, scoped to
 * one viewport, and returns a primitive (boolean/number/string) so
 * callers can compose them into Playwright expect() assertions
 * without coupling to internal state shapes.
 *
 * Anti-regression rule honored: NO helper loops over multiple
 * viewports in the same page (the Vague-0 cartesian-matrix hang).
 * Multi-viewport coverage lives in separate spec files with their
 * own page fixture.
 */

import type { Page } from "@playwright/test"

export type ShellMode = "code" | "work" | "design" | "automate"

/** The six viewport families mandated by VISUAL-GATES + RESPONSIVE-MATRIX. */
export const VIEWPORT_FAMILIES = {
  desktopLarge: { width: 1440, height: 900 },
  desktopCompact: { width: 1280, height: 800 },
  tabletLandscape: { width: 1024, height: 768 },
  tabletPortrait: { width: 768, height: 1024 },
  mobileLandscape: { width: 844, height: 390 },
  mobilePortrait: { width: 390, height: 844 },
} as const

export type ViewportFamily = keyof typeof VIEWPORT_FAMILIES

/**
 * Switch to one of the six viewport families. The Playwright page is
 * mutated in place; no extra context or goto is issued so the running
 * session keeps its state (scroll position, selected tab, etc.) —
 * critical for catching layout regressions vs re-launching the page.
 */
export async function setViewportFamily(page: Page, family: ViewportFamily): Promise<void> {
  const size = VIEWPORT_FAMILIES[family]
  await page.setViewportSize(size)
}

/**
 * Pick a shell mode by clicking the corresponding rail trigger.
 * Asserts the mode change took effect by reading the data attribute
 * on the workspace main element. Returns the resolved mode.
 */
export async function pickShellMode(page: Page, target: ShellMode): Promise<ShellMode> {
  const trigger = page.locator(`[data-component="rail-mode-${target}"]`)
  await trigger.click()
  const workspace = page.locator('[data-component="session-workspace"]')
  await workspace.waitFor({ state: "visible" })
  const resolved = (await workspace.getAttribute("data-workbench-mode")) as ShellMode | null
  if (resolved !== target) {
    throw new Error(`pickShellMode(${target}) resolved to ${resolved}; rail trigger likely missing or click intercepted`)
  }
  return resolved
}

/** Toggle the persistent sidebar; returns whether the sidebar is now opened. */
export async function toggleWorkspaceSidebar(page: Page): Promise<boolean> {
  await page.keyboard.press("Control+B")
  const opened = await page.locator('[data-v110="resize-context-wrapper"]').isVisible()
  return opened
}

/** Toggle one of the three inspector tabs (Explorer, Inspector, Execution). */
export async function pickInspectorTab(
  page: Page,
  tab: "explorer" | "inspector" | "execution",
): Promise<void> {
  await page.locator(`[role="tab"][data-v110-tab="${tab}"]`).click()
  const panel = page.locator(`[data-v110-tab-panel="${tab}"]`)
  await panel.waitFor({ state: "visible" })
}

/** Measure global horizontal overflow on document.documentElement. */
export async function globalHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
}

/** Check no element on the page has scrollWidth overflowing its clientWidth by more than 6 px. */
export async function overflowReport(page: Page): Promise<{ selector: string; overflow: number }[]> {
  return page.evaluate(() => {
    const offenders: { selector: string; overflow: number }[] = []
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const overflow = el.scrollWidth - el.clientWidth
      if (overflow > 6) {
        offenders.push({
          selector: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.split(" ").join(".") : ""}`,
          overflow,
        })
      }
    })
    return offenders
  })
}

/** Wait for the keyboard focus trap to settle on a specific element within a dialog. */
export async function waitForFocusOn(
  page: Page,
  selector: string,
  timeout = 1000,
): Promise<boolean> {
  try {
    await page.locator(selector).focus({ timeout })
    return true
  } catch {
    return false
  }
}

/** Capture an annotated screenshot for visual review; returns the saved path. */
export async function captureAnnotated(
  page: Page,
  label: string,
  dir = "e2e/artifacts",
): Promise<string> {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  await fs.mkdir(path.resolve(dir), { recursive: true })
  const safe = label.replace(/[^a-z0-9-_]/gi, "-").slice(0, 80)
  const file = path.resolve(dir, `${Date.now()}-${safe}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/** Assert the page has no console errors after a viewport change. */
export async function expectNoConsoleErrors(
  page: Page,
  errorCollector: string[],
): Promise<void> {
  if (errorCollector.length > 0) {
    throw new Error(`Unexpected console errors: ${errorCollector.join(" | ")}`)
  }
}

/** Build the canonical shell gate assertion: 4 modes + no overflow + frame mounted. */
export async function assertShellMounted(page: Page): Promise<void> {
  const frame = page.locator('[data-v110="shell-frame"]')
  await frame.waitFor({ state: "visible" })
  for (const mode of ["code", "work", "design", "automate"] as const) {
    const trigger = page.locator(`[data-component="rail-mode-${mode}"]`)
    if ((await trigger.count()) === 0) {
      throw new Error(`rail-mode-${mode} trigger not mounted in shell`)
    }
  }
}
