/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { closeTab, openTab } from "@/pages/workbench/design-tabs"
import { seedDesignTabState } from "@/pages/workbench/design-workspace"

describe("seedDesignTabState (Phase 3)", () => {
  test("sème deux onglets non fermables: 'spec' (kind: spec) puis 'files' (kind: file)", () => {
    const state = seedDesignTabState()
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs.map((t) => t.id)).toEqual(["spec", "files"])
    expect(state.tabs[0]?.kind).toBe("spec")
    expect(state.tabs[0]?.closable).toBe(false)
    expect(state.tabs[1]?.kind).toBe("file")
    expect(state.tabs[1]?.closable).toBe(false)
  })

  test("l'onglet actif après le seed est 'files' (le dernier ouvert)", () => {
    const state = seedDesignTabState()
    expect(state.activeId).toBe("files")
  })

  test("les deux onglets semés refusent d'être fermés (le réducteur renvoie l'état inchangé)", () => {
    const state = seedDesignTabState()
    const afterFiles = closeTab(state, "files")
    expect(afterFiles).toBe(state)
    const afterSpec = closeTab(state, "spec")
    expect(afterSpec).toBe(state)
  })

  test("un onglet d'artefact ouvert après le seed coexiste avec les onglets semés", () => {
    const state = seedDesignTabState()
    const withArtifact = openTab(state, {
      id: "artifact-1",
      kind: "artifact",
      title: "artifact-1.html",
      closable: true,
    })
    expect(withArtifact.tabs).toHaveLength(3)
    expect(withArtifact.tabs.map((t) => t.id)).toEqual(["spec", "files", "artifact-1"])
    expect(withArtifact.activeId).toBe("artifact-1")
  })

  test("fermer l'onglet artefact ne touche pas les onglets non-fermables", () => {
    const seeded = seedDesignTabState()
    const withArtifact = openTab(seeded, {
      id: "artifact-1",
      kind: "artifact",
      title: "artifact-1.html",
      closable: true,
    })
    const afterClose = closeTab(withArtifact, "artifact-1")
    expect(afterClose.tabs.map((t) => t.id)).toEqual(["spec", "files"])
    // "files" était l'onglet actif avant l'ouverture de l'artefact, et
    // c'est lui qui redevient actif après la fermeture de l'artefact
    // (règle du réducteur : voisin de gauche de l'onglet fermé).
    expect(afterClose.activeId).toBe("files")
  })

  test("réutiliser seedDesignTabState ne mute pas l'état précédent (état frais)", () => {
    const first = seedDesignTabState()
    const second = seedDesignTabState()
    expect(first).not.toBe(second)
    expect(first.tabs).toEqual(second.tabs)
    // Les tableaux internes sont aussi frais — muter l'un n'affecte pas l'autre.
    expect(first.tabs).not.toBe(second.tabs)
  })
})
