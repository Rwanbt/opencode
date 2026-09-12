/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  ENTRY_TAB_ID,
  activateWorkspaceTab,
  emptyWorkspaceTabState,
  openWorkspaceTab,
  type WorkspaceTab,
  type WorkspaceTabState,
} from "@/context/workspace-tabs"
import { routeToWorkspaceTab, type RouteTabsApi } from "@/components/workspace-tabs-route"

const NOW = 1_700_000_500

/**
 * Faux `RouteTabsApi` qui se comporte comme le provider réel : `open` et
 * `activate` LISENT l'état avant de l'écrire, via les mêmes réducteurs. C'est
 * cette forme — `setState(reduce(state, …))` — qui, appelée dans le scope de
 * tracking d'un effet, rendait l'effet dépendant de sa propre écriture.
 *
 * Le compteur d'appels est l'oracle : un changement de route doit produire au
 * plus une mutation.
 */
function fakeTabs(initial: WorkspaceTabState) {
  let state = initial
  const calls: string[] = []
  const api: RouteTabsApi = {
    get state() {
      return state
    },
    open(tab: WorkspaceTab) {
      calls.push("open")
      state = openWorkspaceTab(state, tab, NOW)
    },
    activate(id: string) {
      calls.push("activate")
      state = activateWorkspaceTab(state, id, NOW)
    },
  }
  return {
    api,
    calls,
    get state() {
      return state
    },
  }
}

const DIR = "RDpcQXBw" // base64 de "D:\App"

describe("C1 — routeToWorkspaceTab, une route = au plus une mutation", () => {
  test("home : active l'entry au plus une fois", () => {
    const opened = openWorkspaceTab(emptyWorkspaceTabState(), {
      id: DIR,
      kind: "project",
      title: DIR,
      href: `/${DIR}/session`,
      closable: true,
      createdAt: 1,
      lastActiveAt: 1,
    }, 1)
    const tabs = fakeTabs(opened)
    routeToWorkspaceTab({ path: "/", search: "", tabs: tabs.api, now: NOW })
    expect(tabs.calls).toEqual(["activate"])
    expect(tabs.state.activeId).toBe(ENTRY_TAB_ID)
  })

  test("home alors que l'entry est déjà active : aucun appel", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: "/", search: "", tabs: tabs.api, now: NOW })
    expect(tabs.calls).toEqual([])
  })

  test("projet absent du store : un seul open()", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: `/${DIR}/session`, search: "", tabs: tabs.api, now: NOW })
    expect(tabs.calls).toEqual(["open"])
    expect(tabs.state.activeId).toBe(DIR)
    expect(tabs.state.tabs.find((t) => t.id === DIR)?.href).toBe(`/${DIR}/session`)
  })

  test("projet actif avec le même href : aucun appel", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: `/${DIR}/session`, search: "", tabs: tabs.api, now: NOW })
    tabs.calls.length = 0
    routeToWorkspaceTab({ path: `/${DIR}/session`, search: "", tabs: tabs.api, now: NOW + 1 })
    expect(tabs.calls).toEqual([])
  })

  test("projet actif avec un href différent : un seul open(), href actualisé", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: `/${DIR}/session`, search: "", tabs: tabs.api, now: NOW })
    tabs.calls.length = 0
    routeToWorkspaceTab({ path: `/${DIR}/design`, search: "", tabs: tabs.api, now: NOW + 1 })
    expect(tabs.calls).toEqual(["open"])
    expect(tabs.state.tabs.find((t) => t.id === DIR)?.href).toBe(`/${DIR}/design`)
  })

  test("changement de search seul : href actualisé en un seul open()", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: `/${DIR}/design`, search: "", tabs: tabs.api, now: NOW })
    tabs.calls.length = 0
    routeToWorkspaceTab({ path: `/${DIR}/design`, search: "?session=s1", tabs: tabs.api, now: NOW + 1 })
    expect(tabs.calls).toEqual(["open"])
    expect(tabs.state.tabs.find((t) => t.id === DIR)?.href).toBe(`/${DIR}/design?session=s1`)
  })

  test("chemin sans segment exploitable : aucun appel", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: "//", search: "", tabs: tabs.api, now: NOW })
    expect(tabs.calls).toEqual([])
  })

  test("jamais open ET activate pour une seule route", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    for (const path of ["/", `/${DIR}/session`, `/${DIR}/design`, `/${DIR}/work`, "/"]) {
      tabs.calls.length = 0
      routeToWorkspaceTab({ path, search: "", tabs: tabs.api, now: NOW })
      expect(tabs.calls.length).toBeLessThanOrEqual(1)
    }
  })

  test("le titre vient du répertoire décodé, pas du segment brut", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: `/${DIR}/session`, search: "", tabs: tabs.api, now: NOW })
    expect(tabs.state.tabs.find((t) => t.id === DIR)?.title).toBe("D:\\App")
  })

  test("createdAt de l'onglet existant est préservé au fil des routes", () => {
    const tabs = fakeTabs(emptyWorkspaceTabState())
    routeToWorkspaceTab({ path: `/${DIR}/session`, search: "", tabs: tabs.api, now: NOW })
    const created = tabs.state.tabs.find((t) => t.id === DIR)?.createdAt
    routeToWorkspaceTab({ path: `/${DIR}/design`, search: "", tabs: tabs.api, now: NOW + 5000 })
    expect(tabs.state.tabs.find((t) => t.id === DIR)?.createdAt).toBe(created)
  })
})
