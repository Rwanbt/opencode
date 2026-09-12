/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { assistantText, waitSessionIdle } from "../actions"
import { dirPath } from "../utils"

test("each workspace mode accepts a prompt on the active session", async ({ page, project, assistant }) => {
  test.setTimeout(120_000)

  await project.open()
  const sessionID = await project.user("Create the temporary E2E session and do not modify files.")
  // ADR-1041 supersedes ADR-1033: Automate is reachable from the rail whenever
  // `workflow.run` is granted, and always in a dev build. This test covers
  // Code/Work/Design by choice of scope, not because Automate is unavailable.
  const modes = ["code", "work", "design"] as const

  for (const mode of modes) {
    const token = `MODE_${mode.toUpperCase()}_${Date.now()}`
    await assistant.reply(token)
    const route = mode === "code" ? `${dirPath(project.directory)}/session/${sessionID}` : `${dirPath(project.directory)}/${mode}`
    await page.goto(route)
    await expect(page).toHaveURL(mode === "code" ? new RegExp(`/session/${sessionID}(?:[/?#]|$)`) : new RegExp(`/${mode}(?:[/?#]|$)`))
    await expect(page.locator(`[data-workbench-mode="${mode}"]`).first()).toBeVisible()

    const callsBefore = await assistant.calls()
    await project.sdk.session.prompt({
      sessionID,
      agent: "build",
      parts: [{ type: "text", text: `Reply with exactly: ${token}` }],
    })

    await expect.poll(() => assistant.calls(), { timeout: 30_000 }).toBeGreaterThan(callsBefore)
    await waitSessionIdle(project.sdk, sessionID, 30_000)
    await expect.poll(() => assistantText(project.sdk, sessionID), { timeout: 30_000 }).toContain(token)
  }
})
