/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  ENTRY_TAB_ID,
  activateWorkspaceTab,
  closeWorkspaceTab,
  deserializeWorkspaceTabState,
  emptyWorkspaceTabState,
  isActiveWorkspaceTabClosable,
  nextWorkspaceTabId,
  openWorkspaceTab,
  previousWorkspaceTabId,
  reorderWorkspaceTab,
  serializeWorkspaceTabState,
  touchWorkspaceTab,
  workspaceTabIdAtPosition,
  type WorkspaceTab,
  type WorkspaceTabState,
} from "@/context/workspace-tabs"

function projectTab(id: string, opts: Partial<Omit<WorkspaceTab, "id">> = {}): WorkspaceTab {
  return {
    id,
    kind: "project",
    title: id,
    href: `/${id}/session/ses-1`,
    closable: true,
    createdAt: 1_700_000_000,
    lastActiveAt: 1_700_000_000,
    ...opts,
  }
}

describe("emptyWorkspaceTabState", () => {
  test("sème l'onglet entry, qui est l'actif initial et non fermable", () => {
    const state = emptyWorkspaceTabState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(state.tabs[0]?.kind).toBe("entry")
    expect(state.tabs[0]?.closable).toBe(false)
    expect(state.activeId).toBe(ENTRY_TAB_ID)
  })

  test("deux appels renvoient des états frais (pas de partage de référence)", () => {
    const first = emptyWorkspaceTabState()
    const second = emptyWorkspaceTabState()
    expect(first).not.toBe(second)
    expect(first.tabs).not.toBe(second.tabs)
    expect(first.tabs[0]).not.toBe(second.tabs[0])
  })
})

describe("openWorkspaceTab", () => {
  test("ajoute un onglet project après l'entry et l'active", () => {
    const start = emptyWorkspaceTabState()
    const next = openWorkspaceTab(start, projectTab("p-1"), 1)
    expect(next.tabs).toHaveLength(2)
    expect(next.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(next.tabs[1]?.id).toBe("p-1")
    expect(next.activeId).toBe("p-1")
  })

  // C0b a changé la sémantique attestée ici. Avant, rouvrir l'onglet ACTIF
  // bumpait son `lastActiveAt` ; désormais `open()` suit la même règle
  // qu'`activate()` — réaffirmer l'onglet où l'on est déjà n'est pas une
  // nouvelle visite, et `touchWorkspaceTab` reste le moyen explicite de
  // rafraîchir la récence. Vérifié avant d'adopter : `lastActiveAt` n'a aucun
  // lecteur dans `packages/app`, ce changement n'a donc pas d'effet observable.
  test("un onglet déjà ouvert n'est pas dupliqué ; sur l'onglet actif, l'état est identique", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { lastActiveAt: 100 }), 100)
    const reopened = openWorkspaceTab(start, projectTab("p-1", { lastActiveAt: 200 }), 200)
    expect(reopened).toBe(start)
    expect(reopened.tabs).toHaveLength(2)
    expect(reopened.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(100)
    expect(reopened.activeId).toBe("p-1")
  })

  test("rouvrir un onglet inactif le réactive et bumpe son lastActiveAt", () => {
    const opened = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { lastActiveAt: 100 }), 100)
    const away = activateWorkspaceTab(opened, ENTRY_TAB_ID, 150)
    const reopened = openWorkspaceTab(away, projectTab("p-1"), 200)
    expect(reopened.tabs).toHaveLength(2)
    expect(reopened.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(200)
    expect(reopened.activeId).toBe("p-1")
  })

  test("l'ordre d'insertion respecte la règle entry-premier : un deuxième project va après le premier", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const next = openWorkspaceTab(start, projectTab("p-2"), 2)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-1", "p-2"])
  })
})

