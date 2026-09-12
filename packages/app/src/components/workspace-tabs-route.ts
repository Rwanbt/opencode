/* SPDX-License-Identifier: MIT */

import { ENTRY_TAB_ID, type WorkspaceTab, type WorkspaceTabState } from "@/context/workspace-tabs"

/**
 * C1 — synchronisation route → onglet d'espace de travail, isolée du runtime.
 *
 * WHY this lives outside `workspace-tabs-bar.tsx`: the rule it encodes is the
 * one that broke. The route effect used to call `tabs.open()` / `tabs.activate()`
 * inside its own tracking scope; those helpers READ the store before writing it,
 * so the effect became its own dependency and re-entered itself thousands of
 * times per navigation — one mode switch blocked the main thread for ~10 s in a
 * single task (measured 2026-08-28: ~9 700 base64 decodes, ~26 000 attribute
 * writes, 0 network requests).
 *
 * Extracted, the rule is testable without a Router, a DOM or a Solid runtime:
 * the repository has no component-mounting harness (every `*.test.tsx` here is
 * a source-text test), so a component test would have meant new infrastructure
 * for a rule that is pure anyway.
 *
 * This module proves the *shape* of the fix — one route change, at most one
 * mutation. It does not, on its own, prove the cascade is gone: that is the
 * baseline RED/GREEN of the latency spec. The two are complementary.
 */

/** The slice of the workspace-tabs API this rule needs. Nothing reactive. */
export type RouteTabsApi = {
  readonly state: WorkspaceTabState
  open(tab: WorkspaceTab): void
  activate(id: string): void
}

/**
 * Décode le premier segment d'URL (le répertoire encodé en base64) pour en
 * faire un titre lisible.
 *
 * `atob` suffit : le segment vient de `base64Encode` de `@unifia/util/encode`,
 * qui produit du base64 standard sans padding. Si le décodage échoue, on rend
 * le segment brut — mieux qu'un titre vide.
 */
export function decodeBase64Segment(segment: string): string | undefined {
  if (typeof atob === "undefined") return segment
  try {
    const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4)
    const decoded = atob(padded)
    return decoded || segment
  } catch {
    return segment
  }
}

/**
 * Aligne l'onglet d'espace de travail sur la route courante.
 *
 * Contrat : pour un changement de route donné, **au plus une mutation**.
 *
 * - home → `activate(entry)`, et seulement si l'entry n'est pas déjà active ;
 * - workspace → `open()` une seule fois, et pas du tout si l'onglet est déjà
 *   actif avec le même `href` ;
 * - route sans segment → aucun appel.
 *
 * `now` est injecté : un `Date.now()` calculé dans un scope réactif rend toute
 * écriture différente de la précédente et détruit l'idempotence en aval.
 */
export function routeToWorkspaceTab(input: {
  path: string
  search: string
  tabs: RouteTabsApi
  now: number
}): void {
  const { path, search, tabs, now } = input
  if (path === "/" || path === "") {
    if (tabs.state.activeId !== ENTRY_TAB_ID) tabs.activate(ENTRY_TAB_ID)
    return
  }
  // Le premier segment est le répertoire encodé en base64.
  const segments = path.split("/").filter(Boolean)
  const encodedDir = segments[0]
  if (!encodedDir) return
  const title = decodeBase64Segment(encodedDir) ?? encodedDir
  const rest = segments.slice(1).join("/")
  const href = `/${encodedDir}${rest ? `/${rest}` : ""}${search}`
  const existing = tabs.state.tabs.find((t) => t.id === encodedDir)
  if (existing && existing.href === href && tabs.state.activeId === encodedDir) return
  tabs.open({
    id: encodedDir,
    kind: "project",
    title,
    href,
    closable: true,
    createdAt: existing?.createdAt ?? now,
    lastActiveAt: now,
  })
}
