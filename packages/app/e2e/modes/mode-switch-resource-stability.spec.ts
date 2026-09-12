/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import {
  DESKTOP_VIEWPORT,
  availableModes,
  expectSingleVisibleRail,
  measureModeSwitch,
  readPerf,
  waitForPerfPlateau,
  type ModeName,
  type PerfSnapshot,
} from "./mode-test-helpers"

/**
 * C4b2 — stabilité des ressources sur les bascules de mode SPA.
 *
 * C'est le test que `mode-reload-stability.spec.ts` prétendait être. Celui-ci
 * change de mode par `page.goto()`, donc chaque cycle repart d'un document neuf
 * et les compteurs retombent à zéro : une fuite provoquée par une bascule était
 * effacée avant d'être mesurée. Ici, un seul document, aucune navigation
 * complète après l'ouverture, aucun LLM — uniquement des clics sur le rail,
 * c'est-à-dire le chemin de l'utilisateur.
 *
 * L'invariant qui fait exister ce fichier : **aucun `page.goto` ni `reload`
 * dans la boucle de cycles.** Un relecteur peut le vérifier par un grep.
 *
 * Classe B : rien ne fuit aujourd'hui, il n'y a donc pas de rouge historique à
 * produire. Ce qui doit être prouvé, c'est que l'oracle bouge quand le
 * phénomène se produit — et c'est fait ailleurs, dans
 * `perf-instrumentation.test.ts` : un `QueryObserver` abonné fait monter
 * `queryObservers`, son désabonnement le fait redescendre, et
 * `queryCacheEntries` ne bouge pas. Fabriquer ici une fuite artificielle en
 * retirant un `onCleanup` de production n'apporterait rien de plus.
 */

/** Nombre de cycles complets Code → … → Code effectués dans un seul document. */
const CYCLES = 20

/**
 * Tolérance heap. Le GC n'est pas déterministe et `performance.memory` est
 * spécifique à Chromium : le heap est un indicateur, jamais un gate. Cette
 * borne ne sert qu'à repérer une explosion, pas une variation normale.
 */
const HEAP_EXPLOSION_BYTES = 200 * 1024 * 1024

function formatSnapshot(snapshot: PerfSnapshot): string {
  const heap = snapshot.heap === null ? "unavailable" : `${Math.round(snapshot.heap / 1024 / 1024)} Mo`
  return `eventStreams=${snapshot.eventStreams} queryObservers=${snapshot.queryObservers} queryCacheEntries=${snapshot.queryCacheEntries} heap=${heap}`
}

test.describe("C4b2 — stabilité des ressources sur bascules SPA", () => {
  test.describe.configure({ timeout: 600_000 })

  test("N cycles de rail dans un seul document ne font croître aucun compteur", async ({ page, project }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)

    // Le pont Workbench est absent en runtime Vite : sans le mock, la connexion
    // reste en état terminal `unsupported`, `eventStreams` resterait à zéro et
    // n'attesterait rien du cycle de vie du provider. `beforeGoto` est le seam
    // que la fixture expose déjà pour injecter un init script avant le boot de
    // l'application ; ne pas réinventer l'ordre d'injection ici.
    await project.open({ beforeGoto: () => installWorkbenchMock(page) })
    await expectSingleVisibleRail(page)

    const modes = await availableModes(page)
    const walk = modes.filter((mode) => mode !== "code")
    expect(walk.length, "le rail doit exposer au moins Work et Design").toBeGreaterThanOrEqual(2)

    // PRÉCONDITION — ne jamais modifier le contenu de l'éditeur de spec Design,
    // ni pendant la chauffe ni pendant les cycles. La clé de query
    // `workbenchQueryKey(current, "spec-validation", { source: value })` embarque
    // le contenu COMPLET de la spec : chaque contenu distinct crée une entrée de
    // cache légitime, avec un gcTime de 30 minutes. Une frappe ajoutée au
    // scénario ferait échouer l'égalité stricte de `queryCacheEntries` sans la
    // moindre fuite. Toutes les autres clés Workbench sont stables au fil des
    // bascules : la connexion est au scope répertoire, donc `serverOrigin`,
    // `instanceId` et `workspaceId` ne changent pas.

    // Chauffe : monter chaque surface une fois et revenir sur Code, pour que le
    // cache ait vu toutes les familles de query légitimes et que la baseline
    // soit prise sur une topologie normale, pas sur un cache vide.
    for (const mode of walk) await measureModeSwitch(page, mode, 30_000)
    await measureModeSwitch(page, "code")

    const baseline = await waitForPerfPlateau(page)
    console.log(`[ressources] baseline après chauffe : ${formatSnapshot(baseline)}`)

    const perCycle: PerfSnapshot[] = []
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      for (const mode of walk) await measureModeSwitch(page, mode)
      await measureModeSwitch(page, "code")
      const snapshot = await waitForPerfPlateau(page)
      perCycle.push(snapshot)
    }

    const final = perCycle[perCycle.length - 1]!
    console.log(`[ressources] après ${CYCLES} cycles : ${formatSnapshot(final)}`)

    // Distinguer un plateau d'une croissance monotone demande la trace complète,
    // pas seulement les deux extrémités : un compteur qui monte puis redescend
    // n'est pas une fuite, un compteur qui monte de 1 par cycle en est une.
    const observerTrace = perCycle.map((snapshot) => snapshot.queryObservers)
    console.log(`[ressources] trace queryObservers : ${observerTrace.join(", ")}`)

    expect(final.eventStreams, `flux Workbench : ${observerTrace.length} cycles`).toBe(baseline.eventStreams)
    expect(final.queryObservers, "un observer TanStack non désabonné est une fuite").toBe(baseline.queryObservers)
    expect(final.queryCacheEntries, "entrées de cache inattendues — identifier la query key avant d'assouplir").toBe(
      baseline.queryCacheEntries,
    )

    // Heap : indicatif. Absent hors Chromium, et jamais un gate — reproduire le
    // `throw` de l'ancien spec transformerait un signal secondaire en gate dur.
    if (baseline.heap !== null && final.heap !== null) {
      const delta = final.heap - baseline.heap
      console.log(`[ressources] delta heap : ${Math.round(delta / 1024 / 1024)} Mo`)
      expect(delta, "croissance de heap hors de toute proportion").toBeLessThan(HEAP_EXPLOSION_BYTES)
    } else {
      console.log("[ressources] heap : indisponible sur ce navigateur, non asserté")
    }
  })

  test("les compteurs sont lisibles et le mock fournit un flux Workbench actif", async ({ page, project }) => {
    // Garde-fou de la mesure elle-même : si `__UNIFIA_PERF__` disparaissait ou
    // si le mock cessait d'ouvrir un flux, le test principal deviendrait vert
    // en n'observant rien. `readPerf` jette déjà sur l'absence du hook ; cette
    // assertion couvre le second cas.
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await project.open({ beforeGoto: () => installWorkbenchMock(page) })

    const modes = await availableModes(page)
    const first = modes.find((mode): mode is ModeName => mode !== "code")
    expect(first, "aucun mode Workbench disponible").toBeDefined()
    await measureModeSwitch(page, first as ModeName, 30_000)

    const snapshot = await waitForPerfPlateau(page)
    expect(snapshot.eventStreams, "le mock doit maintenir un flux d'événements ouvert").toBeGreaterThan(0)
  })
})