describe("closeWorkspaceTab", () => {
  test("refuse de fermer l'entry (closable: false) — renvoie l'état inchangé", () => {
    const start = emptyWorkspaceTabState()
    const next = closeWorkspaceTab(start, ENTRY_TAB_ID, 1)
    expect(next).toBe(start)
    expect(next.tabs).toHaveLength(1)
  })

  test("ferme un onglet project et l'active reste sur entry", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const next = closeWorkspaceTab(start, "p-1", 2)
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(next.activeId).toBe(ENTRY_TAB_ID)
  })

  test("fermer l'onglet actif active le suivant à droite (pas l'entry)", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const with2 = openWorkspaceTab(start, projectTab("p-2", { lastActiveAt: 1 }), 1)
    // L'onglet actif est p-2 (le dernier ouvert). Fermer p-2 active p-1.
    expect(with2.activeId).toBe("p-2")
    const after = closeWorkspaceTab(with2, "p-2", 2)
    expect(after.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-1"])
    expect(after.activeId).toBe("p-1")
    // lastActiveAt du nouveau actif est bumpé.
    expect(after.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(2)
  })

  test("fermer un onglet inactif conserve activeId", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const with2 = openWorkspaceTab(start, projectTab("p-2"), 2)
    // Active = p-2. Fermer p-1 (inactif) ne change pas activeId.
    const after = closeWorkspaceTab(with2, "p-1", 3)
    expect(after.activeId).toBe("p-2")
    expect(after.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-2"])
  })

  test("un id inexistant renvoie l'état inchangé", () => {
    const start = emptyWorkspaceTabState()
    const next = closeWorkspaceTab(start, "missing", 1)
    expect(next).toBe(start)
  })
})

describe("activateWorkspaceTab", () => {
  // C0b : activer un onglet qui n'est PAS actif bumpe sa récence. Activer
  // celui qui l'est déjà renvoie l'état identique (voir le describe C0b).
  test("active un onglet existant non actif et met à jour lastActiveAt", () => {
    const opened = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { lastActiveAt: 100 }), 100)
    const start = activateWorkspaceTab(opened, ENTRY_TAB_ID, 150)
    const next = activateWorkspaceTab(start, "p-1", 200)
    expect(next.activeId).toBe("p-1")
    expect(next.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(200)
  })

  test("active l'entry (qui est un onglet comme un autre)", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const next = activateWorkspaceTab(start, ENTRY_TAB_ID, 2)
    expect(next.activeId).toBe(ENTRY_TAB_ID)
  })

  test("un id inexistant renvoie l'état inchangé", () => {
    const start = emptyWorkspaceTabState()
    const next = activateWorkspaceTab(start, "missing", 1)
    expect(next).toBe(start)
  })
})

describe("touchWorkspaceTab", () => {
  test("met à jour lastActiveAt sans changer activeId", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { lastActiveAt: 100 }), 100)
    const active = openWorkspaceTab(start, projectTab("p-2"), 200)
    // Active = p-2. Touch p-1 ne change pas activeId.
    const next = touchWorkspaceTab(active, "p-1", 300)
    expect(next.activeId).toBe("p-2")
    expect(next.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(300)
  })
})

describe("reorderWorkspaceTab", () => {
  function threeProjects(): WorkspaceTabState {
    const s1 = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const s2 = openWorkspaceTab(s1, projectTab("p-2"), 2)
    return openWorkspaceTab(s2, projectTab("p-3"), 3)
  }

  test("déplace un onglet vers une position ultérieure", () => {
    const start = threeProjects() // [entry, p-1, p-2, p-3]
    const next = reorderWorkspaceTab(start, "p-1", 3)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-2", "p-3", "p-1"])
  })

  test("déplace un onglet vers une position antérieure", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "p-3", 1)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-3", "p-1", "p-2"])
  })

  test("ne change pas activeId", () => {
    const start = threeProjects() // actif = p-3 (dernier ouvert)
    const next = reorderWorkspaceTab(start, "p-1", 3)
    expect(next.activeId).toBe(start.activeId)
  })

  test("refuse de déplacer l'entry", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, ENTRY_TAB_ID, 2)
    expect(next).toBe(start)
  })

  test("un id inexistant renvoie l'état inchangé", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "missing", 1)
    expect(next).toBe(start)
  })

  test("un toIndex identique au point de départ renvoie l'état inchangé", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "p-2", 2)
    expect(next).toBe(start)
  })

  test("un toIndex hors bornes renvoie l'état inchangé", () => {
    const start = threeProjects()
    expect(reorderWorkspaceTab(start, "p-1", -1)).toBe(start)
    expect(reorderWorkspaceTab(start, "p-1", 99)).toBe(start)
  })

  test("l'entry reste première même si toIndex viserait la position 0", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "p-2", 0)
    expect(next.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-2", "p-1", "p-3"])
  })
})

