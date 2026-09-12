/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import {
  DESKTOP_VIEWPORT,
  availableModes,
  expectSingleVisibleRail,
  measureModeSwitch,
  type ModeName,
} from "./mode-test-helpers"

/**
 * C4a — régression de latence de bascule de mode, par le rail SPA.
 *
 * Ce spec existe parce qu'aucun test ne chronométrait le chemin utilisateur.
 * `mode-navigation.spec.ts` clique bien le rail mais n'assert que la route et
 * la surface ; `mode-performance.spec.ts` mesure des compteurs mais change de
 * mode par `page.goto()`, donc une navigation complète. Entre les deux, une
 * bascule pouvait bloquer le thread principal ~10 s dans une seule long task
 * sans qu'aucun test ne bouge (mesuré 2026-08-28 : 10 162 ms Code → Work,
 * 0 requête réseau, 3 237 écritures localStorage identiques).
 *
 * Budgets — deux seuils, parce qu'ils ne servent pas à la même chose :
 * la cible UX est un objectif produit local, le gate CI doit séparer le bruit
 * d'un runner chargé d'une vraie régression. La panne historique était à
 * 10 000 ms et plus, soit 20× le gate dur.
 */

/** Gate CI. La cible UX locale est de 150 ms ; elle n'est pas assertée ici. */
const HOT_SWITCH_BUDGET_MS = 500

/**
 * Première interaction vers un mode dont la surface est un chunk lazy.
 *
 * WHY 6 s et non les 2 s annoncées au plan : ce budget est **dominé par le
 * serveur de développement**, pas par l'application. Playwright démarre un Vite
 * neuf, donc le graphe de `design-surface` (183 modules locaux, ~2,9 Mo de
 * sources) est transformé à la demande au premier clic. Mesuré ici : 3 018 ms.
 * Les 111–407 ms qui avaient servi à fixer 2 s venaient d'un Vite dont le
 * graphe était déjà chaud — une erreur de provenance de la mesure, corrigée.
 *
 * En build de production ce coût n'existe pas : le chunk est émis, pas
 * transformé. Ce gate ne sert donc qu'à détecter une explosion, pas à mesurer
 * l'application. Les tests qui mesurent vraiment l'app sont T-LAT-1 et T-LAT-3.
 */
const FIRST_LAZY_BUDGET_MS = 6_000

/** Objectif produit, reporté dans les logs sans faire échouer la CI. */
const UX_TARGET_MS = 150

function report(label: string, ms: number): void {
  const verdict = ms <= UX_TARGET_MS ? "cible UX tenue" : `au-dessus de la cible UX de ${UX_TARGET_MS} ms`
  console.log(`[latence] ${label}: ${ms} ms (${verdict})`)
}

test.describe("C4a — latence de bascule de mode par le rail", () => {
  // Le démarrage du fixture worker `backend` (serveur Unifia + migration SQLite
  // + LLM factice) est imputé au timeout du premier test. Sur une machine
  // chargée il dépasse les 60 s par défaut et le spec échoue en « setting up
  // backend » — un échec d'environnement qui n'a rien à voir avec le budget
  // mesuré. On laisse de la marge pour que le seul rouge possible soit
  // temporel et attribuable à l'application.
  test.describe.configure({ timeout: 240_000 })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
  })

  // T-LAT-1 — le test que C2.5 exécute contre la baseline. Work est un import
  // statique : pas de chunk lazy, donc la mesure isole le coût de la bascule
  // elle-même. C'est celui qui doit passer au rouge sur `5a9be17e`.
  test("T-LAT-1 première interaction Code → Work", async ({ page, project }) => {
    await project.open()
    await expectSingleVisibleRail(page)

    const ms = await measureModeSwitch(page, "work")
    report("Code → Work (première interaction)", ms)
    expect(ms, `Code → Work a pris ${ms} ms`).toBeLessThanOrEqual(HOT_SWITCH_BUDGET_MS)
  })

  // T-LAT-2 — Design est chargé par `lazy()`. Le preload produit déclenché par
  // `mouseenter`/`focus` fait partie du chemin mesuré : c'est l'expérience
  // réelle, pas un chargement synthétiquement froid. D'où un budget distinct,
  // et un nom qui ne parle pas de « cold chunk ».
  test("T-LAT-2 première interaction Code → Design", async ({ page, project }) => {
    await project.open()
    await expectSingleVisibleRail(page)

    const ms = await measureModeSwitch(page, "design")
    report("Code → Design (première interaction)", ms)
    expect(ms, `Code → Design a pris ${ms} ms`).toBeLessThanOrEqual(FIRST_LAZY_BUDGET_MS)
  })

  // T-LAT-3 — le régime nominal : tout est chargé, chaque bascule ne doit plus
  // être qu'un changement de projection.
  test("T-LAT-3 bascules chaudes sur plusieurs cycles", async ({ page, project }) => {
    await project.open()
    await expectSingleVisibleRail(page)

    const modes = await availableModes(page)
    expect(modes, "le rail doit exposer au moins Code, Work et Design").toEqual(
      expect.arrayContaining<ModeName>(["code", "work", "design"]),
    )
    const walk = modes.filter((mode) => mode !== "code")

    // Chauffe : chaque surface est montée une fois, puis retour sur Code.
    for (const mode of walk) await measureModeSwitch(page, mode, 30_000)
    await measureModeSwitch(page, "code")

    const timings: Array<{ mode: ModeName; ms: number }> = []
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      for (const mode of walk) {
        timings.push({ mode, ms: await measureModeSwitch(page, mode) })
      }
      timings.push({ mode: "code", ms: await measureModeSwitch(page, "code") })
    }

    for (const { mode, ms } of timings) {
      report(`bascule chaude → ${mode}`, ms)
      expect(ms, `la bascule vers ${mode} a pris ${ms} ms`).toBeLessThanOrEqual(HOT_SWITCH_BUDGET_MS)
    }
  })
})
