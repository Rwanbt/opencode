/* SPDX-License-Identifier: MIT */

// A4-01: data-v110 markers on the real Code chrome (file tab bar, editor
// content, terminal panel) so future A4/A8 checks can target them without
// re-deriving selectors. No behavior change — same components file-tree.spec.ts
// already exercises, just anchored with stable markers.
//
// Deliberately does not open the terminal: ghostty-web PTY startup is a known
// CI-latency source (tracked via PLAYWRIGHT_SKIP_TERMINAL, see #71's
// diagnosis) — checking the panel is attached (it always mounts, just
// aria-hidden when closed) proves the marker exists without paying that cost.

import { test, expect } from "../fixtures"

test("code chrome markers: file tab bar, editor content, terminal panel", async ({ page, gotoSession }) => {
  await gotoSession()

  const toggle = page.getByRole("button", { name: "Toggle file tree" })
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  const panel = page.locator('[data-v110="inspector-content"]')
  const treeTabs = panel.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')
  const allTab = treeTabs.getByRole("tab", { name: /^all files$/i })
  await allTab.click()

  const tree = treeTabs.locator('[data-slot="tabs-content"]:not([hidden])')
  const expand = async (name: string) => {
    const folder = tree.getByRole("button", { name, exact: true }).first()
    await expect(folder).toBeVisible()
    if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click()
    await expect(folder).toHaveAttribute("aria-expanded", "true")
  }
  await expand("packages")
  await expand("app")
  await expand("src")
  await expand("components")

  const file = tree.getByRole("button", { name: "file-tree.tsx", exact: true }).first()
  await expect(file).toBeVisible()
  await file.click()

  await page.getByRole("tab", { name: "Inspector", exact: true }).click()

  await expect(page.locator('[data-v110="code-tabs"]')).toBeVisible()
  await expect(page.locator('[data-v110="code-editor"]')).toBeVisible()

  // Always mounted (height:0 + aria-hidden when closed), not conditionally
  // rendered — attached is the correct assertion, not visible.
  await expect(page.locator('[data-v110="code-terminal"]')).toBeAttached()
})
