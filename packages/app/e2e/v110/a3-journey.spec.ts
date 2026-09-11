/* SPDX-License-Identifier: MIT */

// A3-05 Jalon 1 exit gate: the full Chat journey in one real, sequential
// flow (per Plan-Portage-Complet-UI-v110's porte de sortie) — create
// session -> prompt -> response -> tool/event visible -> retry -> mode
// change -> conversation retained -> stop. Real backend throughout (the
// LLM is a local deterministic test server the app talks to over real
// HTTP, same fixture every other session e2e test uses — never a
// UI-behavior mock).
//
// Stop is verified last and in isolation, not folded into a
// stop-then-retry-in-the-same-session flow: while building this, queuing
// a real hang() reply, clicking Stop, then sending a follow-up prompt in
// the same session left the composer stuck on "Thinking..." forever, even
// though the Stop button itself correctly flipped back to "Send" —
// evidence the client's own "is this session busy" state can go stale
// before the backend's cancellation of a genuinely-hanging upstream
// stream actually completes. Filed as #77 rather than worked around here;
// no prior e2e test exercised stop-mid-generation via the composer at
// all before this one, so nothing regresses — this is a new, real gap
// this test surfaced. Retry (continuing the conversation with a second
// prompt) is verified earlier, on a session that never touches hang().

import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { assistantText } from "../actions"
import { goto } from "./gate"
import type { E2EWindow } from "../../src/testing/terminal"

async function waitReady(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const current = (window as E2EWindow).__opencode_e2e?.model?.current
        return !!(current?.agent && current.model)
      }),
    )
    .toBe(true)
}

test("full session journey: create, prompt, tool call, retry, mode change, conversation retained, stop", async ({
  page,
  project,
  llm,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const marker = `journey-${Date.now()}`
  const prompt = page.locator(promptSelector).first()

  // ── 1-3: create session, prompt, real response with a visible tool call ──
  await project.open()
  await llm.tool("bash", { command: `echo ${marker}`, description: "print the marker" })
  await llm.text(`Printed ${marker}.`)
  const sessionID = await project.prompt(`Run a shell command that echoes ${marker}, then confirm.`)

  await expect
    .poll(() => assistantText(project.sdk, sessionID), { timeout: 60_000 })
    .toContain(`Printed ${marker}`)
  await expect(page.locator('[data-component="tool-part-wrapper"]').first()).toBeVisible({ timeout: 30_000 })

  // ── 4: retry — continue the conversation with a second real prompt ─────
  await llm.text(`Retry acknowledged for ${marker}.`)
  await waitReady(page)
  await prompt.click()
  await page.keyboard.type(`Retry: confirm ${marker} again.`)
  await page.keyboard.press("Enter")
  await expect
    .poll(() => assistantText(project.sdk, sessionID), { timeout: 60_000 })
    .toContain(`Retry acknowledged for ${marker}`)

  // ── 5: mode change and back — conversation retained ─────────────────────
  await goto(page, "work")
  await goto(page, "design")
  await goto(page, "code")

  await expect(page.locator(promptSelector).first()).toBeVisible()
  const history = await assistantText(project.sdk, sessionID)
  expect(history, "conversation must survive the mode round-trip").toContain(`Printed ${marker}`)
  expect(history, "conversation must survive the mode round-trip").toContain(`Retry acknowledged for ${marker}`)

  // ── 6: stop mid-generation, verified last and in isolation (see header) ─
  await llm.hang()
  await waitReady(page)
  await prompt.click()
  await page.keyboard.type("This one should hang and get stopped.")
  await page.keyboard.press("Enter")

  const stopButton = page.locator('[data-action="prompt-submit"]')
  await expect(stopButton, "send button must switch to Stop while generating").toHaveAttribute(
    "aria-label",
    /stop/i,
    { timeout: 30_000 },
  )
  await stopButton.click()
  await expect(stopButton, "must return to Send once stopped").toHaveAttribute("aria-label", /send/i, {
    timeout: 15_000,
  })
})