describe("nextWorkspaceTabId (raccourci ctrl+tab)", () => {
  function threeProjects(): WorkspaceTabState {
    const s1 = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const s2 = openWorkspaceTab(s1, projectTab("p-2"), 2)
    return openWorkspaceTab(s2, projectTab("p-3"), 3)
  }

  test("avance vers l'onglet suivant à droite", () => {
    const state = activateWorkspaceTab(threeProjects(), "p-1", 4) // [entry, p-1*, p-2, p-3]
    expect(nextWorkspaceTabId(state)).toBe("p-2")
  })

  test("boucle sur le premier onglet (entry) après le dernier", () => {
    const state = activateWorkspaceTab(threeProjects(), "p-3", 4) // dernier onglet
    expect(nextWorkspaceTabId(state)).toBe(ENTRY_TAB_ID)
  })

  test("un seul onglet ouvert (entry) boucle sur lui-même", () => {
    const state = emptyWorkspaceTabState()
    expect(nextWorkspaceTabId(state)).toBe(ENTRY_TAB_ID)
  })

  test("activeId introuvable retombe sur le premier onglet", () => {
    const state: WorkspaceTabState = { tabs: threeProjects().tabs, activeId: "missing" }
    expect(nextWorkspaceTabId(state)).toBe(ENTRY_TAB_ID)
  })
})

describe("previousWorkspaceTabId (raccourci ctrl+shift+tab)", () => {
  function threeProjects(): WorkspaceTabState {
    const s1 = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const s2 = openWorkspaceTab(s1, projectTab("p-2"), 2)
    return openWorkspaceTab(s2, projectTab("p-3"), 3)
  }

  test("recule vers l'onglet précédent à gauche", () => {
    const state = activateWorkspaceTab(threeProjects(), "p-2", 4) // [entry, p-1, p-2*, p-3]
    expect(previousWorkspaceTabId(state)).toBe("p-1")
  })

  test("boucle sur le dernier onglet avant le premier (entry)", () => {
    const state = activateWorkspaceTab(threeProjects(), ENTRY_TAB_ID, 4)
    expect(previousWorkspaceTabId(state)).toBe("p-3")
  })

  test("activeId introuvable retombe sur le dernier onglet", () => {
    const state: WorkspaceTabState = { tabs: threeProjects().tabs, activeId: "missing" }
    expect(previousWorkspaceTabId(state)).toBe("p-3")
  })
})

describe("workspaceTabIdAtPosition (raccourcis ctrl+1..ctrl+9)", () => {
  function threeProjects(): WorkspaceTabState {
    const s1 = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const s2 = openWorkspaceTab(s1, projectTab("p-2"), 2)
    return openWorkspaceTab(s2, projectTab("p-3"), 3)
  }

  test("position 1 cible toujours l'entry", () => {
    expect(workspaceTabIdAtPosition(threeProjects(), 1)).toBe(ENTRY_TAB_ID)
  })

  test("position 2 cible le premier onglet project", () => {
    expect(workspaceTabIdAtPosition(threeProjects(), 2)).toBe("p-1")
  })

  test("position 4 cible le dernier onglet ouvert", () => {
    expect(workspaceTabIdAtPosition(threeProjects(), 4)).toBe("p-3")
  })

  test("une position au-delà du nombre d'onglets ouverts renvoie undefined (ctrl+9 avec 4 onglets)", () => {
    expect(workspaceTabIdAtPosition(threeProjects(), 9)).toBeUndefined()
  })

  test("une position nulle ou négative renvoie undefined", () => {
    expect(workspaceTabIdAtPosition(threeProjects(), 0)).toBeUndefined()
    expect(workspaceTabIdAtPosition(threeProjects(), -1)).toBeUndefined()
  })
})

