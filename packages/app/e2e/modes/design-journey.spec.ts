/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { openSpecTab } from "../design/surface"
import { dirPath } from "../utils"

// V14.5 — first end-to-end run of the design journey with a
// mock workbench bridge. The harness installs the mock via
// `addInitScript` so the global is set BEFORE `entry.tsx`
// reads it. The page side then sees a fully connected bridge
// (instead of the `unsupported` terminal state from V03) and
// the design surface renders the workspace path.

test("V14.5 — mock workbench bridge keeps the design surface in the connected state", async ({ page, directory, slug }) => {
  await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/design`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/design(?:[/?#]|$)`))

  // The connection banner shows the connected state, not the unsupported
  // terminal from V03. The attribute is the Design surface own one:
  // data-workbench-connection is rendered by Work, so the previous locator
  // could never match — nobody noticed because the suite did not load.
  await expect(page.locator('[data-design-connection="ready"]')).toBeVisible()
  await expect(page.getByText(/workbench instance/i).first()).toBeVisible()

  // The design surface mounts; the spec editor is present. Fichiers is the
  // default tab, so the editor only exists once Spec is selected — the
  // previous version asserted it straight away and could not pass.
  await openSpecTab(page)
  await expect(page.locator("[data-design-spec-editor]")).toBeVisible()
})

test("V14.5 — listDesignSystems is reachable and surfaces the mock catalog", async ({ page, directory }) => {
  await installWorkbenchMock(page, {
    workspaceId: "mock-workspace-2",
    designSystems: [
      {
        id: "mock-catalog",
        name: "Mock catalog",
        version: "9.9.9",
        source: "test-source",
        tokens: { colors: { primary: "#ff00ff" }, spacing: {}, typography: {} },
      },
    ],
  })
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/design`)
  await openSpecTab(page)
  await expect(page.locator("[data-design-catalog=\"mock-catalog\"]")).toBeVisible()
  await expect(page.getByText("Mock catalog · 9.9.9")).toBeVisible()
})
