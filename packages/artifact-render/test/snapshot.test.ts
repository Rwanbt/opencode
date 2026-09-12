/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  INLINEABLE_PROPERTIES,
  SNAPSHOT_BRIDGE_SCRIPT,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_TIMEOUT_MS,
  looksBlank,
  type Rgba,
} from "../src/bridges/snapshot"

const BLACK: Rgba = [0, 0, 0, 255]
const WHITE: Rgba = [255, 255, 255, 255]
const RED: Rgba = [255, 0, 0, 255]
const RED_LIGHT: Rgba = [250, 5, 5, 255] // diverge de RED de 5 → dans la tolérance
const RED_FAR: Rgba = [240, 20, 20, 255] // diverge de RED de 15 → hors tolérance

function nine(tone: Rgba): Rgba[] {
  return [tone, tone, tone, tone, tone, tone, tone, tone, tone]
}

describe("looksBlank — cas de base", () => {
  test("9 échantillons tous identiques → blank = true", () => {
    expect(looksBlank(nine(BLACK))).toBe(true)
    expect(looksBlank(nine(WHITE))).toBe(true)
    expect(looksBlank(nine([0, 0, 0, 0]))).toBe(true)
  })

  test("un échantillon diverge de plus de 6 → blank = false", () => {
    const samples = nine(BLACK)
    samples[4] = WHITE // pixel central blanc
    expect(looksBlank(samples)).toBe(false)
  })

  test("toutes les canaux considérés (R, G, B, A)", () => {
    // 8 noirs + 1 noir dont seul le canal alpha diffère de 6
    const samples = nine([0, 0, 0, 200])
    samples[3] = [0, 0, 0, 207] // alpha +7 → hors tolérance
    expect(looksBlank(samples)).toBe(false)
  })
})

describe("looksBlank — tolérance de 6 unités", () => {
  test("différences ≤ 6 sur tous les canaux → blank = true", () => {
    const samples = nine(RED)
    samples[2] = RED_LIGHT // diff R:5, G:5, B:5, A:0 — toutes ≤ 6
    expect(looksBlank(samples)).toBe(true)
  })

  test("différence de 6 exactement → blank = true (≤ inclusif)", () => {
    const samples = nine(RED)
    samples[5] = [249, 0, 0, 255] // diff R:6 exactement
    expect(looksBlank(samples)).toBe(true)
  })

  test("différence de 7 sur un canal → blank = false", () => {
    const samples = nine(RED)
    samples[7] = [248, 0, 0, 255] // diff R:7 → hors tolérance
    expect(looksBlank(samples)).toBe(false)
  })

  test("différence de 15 sur le canal G → blank = false", () => {
    const samples = nine(RED)
    samples[1] = RED_FAR // diff G:20
    expect(looksBlank(samples)).toBe(false)
  })
})

describe("looksBlank — règle des 9 échantillons minimum", () => {
  test("0 échantillons → blank = false (insuffisant pour conclure)", () => {
    expect(looksBlank([])).toBe(false)
  })

  test("1 à 8 échantillons tous identiques → blank = false (insuffisant)", () => {
    expect(looksBlank([BLACK])).toBe(false)
    expect(looksBlank([BLACK, BLACK, BLACK])).toBe(false)
    expect(looksBlank(nine(BLACK).slice(0, 8))).toBe(false)
  })

  test("9 échantillons exactement tous identiques → blank = true", () => {
    expect(looksBlank(nine(BLACK))).toBe(true)
  })

  test("10+ échantillons uniformes → blank = true (on a passé le seuil)", () => {
    expect(looksBlank([...nine(BLACK), BLACK])).toBe(true)
  })
})

describe("looksBlank — défauts / types", () => {
  test("résultat cohérent : 9 uniformes = true, 9 mêlés = false", () => {
    const a = nine(BLACK)
    const b = nine(BLACK)
    b[0] = WHITE
    expect(looksBlank(a)).toBe(true)
    expect(looksBlank(b)).toBe(false)
  })
})

describe("Constantes du module", () => {
  test("SNAPSHOT_TIMEOUT_MS = 5000", () => {
    expect(SNAPSHOT_TIMEOUT_MS).toBe(5_000)
  })

  test("SNAPSHOT_ERROR_CODES contient les 6 codes attendus", () => {
    expect(SNAPSHOT_ERROR_CODES).toEqual([
      "empty-render",
      "no-document",
      "no-canvas",
      "no-image",
      "foreign-object-failed",
      "timeout",
    ])
  })

  test("INLINEABLE_PROPERTIES contient les 30 propriétés whitelistées", () => {
    expect(INLINEABLE_PROPERTIES).toHaveLength(30)
    // Quelques clés représentatives
    expect(INLINEABLE_PROPERTIES).toContain("color")
    expect(INLINEABLE_PROPERTIES).toContain("background")
    expect(INLINEABLE_PROPERTIES).toContain("font-size")
    expect(INLINEABLE_PROPERTIES).toContain("border-radius")
  })
})

describe("SNAPSHOT_BRIDGE_SCRIPT — invariants du contenu", () => {
  test("est une string non-vide contenant le marqueur d'installation", () => {
    expect(typeof SNAPSHOT_BRIDGE_SCRIPT).toBe("string")
    expect(SNAPSHOT_BRIDGE_SCRIPT.length).toBeGreaterThan(500)
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain("__unifiaSnapshotInstalled")
  })

  test("contient le listener pour 'unifia:snapshot'", () => {
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain('"unifia:snapshot"')
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain("addEventListener")
  })

  test("contient les postMessage de retour conformes au protocole", () => {
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain('"unifia:snapshot-result"')
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain('"unifia:snapshot-error"')
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain("empty-render")
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain("timeout")
  })

  test("contient la logique looksBlank équivalente (échantillonnage 3x3 + tolérance 6)", () => {
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain("samples.length < 9")
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain(">6")
  })

  test("attend document.fonts.ready avant la rastérisation", () => {
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain("document.fonts")
    expect(SNAPSHOT_BRIDGE_SCRIPT).toContain("ready")
  })
})