describe("isActiveWorkspaceTabClosable (garde du raccourci ctrl+w)", () => {
  test("true quand l'onglet actif est un project", () => {
    const state = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    expect(isActiveWorkspaceTabClosable(state)).toBe(true)
  })

  test("refuse (false) quand l'onglet actif est l'entry", () => {
    const state = emptyWorkspaceTabState()
    expect(isActiveWorkspaceTabClosable(state)).toBe(false)
  })

  test("false quand activeId est introuvable", () => {
    const state: WorkspaceTabState = { tabs: emptyWorkspaceTabState().tabs, activeId: "missing" }
    expect(isActiveWorkspaceTabClosable(state)).toBe(false)
  })
})

describe("persistance (sérialisation/désérialisation)", () => {
  test("sérialiser puis désérialiser restitue un état équivalent", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 100)
    const raw = serializeWorkspaceTabState(start)
    const restored = deserializeWorkspaceTabState(raw)
    expect(restored).toEqual(start)
  })

  test("désérialiser un JSON invalide renvoie null (pas d'exception)", () => {
    expect(deserializeWorkspaceTabState("not json")).toBeNull()
    expect(deserializeWorkspaceTabState("{}")).toBeNull()
    expect(deserializeWorkspaceTabState('{"tabs":"oops","activeId":1}')).toBeNull()
  })

  test("désérialiser sans entry restaure un état frais (refus)", () => {
    const orphan: WorkspaceTabState = { tabs: [projectTab("p-1")], activeId: "p-1" }
    const raw = serializeWorkspaceTabState(orphan)
    expect(deserializeWorkspaceTabState(raw)).toBeNull()
  })

  test("désérialiser avec un onglet malformé l'ignore (pas tout l'état)", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "entry", kind: "entry", title: "Accueil", href: "/", closable: false, createdAt: 0, lastActiveAt: 0 },
        { id: "broken", kind: "project" /* manque title, href, etc. */ },
        { id: "p-1", kind: "project", title: "p-1", href: "/p-1", closable: true, createdAt: 1, lastActiveAt: 1 },
      ],
      activeId: "p-1",
    })
    const restored = deserializeWorkspaceTabState(raw)
    expect(restored).not.toBeNull()
    expect(restored?.tabs.map((t) => t.id)).toEqual(["entry", "p-1"])
  })
})

