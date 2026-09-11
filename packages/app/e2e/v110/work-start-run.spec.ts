/* SPDX-License-Identifier: MIT */

// A5-06: the "start a new run" form — the first real write path this
// workstream adds (sdk.client.team.startRun). createTestProject() already
// runs `git init` + a commit before every test (see e2e/actions.ts), which
// satisfies startRun's git-HEAD precondition, so a real submission can be
// asserted end-to-end. Deliberately does NOT try to drive the run to
// completion (would require mocking arbitrary per-task LLM calls for a
// user-authored task list) — only that the real 202-accepted path works and
// the new run becomes visible in the Runs tab.

import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

test("start-run form submits a real run and it appears in the Runs tab", async ({ page, directory, sdk }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  // Team execution is intentionally fail-closed unless two distinct models
  // are configured. The isolated E2E provider exposes both; seed the same
  // server-owned selection the settings surface would persist.
  const selection = await sdk.client.team.config({
    models: [
      { providerID: "e2e", modelID: "test-model" },
      { providerID: "e2e", modelID: "review-model" },
    ],
  })
  expect(selection.error).toBeUndefined()
  await page.goto(`${dirPath(directory)}/session`)
  await page.getByRole("button", { name: "work mode" }).click()
  await page.locator('[data-work-view="runs"]').click()

  // Client-side validation rejects an empty form before any network call.
  await page.locator('[data-v110="work-start-run"]').click()
  await expect(page.locator('[data-v110="work-start-run-dialog"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-start-run-submit"]')).toBeDisabled()

  await page.locator('[data-v110="work-start-run-description"]').fill("Automated test run")
  const row = page.locator('[data-v110="work-start-run-task-row"]').first()
  await row.locator('input').first().fill("t1")
  await row.getByPlaceholder("Description").fill("Do the thing")
  await row.locator("textarea").fill("Do the thing, carefully.")
  const agentSelect = row.locator('[data-v110="work-start-run-agent"]')
  const firstAgentValue = await agentSelect.locator("option").nth(1).getAttribute("value")
  await agentSelect.selectOption(firstAgentValue ?? "")

  await expect(page.locator('[data-v110="work-start-run-submit"]')).toBeEnabled()
  await page.locator('[data-v110="work-start-run-submit"]').click()

  // Submit closes the dialog on success and the new run shows up as pending.
  await expect(page.locator('[data-v110="work-start-run-dialog"]')).not.toBeVisible()
  await expect(page.locator('[data-v110="work-runs-panel"]').getByText(/pending/i)).toBeVisible()
})
