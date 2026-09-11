/* SPDX-License-Identifier: MIT */

// A5-01/A5-02: the Work surface's new hero status badge and its four
// Team-backed panels ("Plan de travail", "Runs" — replacing the mockup's
// unbacked "Agents" — "Progression", and "Next safe action" — redesigned
// around the real next task instead of the mockup's unbound sliders). No
// Team run exists in this harness, so the honest assertion is the
// gated/empty copy — never a fabricated percentage, task list, or next
// action — plus a regression guard that the pre-existing operations grid
// (data-workbench-operation, count 11, export) survived being relocated
// underneath the new panels unchanged.

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

test("work surface shows the real Team-backed hero and panels, empty state included", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(`${dirPath(directory)}/session`)
  await page.getByRole("button", { name: "work mode" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()

  await expect(page.locator('[data-v110="work-active-runs"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-plan-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-runs-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-progress-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-next-action-panel"]')).toBeVisible()

  // No run has been started in this harness: every panel must show its
  // honest empty state, never a fabricated task list, percentage, or action.
  await expect(page.locator('[data-v110="work-plan-panel"]').getByText(/no tasks|aucune tâche/i)).toBeVisible()
  await expect(page.locator('[data-v110="work-progress-panel"]').getByText(/0 tasks|0 tâches/i)).toBeVisible()
  await expect(page.locator('[data-v110="work-runs-panel"]').getByText(/no runs|aucune exécution/i)).toBeVisible()
  await expect(
    page.locator('[data-v110="work-next-action-panel"]').getByText(/no actionable task|aucune tâche actionnable/i),
  ).toBeVisible()

  // "Open Team" reaches the real Team dialog (the same one the topbar opens).
  await page.locator('[data-v110="work-open-team"]').click()
  await expect(page.getByRole("dialog")).toBeVisible()

  // Regression guard: the pre-existing flat operations grid must keep its
  // exact shape after being relocated below the new panels.
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-workbench-operation]")).toHaveCount(11)
  await page.locator('[data-workbench-operation="export"]').click()
  await expect(page.locator("[data-workbench-export]")).toBeVisible()
})
