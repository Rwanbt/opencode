/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"
import { openSpecTab } from "../design/surface"

// V14 — second and third scenarios of the design journey.
//
// The "bridge ready" scenario (open project → Design → mock bridge
// → send prompt → receive artifact → preview → comment → refine →
// version → export) needs a platform.workbench injection. That is
// out of scope for this card: V03 marked the workbench bridge as
// "not testable in the Vite harness without a platform mock", and
// the mock fixture itself is a non-trivial card of its own. V14
// delivers the two scenarios that ARE testable today:
//
//   - bridge indisponible / unsupported (V03 closure): the banner
//     shows the terminal state, the Reconnecter button is gone,
//     and a click on the "broken" spec raises a single diagnostic.
//
//   - responsive (V05+V06 closure): the same surface renders
//     without horizontal overflow at 375 / 768 / 1280 / 1440 px,
//     and the mobile surface switcher is the only path to the
//     workshop on small viewports.

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const

test("V14 — design mode in web is terminal and non-retryable (F-03 closure)", async ({ page, directory, slug }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/design`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/design(?:[/?#]|$)`))

  // Banner: "unsupported" phase, no Reconnecter button.
  // The Design surface names its own banner: data-workbench-connection is
  // rendered by Work, so this asserted an attribute this route never emits.
  await expect(page.locator('[data-design-connection="unsupported"]')).toBeVisible()
  await expect(page.locator("[data-design-retry]")).toHaveCount(0)

  // The spec editor is still usable. An invalid spec raises a
  // single diagnostic line, not the legacy "JSON invalide" double
  // error (F-05 closure).
  // Fichiers is the default tab; the editor only exists once Spec is
  // selected. This filled a locator that was never in the DOM.
  await openSpecTab(page)
  await page.locator("#workbench-design-spec").fill('{"id":"broken"}')
  await expect(page.locator("[data-workbench-diagnostics]")).toBeVisible()
  const diagnosticCount = await page.locator("[data-workbench-diagnostics] p").count()
  expect(diagnosticCount).toBe(1)
})

test("V14 — design mode renders without horizontal overflow at every plan viewport", async ({ page, directory }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(`${dirPath(directory)}/design`)
    // The shell fills the viewport; no horizontal overflow.
    // The size guard is the design-split data attribute V06
    // exposes (data-design-split-kind) for the runtime gate.
    await expect(page.locator("[data-design-split-kind]")).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${viewport.name} must not overflow horizontally`).toBeLessThanOrEqual(1)
  }
})

test("V14 — mobile design mode exposes the assistant/atelier switcher (V06 closure)", async ({ page, directory }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`${dirPath(directory)}/design`)

  // The switcher is a real tablist; the active tab is the only one
  // in the natural tab order (roving tabindex).
  const tablist = page.locator('[data-design-surface-switcher]')
  await expect(tablist).toBeVisible()
  await expect(tablist.getByRole("tab", { name: "Assistant" })).toBeVisible()
  await expect(tablist.getByRole("tab", { name: "Workshop" })).toBeVisible()

  // Default surface is assistant.
  await expect(page.locator("[data-design-split-assistant]")).toBeVisible()

  // Roving-tab navigation must make the inactive Workshop tab reachable
  // from the single natural tab stop. It is the only keyboard path to the
  // Atelier surface on a mobile viewport.
  const assistantTab = tablist.getByRole("tab", { name: "Assistant" })
  await assistantTab.focus()
  await assistantTab.press("ArrowRight")
  await expect(tablist.getByRole("tab", { name: "Workshop" })).toBeFocused()
  await expect(page.locator("[data-design-split-atelier]")).toBeVisible()
  await expect(page.locator("[data-design-split-assistant]")).toHaveCount(0)
})

test("V14 — desktop design mode keeps assistant and atelier side by side with a splitter", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${dirPath(directory)}/design`)

  await expect(page.locator("[data-design-split-kind]")).toBeVisible()
  // data-design-split-kind is set by the V06 model; desktop = side
  // by side, no switcher.
  await expect(page.locator("[data-design-split-kind=\"desktop\"]")).toBeVisible()
  await expect(page.locator("[data-design-split-chat]")).toBeVisible()
  await expect(page.locator("[data-design-split-workspace]")).toBeVisible()
  await expect(page.locator("[data-design-split-handle]")).toBeVisible()
  await expect(page.locator("[data-design-surface-switcher]")).toHaveCount(0)
})
