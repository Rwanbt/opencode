/* SPDX-License-Identifier: MIT */

// A5-01..A5-05: the Work surface's hero status badge, its full 6-tab
// view-switcher (mirroring the v110 mockup's viewDefs), and the Team-backed
// panels behind every tab (Overview/Tasks/Board/Timeline/Activity/Runs). No
// Team run exists in this harness, so the honest assertion is the
// gated/empty copy — never a fabricated percentage, task list, event, or
// next action — plus a regression guard that the pre-existing operations
// grid (data-workbench-operation, count 11, export) survived being
// relocated underneath the new panels unchanged.

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

test("work surface's view-switcher gates the real Team-backed panels, empty state included", async ({
  page,
  directory,
  sdk,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  // The backend is worker-scoped and another v110 test may have created a
  // run already. Cancel those runs so this empty-state assertion remains
  // about the fixture's state, not test execution order.
  const existing = await sdk.team.listRuns({ limit: 50 })
  for (const run of existing.data?.items ?? []) {
    if (run.status === "pending" || run.status === "running") {
      await sdk.team.cancelRun({ runID: run.runId })
    }
  }
  await page.goto(`${dirPath(directory)}/session`)
  await page.getByRole("button", { name: "work mode" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()

  await expect(page.locator('[data-v110="work-active-runs"]')).toBeVisible()

  // All six mockup views now render tabs.
  const tabs = page.locator('[data-work-view-tablist] [role="tab"]')
  await expect(tabs).toHaveCount(6)
  await expect(page.locator('[data-work-view="overview"]')).toBeVisible()
  await expect(page.locator('[data-work-view="tasks"]')).toBeVisible()
  await expect(page.locator('[data-work-view="board"]')).toBeVisible()
  await expect(page.locator('[data-work-view="timeline"]')).toBeVisible()
  await expect(page.locator('[data-work-view="activity"]')).toBeVisible()
  await expect(page.locator('[data-work-view="runs"]')).toBeVisible()

  // Overview (default tab): Progression + Next safe action, honest empty state.
  await expect(page.locator('[data-work-view="overview"]')).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-v110="work-progress-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-next-action-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-progress-panel"]').getByText(/0 tasks|0 tâches/i)).toBeVisible()
  await expect(
    page.locator('[data-v110="work-next-action-panel"]').getByText(/no actionable task|aucune tâche actionnable/i),
  ).toBeVisible()
  // Not on this tab: Plan/Runs panels stay tab-gated, not simultaneously visible.
  await expect(page.locator('[data-v110="work-plan-panel"]')).not.toBeVisible()
  await expect(page.locator('[data-v110="work-runs-panel"]')).not.toBeVisible()

  // Tasks tab: the real DAG view, empty-state text.
  await page.locator('[data-work-view="tasks"]').click()
  await expect(page.locator('[data-work-view="tasks"]')).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-v110="work-plan-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-plan-panel"]').getByText(/no tasks|aucune tâche/i)).toBeVisible()

  // Board tab: real 6-status columns, honest empty state (no fake "Review"
  // column from the mockup, since the server has no such status).
  await page.locator('[data-work-view="board"]').click()
  await expect(page.locator('[data-work-view="board"]')).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-v110="work-board-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-board-panel"]').getByText(/no tasks|aucune tâche/i)).toBeVisible()
  const columns = page.locator('[data-v110="work-board-column"]')
  await expect(columns).toHaveCount(6)
  await expect(page.locator('[data-v110="work-board-column"][data-status="blocked"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-board-column"][data-status="cancelled"]')).toBeVisible()
  // No "review" column: the mockup's Board has one, the real status enum
  // does not.
  await expect(page.locator('[data-v110="work-board-column"][data-status="review"]')).toHaveCount(0)

  // Timeline tab: real event feed, honest empty state (no run means no events).
  await page.locator('[data-work-view="timeline"]').click()
  await expect(page.locator('[data-work-view="timeline"]')).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-v110="work-timeline-panel"]')).toBeVisible()
  await expect(
    page.locator('[data-v110="work-timeline-panel"]').getByText(/no events|aucun événement/i),
  ).toBeVisible()

  // Activity tab: the same event feed, with a real-kind filter (not the
  // mockup's fictional edit/run/approval/artifact taxonomy).
  await page.locator('[data-work-view="activity"]').click()
  await expect(page.locator('[data-work-view="activity"]')).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-v110="work-activity-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-activity-filter"]')).toBeVisible()
  await expect(
    page.locator('[data-v110="work-activity-panel"]').getByText(/no events|aucun événement/i),
  ).toBeVisible()

  // Runs tab: the real Runs list + "Open Team" reaching the real Team dialog.
  await page.locator('[data-work-view="runs"]').click()
  await expect(page.locator('[data-work-view="runs"]')).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-v110="work-runs-panel"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-runs-panel"]').getByText(/no runs|aucune exécution/i)).toBeVisible()
  await page.locator('[data-v110="work-open-team"]').click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")

  // Regression guard: the pre-existing flat operations grid must keep its
  // exact shape after being relocated below the tabbed view content.
  await expect(page.locator("[data-workbench-operation]")).toHaveCount(11)
  await page.locator('[data-workbench-operation="export"]').click()
  await expect(page.locator("[data-workbench-export]")).toBeVisible()
})
