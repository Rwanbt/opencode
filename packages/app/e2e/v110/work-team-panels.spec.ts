/* SPDX-License-Identifier: MIT */

// A5-01: the Work surface's new hero status badge and the "Plan de travail" /
// "Progression" panels, built from real context/team.tsx data. No Team run
// exists in this harness, so the honest assertion is the gated/empty copy —
// not a fabricated percentage or task list — plus a regression guard that the
// pre-existing operations grid (data-workbench-operation, count 11, export)
// survived being relocated underneath the new panels unchanged.

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

test("work surface shows the real Team-backed hero and panels, empty state included", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)
  await page.getByRole("button", { name: "work mode" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()

  await expect(page.locator('[data-v110="work-active-runs"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-plan-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-progress-panel"]')).toBeVisible()

  // No run has been started in this harness: the plan panel must show its
  // honest empty state, never a fabricated task list or percentage.
  await expect(page.locator('[data-v110="work-plan-panel"]').getByText(/no tasks|aucune tâche/i)).toBeVisible()
  await expect(page.locator('[data-v110="work-progress-panel"]').getByText(/0 tasks|0 tâches/i)).toBeVisible()

  // Regression guard: the pre-existing flat operations grid must keep its
  // exact shape after being relocated below the new panels.
  await expect(page.locator("[data-workbench-operation]")).toHaveCount(11)
  await page.locator('[data-workbench-operation="export"]').click()
  await expect(page.locator("[data-workbench-export]")).toBeVisible()
})
