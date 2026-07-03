import { test, expect } from "../fixtures"
import { closeDialog, openPalette } from "../actions"

// FORK (ADR-0005 Phase 6): the palette moved off upstream's mod+k — Quick
// Open is plain mod+p (VS Code convention) and the command palette is
// mod+shift+p. mod+k is intentionally unmapped.
test("command palette opens and closes", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openPalette(page, "Shift+P")

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("search palette also opens with cmd+p", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openPalette(page, "P")

  await closeDialog(page, dialog)
  await expect(dialog).toHaveCount(0)
})
