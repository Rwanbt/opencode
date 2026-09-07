/* SPDX-License-Identifier: MIT */

import type { Page } from "@playwright/test"
import { expect } from "../fixtures"
import { installWorkbenchMock, type WorkbenchMockOptions } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

// Shared setup for the Design surface specs (visual, accessibility, approval
// journey). They all need the same four things — the dev overlay out of the
// way, the mock bridge installed, the surface connected, and the Spec tab
// open — and each one getting them subtly wrong in its own way is how the
// previous harness ended up asserting an attribute the surface never renders.

/** A design spec that parses: the export button is disabled without one. */
export const VALID_SPEC = JSON.stringify({
  id: "design-e2e-probe",
  version: "1.0.0",
  target: "design",
  title: "Design e2e probe",
  capabilities: ["artifact.export"],
  rules: [{ id: "probe-rule", statement: "The surface stays operable without a pointer." }],
})

/**
 * Marks the page as an e2e run before the app boots.
 *
 * `layout.tsx` renders the development debug bar — frames, FPS, memory,
 * layout-shift counters — unless `e2eActive()` sees this global. Those numbers
 * change on every paint, so a capture that includes them can never match
 * anything, and a determinism check comparing two loads fails for a reason
 * that has nothing to do with the design. The seeded fixtures set it as a side
 * effect of `seedStorage`; the Design specs drive the surface directly and
 * have to set it themselves.
 */
export async function markE2E(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as { __opencode_e2e?: Record<string, unknown> }
    win.__opencode_e2e = { ...win.__opencode_e2e }
  })
}

/** Everything that has to be true before the surface is worth asserting on. */
export async function waitForSurface(page: Page): Promise<void> {
  // `data-design-connection` is the Design surface's own banner attribute.
  // These specs used to assert `data-workbench-connection`, which only the
  // Work surface renders — an assertion that could never pass, in files that
  // never ran.
  await expect(page.locator('[data-design-connection="ready"]')).toBeVisible()
  await expect(page.locator("[data-design-split-kind]")).toBeVisible()
}

export async function openDesignSurface(
  page: Page,
  directory: string,
  opts: WorkbenchMockOptions & { workspaceId?: string } = {},
): Promise<void> {
  await markE2E(page)
  await installWorkbenchMock(page, opts)
  await page.goto(`${dirPath(directory)}/design`)
  await waitForSurface(page)
}

/** The Spec tab is not the default one, and the export button lives there. */
export async function openSpecTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Spec" }).click()
  await expect(page.locator("#workbench-design-spec")).toBeVisible()
}

/** Types a valid spec and presses the export button the user presses. */
export async function submitExport(page: Page): Promise<void> {
  await openSpecTab(page)
  await page.locator("#workbench-design-spec").fill(VALID_SPEC)
  const button = page.locator("[data-design-export-render]")
  await expect(button).toBeEnabled()
  await button.click()
}
