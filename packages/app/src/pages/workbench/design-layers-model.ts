/* SPDX-License-Identifier: MIT */

/**
 * A6-D02 Layers panel model.
 *
 * Pure data + operations for the layers panel that ships in the v110
 * Design surface. The contract calls for rename, visibility, lock, and
 * drag-reorder — these are exposed as operations on a `Layer` record so
 * any canvas runtime can plug it in. The component owns DOM, this module
 * owns the state shape and invariants.
 */

export type Layer = {
  readonly id: string
  readonly name: string
  readonly visible: boolean
  readonly locked: boolean
}

export type LayerChange =
  | { kind: "rename"; id: string; name: string }
  | { kind: "toggleVisibility"; id: string }
  | { kind: "toggleLock"; id: string }
  | { kind: "reorder"; id: string; toIndex: number }

export function applyLayers(layers: readonly Layer[], change: LayerChange): readonly Layer[] {
  switch (change.kind) {
    case "rename":
      return layers.map((layer) => (layer.id === change.id ? { ...layer, name: change.name } : layer))
    case "toggleVisibility":
      return layers.map((layer) => (layer.id === change.id ? { ...layer, visible: !layer.visible } : layer))
    case "toggleLock":
      return layers.map((layer) => (layer.id === change.id ? { ...layer, locked: !layer.locked } : layer))
    case "reorder": {
      const from = layers.findIndex((layer) => layer.id === change.id)
      if (from < 0) return layers
      const clampedTo = Math.max(0, Math.min(change.toIndex, layers.length - 1))
      if (clampedTo === from) return layers
      const next = layers.slice()
      const [moved] = next.splice(from, 1)
      next.splice(clampedTo, 0, moved)
      return next
    }
  }
}

export function defaultLayers(): readonly Layer[] {
  return [
    { id: "background", name: "Background", visible: true, locked: false },
    { id: "structure", name: "Structure", visible: true, locked: false },
    { id: "content", name: "Content", visible: true, locked: false },
    { id: "annotations", name: "Annotations", visible: true, locked: false },
  ]
}
