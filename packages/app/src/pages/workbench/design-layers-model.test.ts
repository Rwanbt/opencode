import { describe, expect, test } from "bun:test"
import { applyLayers, defaultLayers, type Layer } from "./design-layers-model"

const layers: readonly Layer[] = [
  { id: "a", name: "A", visible: true, locked: false },
  { id: "b", name: "B", visible: true, locked: false },
  { id: "c", name: "C", visible: true, locked: false },
]

describe("design-layers-model", () => {
  test("defaults expose four ordered layers", () => {
    expect(defaultLayers().map((layer) => layer.id)).toEqual(["background", "structure", "content", "annotations"])
  })

  test("rename replaces the matching name and leaves others alone", () => {
    const next = applyLayers(layers, { kind: "rename", id: "b", name: "Beta" })
    expect(next.map((layer) => layer.name)).toEqual(["A", "Beta", "C"])
  })

  test("toggleVisibility flips visibility only on the targeted layer", () => {
    const next = applyLayers(layers, { kind: "toggleVisibility", id: "b" })
    expect(next.find((layer) => layer.id === "b")?.visible).toBe(false)
    expect(next.find((layer) => layer.id === "a")?.visible).toBe(true)
  })

  test("toggleLock flips locked only on the targeted layer", () => {
    const next = applyLayers(layers, { kind: "toggleLock", id: "a" })
    expect(next.find((layer) => layer.id === "a")?.locked).toBe(true)
  })

  test("reorder moves a layer between siblings and clamps invalid indexes", () => {
    const moved = applyLayers(layers, { kind: "reorder", id: "a", toIndex: 2 })
    expect(moved.map((layer) => layer.id)).toEqual(["b", "c", "a"])
    const clamped = applyLayers(layers, { kind: "reorder", id: "a", toIndex: 99 })
    expect(clamped.map((layer) => layer.id)).toEqual(["b", "c", "a"])
  })

  test("reorder is a no-op when from and to match", () => {
    const next = applyLayers(layers, { kind: "reorder", id: "b", toIndex: 1 })
    expect(next.map((layer) => layer.id)).toEqual(["a", "b", "c"])
  })

  test("rename on a missing id leaves the array intact", () => {
    const next = applyLayers(layers, { kind: "rename", id: "ghost", name: "x" })
    expect(next).toBe(layers)
  })
})
