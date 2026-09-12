/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { DESKTOP_VIEWPORT, MODES, expectSingleVisibleRail } from "./mode-test-helpers"

/**
 * C4c — contrat de sélection du rail de modes.
 *
 * `aria-label={props.modeLabel(mode)}` est localisé : la suite e2e tourne en
 * anglais et lit "work mode" là où l'application en français rend
 * "Mode Travail". Un test de performance ou de navigation qui s'appuie dessus
 * casse au premier changement de locale, et le repli par nom accessible
 * qu'utilise `mode-switch-latency.spec.ts` pour tourner contre la baseline
 * masquerait une disparition de l'attribut. D'où ce test dédié.
 *
 * Deux rails sont rendus (`sidebarContent()` desktop et `sidebarContent(true)`
 * mobile). L'unicité de `data-mode` est donc exigée **par rail**, jamais dans
 * le document.
 */
test.describe("C4c — contrat data-mode du rail de modes", () => {
  test.describe.configure({ timeout: 240_000 })

  test("chaque rail expose un data-mode valide et unique par bouton de mode", async ({ page, project }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await project.open()

    const rails = page.locator('[data-component="sidebar-rail"]')
    const railCount = await rails.count()
    expect(railCount, "le layout rend un rail desktop et un rail mobile").toBeGreaterThanOrEqual(1)

    const perRail: string[][] = []
    for (let index = 0; index < railCount; index += 1) {
      const rail = rails.nth(index)
      const modeNav = rail.locator("nav[aria-label]").first()
      const buttons = modeNav.locator("button")
      const count = await buttons.count()
      expect(count, `le rail #${index} doit exposer au moins un bouton de mode`).toBeGreaterThan(0)

      const values: string[] = []
      for (let button = 0; button < count; button += 1) {
        const value = await buttons.nth(button).getAttribute("data-mode")
        expect(value, `bouton #${button} du rail #${index} sans data-mode`).not.toBeNull()
        values.push(value as string)
      }

      // Valeurs valides…
      for (const value of values) expect(MODES).toContain(value)
      // …et uniques DANS CE RAIL. Pas dans le document : il y en a deux.
      expect(new Set(values).size, `data-mode dupliqué dans le rail #${index}`).toBe(values.length)

      perRail.push(values)
    }

    // Les deux rails doivent proposer le même jeu de modes : un mode joignable
    // sur desktop et absent sur mobile serait une divergence silencieuse.
    const reference = [...perRail[0]!].sort()
    for (let index = 1; index < perRail.length; index += 1) {
      expect([...perRail[index]!].sort(), `le rail #${index} n'expose pas les mêmes modes que le rail #0`).toEqual(
        reference,
      )
    }
  })

  test("un seul rail est visible au viewport desktop", async ({ page, project }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await project.open()

    // Invariant porté par `<div class="xl:hidden">` autour du bloc mobile
    // (`layout.tsx`). Le retirer rendrait deux rails cliquables et ferait
    // échouer tous les sélecteurs de mode en mode strict Playwright — d'où
    // cette assertion, qui fait échouer bruyamment plutôt que silencieusement.
    await expectSingleVisibleRail(page)

    const visibleModeButtons = page.locator('[data-component="sidebar-rail"]:visible nav[aria-label] button')
    const count = await visibleModeButtons.count()
    for (let index = 0; index < count; index += 1) {
      await expect(visibleModeButtons.nth(index)).toHaveAttribute("data-mode", /^(code|work|design|automate)$/)
      // L'accessibilité n'est pas sacrifiée au contrat de test : les deux
      // coexistent.
      await expect(visibleModeButtons.nth(index)).toHaveAttribute("aria-pressed", /^(true|false)$/)
    }
  })
})
