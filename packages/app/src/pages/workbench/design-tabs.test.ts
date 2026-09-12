/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  activateTab,
  closeTab,
  emptyDesignTabState,
  openTab,
  type DesignTab,
  type DesignTabState,
} from "@/pages/workbench/design-tabs"

function tab(id: string, opts: Partial<Omit<DesignTab, "id">> = {}): DesignTab {
  return { id, kind: "artifact", title: id, closable: true, ...opts }
}

describe("openTab", () => {
  test("ajoute un nouvel onglet et l'active", () => {
    const start: DesignTabState = { tabs: [], activeId: undefined }
    const next = openTab(start, tab("a"))
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0]?.id).toBe("a")
    expect(next.activeId).toBe("a")
  })

  test("un onglet déjà présent est activé au lieu d'être dupliqué", () => {
    const start: DesignTabState = { tabs: [tab("a"), tab("b")], activeId: "a" }
    const next = openTab(start, tab("b"))
    expect(next.tabs).toHaveLength(2)
    expect(next.activeId).toBe("b")
  })

  test("ajoute un onglet à un état non-vide en conservant les autres", () => {
    const start: DesignTabState = { tabs: [tab("a", { closable: false })], activeId: "a" }
    const next = openTab(start, tab("b"))
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"])
    expect(next.activeId).toBe("b")
  })
})

describe("closeTab", () => {
  test("ferme un onglet inactif en conservant activeId", () => {
    const start: DesignTabState = { tabs: [tab("a"), tab("b")], activeId: "a" }
    const next = closeTab(start, "b")
    expect(next.tabs.map((t) => t.id)).toEqual(["a"])
    expect(next.activeId).toBe("a")
  })

  test("fermer l'onglet actif en position intermédiaire active le voisin de gauche", () => {
    const start: DesignTabState = { tabs: [tab("a"), tab("b"), tab("c")], activeId: "b" }
    const next = closeTab(start, "b")
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "c"])
    expect(next.activeId).toBe("a")
  })

  test("fermer le premier onglet actif active son voisin de droite", () => {
    const start: DesignTabState = { tabs: [tab("a"), tab("b"), tab("c")], activeId: "a" }
    const next = closeTab(start, "a")
    expect(next.tabs.map((t) => t.id)).toEqual(["b", "c"])
    expect(next.activeId).toBe("b")
  })

  test("fermer le dernier onglet laisse activeId à undefined et la liste vide", () => {
    const start: DesignTabState = { tabs: [tab("a")], activeId: "a" }
    const next = closeTab(start, "a")
    expect(next.tabs).toEqual([])
    expect(next.activeId).toBeUndefined()
  })

  test("un onglet `closable: false` ne peut pas être fermé — renvoie l'état inchangé", () => {
    const start: DesignTabState = { tabs: [tab("pinned", { closable: false })], activeId: "pinned" }
    const next = closeTab(start, "pinned")
    expect(next).toBe(start)
    expect(next.tabs).toHaveLength(1)
    expect(next.activeId).toBe("pinned")
  })

  test("fermer un id inexistant renvoie l'état inchangé", () => {
    const start: DesignTabState = { tabs: [tab("a")], activeId: "a" }
    const next = closeTab(start, "missing")
    expect(next).toBe(start)
  })
})

describe("activateTab", () => {
  test("active un onglet existant", () => {
    const start: DesignTabState = { tabs: [tab("a"), tab("b")], activeId: "a" }
    const next = activateTab(start, "b")
    expect(next.activeId).toBe("b")
  })

  test("un id inexistant ne change pas activeId", () => {
    const start: DesignTabState = { tabs: [tab("a")], activeId: "a" }
    const next = activateTab(start, "missing")
    expect(next.activeId).toBe("a")
  })
})

describe("emptyDesignTabState", () => {
  test("renvoie un état initial vide", () => {
    const empty = emptyDesignTabState()
    expect(empty.tabs).toEqual([])
    expect(empty.activeId).toBeUndefined()
  })
})

describe("kind: spec", () => {
  test("ouvre un onglet de kind 'spec' et l'active", () => {
    const next = openTab(emptyDesignTabState(), { id: "spec", kind: "spec", title: "Spec", closable: false })
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0]?.kind).toBe("spec")
    expect(next.activeId).toBe("spec")
  })

  test("un onglet de kind 'spec' non-fermable survit à closeTab", () => {
    const start: DesignTabState = { tabs: [{ id: "spec", kind: "spec", title: "Spec", closable: false }], activeId: "spec" }
    const next = closeTab(start, "spec")
    expect(next).toBe(start)
  })

  test("activateTab fonctionne pour un onglet de kind 'spec'", () => {
    const start: DesignTabState = {
      tabs: [
        { id: "files", kind: "file", title: "Fichiers", closable: false },
        { id: "spec", kind: "spec", title: "Spec", closable: false },
      ],
      activeId: "files",
    }
    const next = activateTab(start, "spec")
    expect(next.activeId).toBe("spec")
  })
})

describe("seedDesignTabState", () => {
  test("est exporté depuis design-workspace, pas de design-tabs", async () => {
    // The seed lives in design-workspace.tsx because it composes the
    // openTab reducer with concrete tab descriptors. This guard exists so
    // the indirection is not lost in a refactor.
    const module = await import("@/pages/workbench/design-workspace")
    expect(typeof module.seedDesignTabState).toBe("function")
  })
})
