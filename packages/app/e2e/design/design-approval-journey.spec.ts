/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { readMockCalls } from "../fixtures/workbench-mock"
import { openDesignSurface, submitExport } from "./surface"
import { expectNoNewViolations } from "./axe"

// DA-UI-02 / DA-UI-03 — the expired approval, in a browser.
//
// The reducer and the four broker operations are covered by
// design-approval.test.ts with a fake client, and that is where the five
// defects were found. What no unit test can answer is whether the controls
// exist in the DOM the user is looking at: the modal shipped once with every
// button behind `!expired`, which is a full-screen overlay with no way out,
// and the reducer was blameless. So these tests press the buttons.
//
// The expiry is reached with Playwright's clock rather than by waiting five
// real minutes. `install` freezes time, `resume` lets the page boot normally,
// and `fastForward` jumps the deadline.

const FIXED_TIME = new Date("2025-01-01T00:00:00Z")

/** Comfortably past the five-minute TTL the surface schedules. */
const PAST_THE_DEADLINE = "05:01"

test.describe("Design approval — the expired modal, rendered", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.install({ time: FIXED_TIME })
    // The page has to boot on a clock that ticks: the bridge answers through
    // timers, and a frozen clock would leave the surface waiting forever.
    await page.clock.resume()
  })

  test("cancelling an expired approval withdraws it from the broker", async ({ page, directory }, testInfo) => {
    await openDesignSurface(page, directory, { exportOutcome: "approval-required" })
    await submitExport(page)

    const modal = page.locator("[data-design-approval-modal]")
    await expect(modal).toBeVisible()
    await expect(modal).toHaveAttribute("data-design-approval-expired", "false")
    await expect(page.locator('[data-design-approval-action="allow"]')).toBeVisible()

    await page.clock.fastForward(PAST_THE_DEADLINE)

    await expect(modal).toHaveAttribute("data-design-approval-expired", "true")
    await expect(page.locator("[data-design-approval-expired-warning]")).toBeVisible()
    // The defect this replaces: every control sat behind `!expired`, so the
    // expired state rendered an overlay with nothing to press.
    await expect(page.locator('[data-design-approval-action="allow"]')).toHaveCount(0)
    await expect(page.locator('[data-design-approval-action="deny"]')).toHaveCount(0)
    const cancel = page.locator('[data-design-approval-action="cancel"]')
    await expect(cancel).toBeVisible()
    await expect(page.locator('[data-design-approval-action="rerequest"]')).toBeVisible()

    // The expired modal is a dialog like any other: it still needs a name and
    // reachable controls, and it is the state most likely to have lost them.
    await expectNoNewViolations(page, testInfo, "expired approval modal", "[data-design-approval-modal]")

    await cancel.click()
    await expect(modal).toBeHidden()

    // Closing the modal is not the point. Leaving the broker holding a request
    // nobody will decide is the defect; only the recorded call can see that.
    const calls = await readMockCalls(page)
    expect(calls).toContainEqual({ method: "cancelApproval", args: ["apr-1"] })
  })

  test("re-requesting releases the stale approval before asking for a new one", async ({ page, directory }) => {
    await openDesignSurface(page, directory, { exportOutcome: "approval-required" })
    await submitExport(page)

    const modal = page.locator("[data-design-approval-modal]")
    await expect(modal).toBeVisible()
    await page.clock.fastForward(PAST_THE_DEADLINE)
    await expect(modal).toHaveAttribute("data-design-approval-expired", "true")

    await page.locator('[data-design-approval-action="rerequest"]').click()

    // A fresh approval, not the stale one: the mock hands out apr-1, apr-2, …
    await expect(page.locator("[data-design-approval-id]")).toHaveAttribute("data-design-approval-id", "apr-2")
    await expect(modal).toHaveAttribute("data-design-approval-expired", "false")

    // Order matters. Releasing the stale request *after* issuing the new one
    // would leave the two racing on the broker.
    const calls = await readMockCalls(page)
    expect(calls.map((call) => call.method)).toEqual([
      "createArtifact",
      "exportArtifact",
      "cancelApproval",
      "createArtifact",
      "exportArtifact",
    ])
    expect(calls[2]).toEqual({ method: "cancelApproval", args: ["apr-1"] })
  })

  test("leaving the surface does not strand a pending approval", async ({ page, directory }) => {
    await openDesignSurface(page, directory, { exportOutcome: "approval-required" })
    await submitExport(page)
    await expect(page.locator("[data-design-approval-modal]")).toBeVisible()

    // Navigating away aborts the local fetch, which tells the broker nothing.
    // Before DA-UI-02's fix the request sat pending until its TTL ran out,
    // invisible, and the next export raced it.
    await page.locator('button[data-mode="code"]').first().click()
    await expect(page.locator("[data-design-approval-modal]")).toHaveCount(0)

    await expect
      .poll(async () => (await readMockCalls(page)).some((call) => call.method === "cancelApproval"))
      .toBe(true)
  })
})
