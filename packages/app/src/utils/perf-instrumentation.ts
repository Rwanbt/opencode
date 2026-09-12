/* SPDX-License-Identifier: MIT */

import type { QueryClient } from "@tanstack/solid-query"

/**
 * C4d — instrumentation de performance exposée aux tests, nommée honnêtement.
 *
 * Avant cette carte l'application exposait :
 *
 *   listeners: getWorkbenchListenerCount   // ne compte PAS des listeners DOM
 *   queries:   () => cache.getAll().length // ne compte PAS des queries actives
 *
 * `listeners` comptait les flux d'événements Workbench actifs, et `queries` les
 * entrées présentes dans le cache TanStack. Deux noms qui promettent plus large
 * que ce qu'ils mesurent, donc deux faux diagnostics possibles : un test de
 * fuite qui reste vert parce qu'il observe le cache là où il croit observer des
 * observers, et une enquête qui cherche des listeners DOM qui n'ont jamais été
 * comptés.
 *
 * Les trois compteurs sont maintenant nommés d'après ce qu'ils comptent :
 *
 *   eventStreams      flux SSE Workbench actifs (compteur module du provider)
 *   queryObservers    somme des observers actifs, tous caches confondus
 *   queryCacheEntries entrées présentes dans le QueryCache
 *
 * `queryObservers` est le signal d'une fuite d'abonnement : un `onCleanup`
 * manquant sur le chemin de bascule laisse un observer abonné, et ce compteur
 * ne redescend pas. `queryCacheEntries` ne le dit pas : le cache conserve
 * légitimement ses entrées pendant tout le `gcTime`.
 *
 * L'objet n'est installé qu'en développement (voir `installPerfInstrumentation`).
 * Ce module n'a aucun effet de bord au chargement, de sorte qu'un build de
 * production l'élimine entièrement.
 */

/**
 * Chaîne sentinelle unique. Sa seule raison d'être est la preuve de
 * `dead code elimination` : un `grep` de cette chaîne dans les assets de
 * production doit ne rien trouver. Chercher `__UNIFIA_PERF__` seul ne suffirait
 * pas — un minifier peut renommer une propriété tout en conservant le code.
 */
export const PERF_SENTINEL = "unifia-perf-instrumentation-dev-only-8f3ac1"

export type PerfInstrumentation = {
  /** Flux d'événements Workbench actifs. Jamais appelé « listeners ». */
  eventStreams: () => number
  /** Somme des observers TanStack actifs sur toutes les entrées du cache. */
  queryObservers: () => number
  /** Entrées présentes dans le QueryCache, actives ou non. */
  queryCacheEntries: () => number
}

declare global {
  interface Window {
    __UNIFIA_PERF__?: PerfInstrumentation
  }
}

export function createPerfInstrumentation(deps: {
  client: QueryClient
  eventStreams: () => number
}): PerfInstrumentation {
  return {
    eventStreams: deps.eventStreams,
    queryObservers: () =>
      deps.client
        .getQueryCache()
        .getAll()
        .reduce((total, query) => total + query.getObserversCount(), 0),
    queryCacheEntries: () => deps.client.getQueryCache().getAll().length,
  }
}

/**
 * Installe l'instrumentation sur `window`, **en développement uniquement**, et
 * renvoie sa fonction de retrait.
 *
 * Elle était auparavant posée sous un simple `typeof window === "object"`, donc
 * présente en production : une surface de test livrée aux utilisateurs, et un
 * commentaire de test qui affirmait le contraire. Le garde `import.meta.env.DEV`
 * laisse Vite remplacer la condition par `false` et supprimer le bloc, ce que la
 * carte C4d vérifie par un grep de `PERF_SENTINEL` dans les assets.
 *
 * Sans risque pour la suite e2e : `playwright.config.ts` démarre son serveur
 * avec `bun run dev`, donc `import.meta.env.DEV` y vaut `true`.
 */
export function installPerfInstrumentation(deps: {
  client: QueryClient
  eventStreams: () => number
}): (() => void) | undefined {
  if (!import.meta.env.DEV) return undefined
  if (typeof window !== "object") return undefined
  void PERF_SENTINEL
  window.__UNIFIA_PERF__ = createPerfInstrumentation(deps)
  return () => {
    delete window.__UNIFIA_PERF__
  }
}
