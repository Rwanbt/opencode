/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import { createPerfInstrumentation } from "@/utils/perf-instrumentation"

/**
 * C4d — preuve de **sensibilité** des compteurs, pas de correction d'une fuite.
 *
 * C'est une carte de Classe B : rien ne fuit aujourd'hui, donc il n'y a pas de
 * rouge historique à produire. Ce qu'il faut prouver, c'est que l'oracle bouge
 * quand le phénomène qu'il prétend mesurer se produit — sinon
 * `mode-switch-resource-stability.spec.ts` resterait vert par construction,
 * exactement le défaut qu'il est censé remplacer.
 *
 * Le point qui compte : `queryObservers` et `queryCacheEntries` mesurent deux
 * choses différentes. Un observer qui se désabonne fait redescendre le premier
 * et **pas** le second — le cache garde son entrée pendant tout le `gcTime`.
 * C'est pourquoi l'ancien compteur, nommé `queries` mais comptant des entrées
 * de cache, ne pouvait pas détecter une fuite d'abonnement.
 */
describe("C4d — sensibilité de l'instrumentation de performance", () => {
  function setup() {
    const client = new QueryClient()
    let streams = 0
    const perf = createPerfInstrumentation({ client, eventStreams: () => streams })
    return { client, perf, setStreams: (value: number) => { streams = value } }
  }

  test("queryCacheEntries suit la création d'une entrée de cache", async () => {
    const { client, perf } = setup()
    const before = perf.queryCacheEntries()
    await client.fetchQuery({ queryKey: ["perf", "entry"], queryFn: async () => "ok" })
    expect(perf.queryCacheEntries()).toBe(before + 1)
  })

  test("queryObservers monte à l'abonnement et redescend au désabonnement", () => {
    const { client, perf } = setup()
    const baseline = perf.queryObservers()

    const observer = new QueryObserver(client, { queryKey: ["perf", "observed"], queryFn: async () => "ok" })
    const unsubscribe = observer.subscribe(() => {})
    expect(perf.queryObservers()).toBe(baseline + 1)

    unsubscribe()
    expect(perf.queryObservers()).toBe(baseline)
  })

  test("un désabonnement ne fait pas redescendre queryCacheEntries", () => {
    // La distinction qui rendait l'ancien compteur `queries` inopérant pour
    // détecter une fuite d'abonnement.
    const { client, perf } = setup()
    const observer = new QueryObserver(client, { queryKey: ["perf", "kept"], queryFn: async () => "ok" })
    const unsubscribe = observer.subscribe(() => {})
    const entriesWhileSubscribed = perf.queryCacheEntries()

    unsubscribe()
    expect(perf.queryObservers()).toBe(0)
    expect(perf.queryCacheEntries()).toBe(entriesWhileSubscribed)
  })

  test("plusieurs observers sur la même clé sont comptés séparément", () => {
    const { client, perf } = setup()
    const baseline = perf.queryObservers()
    const options = { queryKey: ["perf", "shared"], queryFn: async () => "ok" }

    const first = new QueryObserver(client, options).subscribe(() => {})
    const second = new QueryObserver(client, options).subscribe(() => {})
    expect(perf.queryObservers()).toBe(baseline + 2)
    // Une seule entrée de cache pour deux observers : les deux compteurs ne
    // sont pas redondants.
    expect(perf.queryCacheEntries()).toBe(1)

    first()
    second()
    expect(perf.queryObservers()).toBe(baseline)
  })

  test("eventStreams délègue au compteur Workbench, sans le renommer", () => {
    const { perf, setStreams } = setup()
    expect(perf.eventStreams()).toBe(0)
    setStreams(3)
    expect(perf.eventStreams()).toBe(3)
  })
})
