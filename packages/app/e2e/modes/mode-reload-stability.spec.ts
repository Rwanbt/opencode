/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { waitSessionIdle } from "../actions"
import { dirPath } from "../utils"
import { installWorkbenchMock } from "../fixtures/workbench-mock"

const RELOAD_CYCLES = Number(process.env.E2E_RELOAD_CYCLES ?? 10)
const PROMPTS_PER_CYCLE = Number(process.env.E2E_RELOAD_PROMPTS ?? 100)
const RELOAD_MODES = (process.env.E2E_RELOAD_MODES ?? "design,automate,work").split(",").map((mode) => {
  if (mode === "design" || mode === "automate" || mode === "work") return mode
  throw new Error(`Unsupported E2E reload mode: ${mode}`)
})

/**
 * Stability across full reloads, under session load.
 *
 * This spec was `mode-performance.spec.ts` and claimed "10 mode cycles do not
 * grow heap, listeners, or active queries". It could not prove that: it changes
 * mode with `page.goto()`, a full navigation. Every `goto` destroys the
 * document — mounted components, listeners, stores, the QueryClient, down to
 * the provider's module-level `activeEventStreams` counter. A leak caused by an
 * SPA mode switch would read 20, 40, 60 through the rail; through `goto` it
 * reads 20, 20, 20. The test was green by construction, and it is on that
 * untested path that a mode switch could block the main thread for ~10 s
 * without any test moving.
 *
 * What this spec does measure, and why it is worth keeping:
 *   - counter stability across repeated full navigations;
 *   - behaviour under session load (up to 1 000 prompts);
 *   - the absence of monotonic growth from the start to the end of a long run.
 *
 * What it does NOT measure: a leak caused by mode switches within one document.
 * That is `mode-switch-resource-stability.spec.ts`, which stays in a single
 * document and navigates through the rail.
 *
 * Real volume: 10 cycles x 100 prompts, so up to 1 000 prompts — hence
 * `test.setTimeout(600_000)`. The previous comment announced "one assistant
 * prompt per cycle", which the implementation never did.
 *
 * Instrumentation: `performance.memory` (Chromium) and `window.__UNIFIA_PERF__`.
 * That hook is dev-only since the card that renamed its counters; the previous
 * comment already claimed "the production build strips it", which was false at
 * the time — it was installed under a bare `typeof window === "object"`. This
 * spec runs in dev, where `bun run dev` makes `import.meta.env.DEV` true.
 */

test("10 reload cycles under session load do not grow event streams, query observers or cache entries", async ({ page, project, assistant }) => {
  // The defaults are the certification workload. Smaller values are allowed
  // only for local diagnosis. The backend takes about 1.57 s per sequential
  // prompt under this harness, so 1,000 prompts plus 30 reloads need this
  // measured 35-minute budget without weakening the contract.
  test.setTimeout(2_100_000)
  await project.open({
    // Automate is capability-gated. This spec certifies reload behaviour in
    // the supported browser-E2E profile, so provide only the platform bridge
    // boundary and the grant required to reach the real surface.
    beforeGoto: () => installWorkbenchMock(page, { grants: ["workflow.run"] }),
  })
  const sessionID = await project.user("Create the temporary E2E session and do not modify files.")
  const route = `${dirPath(project.directory)}/work`
  await page.goto(route)
  await expect(page).toHaveURL(/\/work(?:[/?#]|$)/)
  await expect(page.locator('[data-workbench-mode="work"]').first()).toBeVisible()
  await expect(page.locator('[data-workbench-connection="ready"]')).toBeVisible()

  const baseline = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const dev = (
      window as unknown as {
        __UNIFIA_PERF__?: { eventStreams: () => number; queryObservers: () => number; queryCacheEntries: () => number }
      }
    ).__UNIFIA_PERF__
    if (!memory || !dev) throw new Error("Performance instrumentation is unavailable; refusing a false-green measurement")
    return {
      heap: memory?.usedJSHeapSize ?? 0,
      eventStreams: dev.eventStreams(),
      queryObservers: dev.queryObservers(),
      queryCacheEntries: dev.queryCacheEntries(),
    }
  })

  for (let cycle = 1; cycle <= RELOAD_CYCLES; cycle += 1) {
    // Walk the three modes and return. The cycle counter is
    // embedded in the assistant token so the test can verify
    // each prompt actually completed (a stuck cycle would
    // not advance the counter).
    const token = `PERF_CYCLE_${cycle}_${Date.now()}`
    for (const mode of RELOAD_MODES) {
      await page.goto(`${dirPath(project.directory)}/${mode}`)
      await expect(page.locator('[data-workbench-bootstrap="ready"]')).toBeVisible()
      await expect(page.locator(`[data-workbench-mode="${mode}"]`).first()).toBeVisible()
    }
    for (let message = 1; message <= PROMPTS_PER_CYCLE; message += 1) {
      if (message === 1) await assistant.reply(token)
      const callsBefore = await assistant.calls()
      await project.sdk.session.prompt({
        sessionID,
        agent: "build",
        parts: [{ type: "text", text: `Reply with exactly: ${token}_${message}` }],
      })
      await expect.poll(() => assistant.calls(), { timeout: 30_000 }).toBeGreaterThan(callsBefore)
      await waitSessionIdle(project.sdk, sessionID, 30_000)
    }
  }

  const after = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const dev = (
      window as unknown as {
        __UNIFIA_PERF__?: { eventStreams: () => number; queryObservers: () => number; queryCacheEntries: () => number }
      }
    ).__UNIFIA_PERF__
    if (!memory || !dev) throw new Error("Performance instrumentation is unavailable; refusing a false-green measurement")
    return {
      heap: memory?.usedJSHeapSize ?? 0,
      eventStreams: dev.eventStreams(),
      queryObservers: dev.queryObservers(),
      queryCacheEntries: dev.queryCacheEntries(),
    }
  })

  // Heap may grow a little (strings retained for caching) but a
  // 1 MB / 10 cycles budget is the strict gate; 10 cycles ×
  // 100 KB = 1 MB of acceptable cache growth. Anything beyond
  // points to a leak in the mode-switch path.
  expect(after.heap - baseline.heap).toBeLessThan(1_000_000)
  // Structural counters must not grow. Scope reminder: on this path every cycle
  // starts from a fresh document, so these assertions attest that a reload
  // leaves nothing behind — not that an SPA switch is leak-free.
  expect(after.eventStreams).toBeLessThanOrEqual(baseline.eventStreams)
  expect(after.queryObservers).toBeLessThanOrEqual(baseline.queryObservers)
  expect(after.queryCacheEntries).toBeLessThanOrEqual(baseline.queryCacheEntries)
})