// C0b — sémantique d'identité et upsert des métadonnées de navigation.
//
// Deux défauts fermés ici, mesurés le 2026-08-28 :
//
//  1. `activateWorkspaceTab` renvoyait un objet neuf à chaque appel, même pour
//     un no-op. Appelé depuis l'effet de route de `workspace-tabs-bar` — qui
//     lit aussi le store — cela relançait l'effet en boucle : ~10 s de thread
//     principal bloqué à chaque changement de mode, dans une seule long task.
//  2. `openWorkspaceTab` sur un onglet existant déléguait à
//     `activateWorkspaceTab` et jetait `href`/`title`. Le `href` restait donc
//     figé à la première ouverture alors que cliquer l'onglet y navigue :
//     ouvrir un projet en Code puis passer en Design laissait l'onglet pointer
//     sur `/…/session`, et le clic ramenait en arrière.
//
// Les tests d'identité utilisent `toBe`, jamais `toEqual` : c'est la référence
// qui compte, puisque c'est elle qui décide si le store Solid notifie.
// Au moins un test passe un `now` DIFFÉRENT — sans lui, une garde du type
// `lastActiveAt === now` (déduplication de rafale, pas idempotence) passerait
// le test tout en laissant le défaut ouvert.
describe("C0b — identité et upsert des workspace tabs", () => {
  const T0 = 1_700_000_000
  const T1 = 1_700_000_100
  const T2 = 1_700_000_200

  const opened = (opts: Partial<Omit<WorkspaceTab, "id">> = {}) =>
    openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { createdAt: T0, ...opts }), T1)

  test("1. onglet actif, métadonnées identiques, instant différent → état identique", () => {
    const start = opened()
    expect(openWorkspaceTab(start, projectTab("p-1", { createdAt: T0 }), T2)).toBe(start)
  })

  test("2. onglet actif, nouveau href → href actualisé", () => {
    const start = opened()
    const next = openWorkspaceTab(start, projectTab("p-1", { createdAt: T0, href: "/p-1/design?session=s1" }), T2)
    expect(next).not.toBe(start)
    expect(next.tabs.find((t) => t.id === "p-1")?.href).toBe("/p-1/design?session=s1")
  })

  test("3. onglet actif, nouveau href → createdAt préservé", () => {
    const start = opened()
    const next = openWorkspaceTab(start, projectTab("p-1", { createdAt: T2, href: "/p-1/work" }), T2)
    expect(next.tabs.find((t) => t.id === "p-1")?.createdAt).toBe(T0)
  })

  test("4. onglet actif, nouveau href → lastActiveAt préservé", () => {
    const start = opened()
    const before = start.tabs.find((t) => t.id === "p-1")?.lastActiveAt
    const next = openWorkspaceTab(start, projectTab("p-1", { createdAt: T0, href: "/p-1/work" }), T2)
    expect(next.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(before)
  })

  test("5. onglet actif, seul le title change → title actualisé", () => {
    const start = opened()
    const next = openWorkspaceTab(start, projectTab("p-1", { createdAt: T0, title: "feat/branche" }), T2)
    expect(next).not.toBe(start)
    expect(next.tabs.find((t) => t.id === "p-1")?.title).toBe("feat/branche")
  })

  test("6. onglet existant mais inactif → devient actif et lastActiveAt = now", () => {
    const start = activateWorkspaceTab(opened(), ENTRY_TAB_ID, T1)
    expect(start.activeId).toBe(ENTRY_TAB_ID)
    const next = openWorkspaceTab(start, projectTab("p-1", { createdAt: T0, href: "/p-1/design" }), T2)
    expect(next.activeId).toBe("p-1")
    const tab = next.tabs.find((t) => t.id === "p-1")
    expect(tab?.lastActiveAt).toBe(T2)
    expect(tab?.href).toBe("/p-1/design")
    expect(tab?.createdAt).toBe(T0)
  })

  test("7. nouvel onglet → ajouté et actif", () => {
    const start = opened()
    const next = openWorkspaceTab(start, projectTab("p-2", { createdAt: T0 }), T2)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-1", "p-2"])
    expect(next.activeId).toBe("p-2")
    expect(next.tabs.find((t) => t.id === "p-2")?.lastActiveAt).toBe(T2)
  })

  test("8. activate sur l'onglet déjà actif, instant différent → état identique", () => {
    const start = opened()
    expect(activateWorkspaceTab(start, "p-1", T2)).toBe(start)
  })

  test("9. activate sur un autre onglet → actif changé", () => {
    const start = opened()
    const next = activateWorkspaceTab(start, ENTRY_TAB_ID, T2)
    expect(next).not.toBe(start)
    expect(next.activeId).toBe(ENTRY_TAB_ID)
    expect(next.tabs.find((t) => t.id === ENTRY_TAB_ID)?.lastActiveAt).toBe(T2)
  })

  test("10. touch → lastActiveAt changé, actif inchangé", () => {
    const start = opened()
    const next = touchWorkspaceTab(start, "p-1", T2)
    expect(next).not.toBe(start)
    expect(next.activeId).toBe("p-1")
    expect(next.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(T2)
  })

  test("11. open contradictoire sur entry → invariants de l'entry préservés", () => {
    const start = opened()
    const hostile: WorkspaceTab = {
      id: ENTRY_TAB_ID,
      kind: "project",
      title: "pirate",
      href: "/p-1/design",
      closable: true,
      createdAt: T2,
      lastActiveAt: T2,
    }
    const next = openWorkspaceTab(start, hostile, T2)
    const entry = next.tabs.find((t) => t.id === ENTRY_TAB_ID)
    expect(entry?.kind).toBe("entry")
    expect(entry?.href).toBe("/")
    expect(entry?.closable).toBe(false)
    // L'activation reste légitime : seules les métadonnées sont invariantes.
    expect(next.activeId).toBe(ENTRY_TAB_ID)
  })
})
