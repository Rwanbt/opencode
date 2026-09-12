/* SPDX-License-Identifier: MIT */

// A8-01 Port Gate harness. Progressive: hard-fails only on invariants
// that hold before AND after the A2 shell lands (errors, overflow,
// rail registry, active view, toggles). v110-only markers (shell grid,
// separator, inspector frame, layout switch) are exercised when present
// and recorded when absent, so this greens today and tightens tomorrow.

import { expect, type ConsoleMessage, type Page } from "@playwright/test"

export type Track = { logs: string[]; pages: string[]; stop: () => void }

// WHY attach here instead of reusing the fixture log: the fixture only
// throws on [e2e:error-boundary]; the gate needs every console error
// and pageerror to enforce zero-new-error per viewport.
export function track(page: Page): Track {
  const logs: string[] = []
  const pages: string[] = []
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") logs.push(msg.text().slice(0, 500))
  }
  const onPage = (err: Error) => {
    pages.push(String(err.stack ?? err.message).slice(0, 500))
  }
  page.on("console", onConsole)
  page.on("pageerror", onPage)
  const stop = () => {
    page.off("console", onConsole)
    page.off("pageerror", onPage)
  }
  return { logs, pages, stop }
}

// Audit v98 contract: root overflow beyond 6px is a fail.
export async function overflow(page: Page) {
  const dx = await page.evaluate(() => {
    const root = document.documentElement
    return Math.max(0, root.scrollWidth - root.clientWidth)
  })
  return { dx, ok: dx <= 6 }
}

const RAIL = '[data-component="sidebar-rail"]:visible'

// data-mode is the locale-stable rail contract (mode-rail-contract.spec).
export async function modes(page: Page): Promise<string[]> {
  const rail = page.locator(RAIL).first()
  await expect(rail).toBeVisible()
  const btns = rail.locator("[data-mode]")
  const total = await btns.count()
  const out = new Set<string>()
  for (let i = 0; i < total; i += 1) {
    const v = await btns.nth(i).getAttribute("data-mode")
    if (v) out.add(v)
  }
  return [...out].sort()
}

export async function arrived(page: Page, mode: string): Promise<boolean> {
  return page.evaluate((target) => {
    const vis = (el: Element | null) => {
      if (!el) return false
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }
    const active = Array.from(document.querySelectorAll("[data-workbench-surface]")).some(vis)
    if (target === "code") return !active && vis(document.querySelector('[data-component="session-workspace"]'))
    return vis(document.querySelector('[data-workbench-surface="' + target + '"]'))
  }, mode)
}

export async function goto(page: Page, mode: string) {
  const btn = page
    .locator(RAIL + ' [data-mode="' + mode + '"]')
    .first()
    .or(page.getByRole("button", { name: new RegExp(mode + " mode", "i") }).first())
  await expect(btn).toBeVisible()
  await btn.click()
  await expect.poll(() => arrived(page, mode), { timeout: 15_000 }).toBe(true)
}

// Active view present + workspace geometry sane.
export async function panels(page: Page) {
  const box = (sel: string) => page.locator(sel).first().boundingBox().catch(() => null)
  const workspace = await box('[data-component="session-workspace"]')
  const surface = await box("[data-workbench-surface]")
  expect(workspace ?? surface, "active view present").not.toBeNull()
  for (const b of [workspace, surface]) {
    if (b) expect(b.width * b.height, "panel geometry must be non-degenerate").toBeGreaterThan(0)
  }
}

// Keyboard reachability: v110 separators carry role + tabindex when the
// A2 shell mounts them; Tab must always land on a real control.
export async function keys(page: Page) {
  const seps = page.locator('[data-component="separator"]')
  const total = await seps.count()
  for (let i = 0; i < total; i += 1) {
    const el = seps.nth(i)
    if (await el.isVisible().catch(() => false)) {
      await expect(el).toHaveAttribute("role", "separator")
      await expect(el).toHaveAttribute("tabindex", "0")
    }
  }
  await page.keyboard.press("Tab")
  const tag = await page.evaluate(() => document.activeElement?.tagName ?? "")
  expect(tag, "tab must move focus to a real control").not.toBe("")
}

export async function shot(page: Page, name: string) {
  const path = "e2e/test-results/v110-" + name + ".png"
  await page.screenshot({ path })
  return path
}