/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { openDesignSurface, submitExport } from "./surface"
import { expectNoNewViolations } from "./axe"

// Accessibility gate for the Design surface — WCAG 2.1 AA, via axe.
//
// The states below are the ones the plan names: the surface itself, Automate
// present and absent, the approval modal, a completed export, and a failed
// one. They are scanned in a real browser because that is the only place the
// tree axe reads exists — the unit suite cannot even load design-surface.tsx
// (Solid's `use` is client-only), which is exactly how five defects shipped
// behind a modal with no reachable control.
//
// A dialog is the state most worth scanning and the least likely to be right:
// it needs a role, an accessible name, and controls a keyboard can reach.
// Scanning the whole document while it is open would drown the modal's own
// result in whatever the surface underneath already reports, so the modal is
// scanned on its own subtree.
//
// `expectNoNewViolations` fails on every rule except the ones axe.ts records
// as pre-existing, with the reason written down there.

/**
 * The Design surface root.
 *
 * The scans are scoped to it on purpose. A document-wide scan also reports the
 * application chrome — the workspace tab strip nests a close button inside a
 * role="tab", which axe flags as nested-interactive — and that is neither this
 * surface own defect nor something this gate can fix without redesigning
 * shared chrome. Reporting it here would force a blanket exemption and blind
 * the gate to the surface real regressions. It is recorded as a separate
 * finding instead.
 */
const DESIGN_SURFACE = "[data-design-split-kind]"

const VIEWPORT = { width: 1440, height: 900 }

test.describe("Design surface — WCAG 2.1 AA", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
  })

  test("the surface has no violations, and Automate stays out of the rail without the grant", async ({
    page,
    directory,
  }, testInfo) => {
    await openDesignSurface(page, directory)
    // DA-UI-01: no `workflow.run` grant, no Automate entry. The rail is
    // rendered twice (desktop and mobile), so this counts across both.
    await expect(page.locator('button[data-mode="automate"]')).toHaveCount(0)
    await expectNoNewViolations(page, testInfo, "Design surface, Automate hidden", DESIGN_SURFACE)
  })

  test("the surface has no violations with Automate in the rail", async ({ page, directory }, testInfo) => {
    await openDesignSurface(page, directory, { grants: ["workflow.run"] })
    await expect(page.locator('button[data-mode="automate"]').first()).toBeVisible()
    await expectNoNewViolations(page, testInfo, "Design surface, Automate visible", DESIGN_SURFACE)
  })

  test("the approval modal has no violations", async ({ page, directory }, testInfo) => {
    await openDesignSurface(page, directory, { exportOutcome: "approval-required" })
    await submitExport(page)
    const modal = page.locator('[data-design-approval-modal="approval-required"]')
    await expect(modal).toBeVisible()
    // The dialog contract that matters for a modal the user cannot dismiss any
    // other way: a role, a name, and reachable controls.
    await expect(modal).toHaveAttribute("role", "dialog")
    await expect(modal).toHaveAttribute("aria-labelledby", "design-approval-title")
    await expectNoNewViolations(page, testInfo, "approval modal", "[data-design-approval-modal]")
  })

  test("a completed export has no violations", async ({ page, directory }, testInfo) => {
    await openDesignSurface(page, directory)
    await submitExport(page)
    await expect(page.locator('[data-design-export-result="exported"]')).toBeVisible()
    await expectNoNewViolations(page, testInfo, "export completed", DESIGN_SURFACE)
  })

  test("a failed export has no violations", async ({ page, directory }, testInfo) => {
    await openDesignSurface(page, directory, { exportOutcome: "error" })
    await submitExport(page)
    await expect(page.locator('[data-design-export-result="error"]')).toBeVisible()
    await expectNoNewViolations(page, testInfo, "export failed", DESIGN_SURFACE)
  })
})
