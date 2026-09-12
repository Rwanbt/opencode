/* SPDX-License-Identifier: MIT */

import { For, type JSX, createSignal, onCleanup } from "solid-js"
import { applyLayers, defaultLayers, type Layer, type LayerChange } from "./design-layers-model"

/**
 * A6-D02 Layers panel MVP — v110 surface.
 *
 * Renders the four canonical layers (background / structure / content /
 * annotations) with rename, visibility, lock, up/down reorder, and
 * pointer-based drag-reorder (locked layers are not draggable).
 */
export function DesignLayersPanel(props: {
  layers: readonly Layer[]
  onChange: (change: LayerChange) => void
}): JSX.Element {
  const [editingId, setEditingId] = createSignal<string>()
  const [draftName, setDraftName] = createSignal("")
  const [draggingId, setDraggingId] = createSignal<string>()
  const [dropIndex, setDropIndex] = createSignal<number | undefined>()
  const startEdit = (layer: Layer): void => {
    setEditingId(layer.id)
    setDraftName(layer.name)
  }
  const commitEdit = (): void => {
    const id = editingId()
    if (id) props.onChange({ kind: "rename", id, name: draftName().trim() || id })
    setEditingId(undefined)
  }
  const move = (id: string, delta: number): void => {
    const index = props.layers.findIndex((layer) => layer.id === id)
    if (index < 0) return
    props.onChange({ kind: "reorder", id, toIndex: index + delta })
  }

  // Pointer-based DnD. We compute the drop target by counting how many
  // rows the pointer has crossed (each row contributes its measured height
  // to the index). The contract forbids dragging a locked layer, mirroring
  // Figma/Sketch behaviour.
  const startDrag = (event: PointerEvent, layer: Layer): void => {
    if (layer.locked) return
    setDraggingId(layer.id)
    setDropIndex(props.layers.findIndex((row) => row.id === layer.id))
    const target = event.currentTarget as HTMLElement | null
    target?.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent): void => {
    const id = draggingId()
    if (!id) return
    const list = event.currentTarget instanceof Element ? event.currentTarget : null
    const rows = (list ?? document).querySelectorAll<HTMLLIElement>("[data-design-layer-id]")
    const pointerY = event.clientY
    let target: number | undefined
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2
      if (pointerY < midpoint) {
        target = i
        break
      }
      target = i + 1
    }
    setDropIndex(target)
  }
  const endDrag = (event: PointerEvent): void => {
    const id = draggingId()
    const target = dropIndex()
    if (id && target !== undefined) {
      const currentIndex = props.layers.findIndex((layer) => layer.id === id)
      if (currentIndex >= 0 && currentIndex !== target) {
        const clamped = Math.max(0, Math.min(target, props.layers.length - 1))
        if (clamped !== currentIndex) props.onChange({ kind: "reorder", id, toIndex: clamped })
      }
    }
    setDraggingId(undefined)
    setDropIndex(undefined)
    const node = event.currentTarget as HTMLElement | null
    node?.releasePointerCapture?.(event.pointerId)
  }

  if (typeof window !== "undefined") {
    onCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", endDrag)
    })
  }

  return (
    <aside
      class="flex w-full min-w-44 flex-col gap-1 border border-border-base bg-background-stronger p-2"
      data-v110="design-layers-panel"
      aria-label="Design layers"
    >
      <header class="flex items-center justify-between border-b border-border-base pb-1">
        <h2 class="text-12-medium">Layers</h2>
        <span class="text-10-regular text-text-weak">{props.layers.length}</span>
      </header>
      <ol
        class="flex flex-col gap-1"
        data-design-layers-list
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      >
        <For each={props.layers}>
          {(layer, index) => {
            const isEditing = (): boolean => editingId() === layer.id
            const isDragging = (): boolean => draggingId() === layer.id
            const isDropTarget = (): boolean => {
              const target = dropIndex()
              return target !== undefined && target === index() && draggingId() !== layer.id
            }
            return (
              <li
                class="flex items-center gap-1 rounded px-2 py-1 hover:bg-background-base motion-safe:transition-colors"
                classList={{
                  "bg-background-base": index() === 0,
                  "opacity-60 cursor-grabbing": isDragging(),
                  "cursor-grab": !layer.locked && !isDragging(),
                  "cursor-not-allowed": layer.locked,
                  "border-t-2 border-border-focus": isDropTarget(),
                }}
                data-design-layer-id={layer.id}
                data-design-layer-visible={layer.visible}
                data-design-layer-locked={layer.locked}
                onPointerDown={(event) => startDrag(event, layer)}
              >
                <button
                  type="button"
                  class="flex h-6 w-6 items-center justify-center rounded text-11-medium"
                  aria-label={layer.visible ? "Hide layer" : "Show layer"}
                  aria-pressed={!layer.visible}
                  data-design-layer-action="visibility"
                  onClick={() => props.onChange({ kind: "toggleVisibility", id: layer.id })}
                >
                  {layer.visible ? "👁" : "✕"}
                </button>
                <button
                  type="button"
                  class="flex h-6 w-6 items-center justify-center rounded text-11-medium"
                  aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
                  aria-pressed={layer.locked}
                  data-design-layer-action="lock"
                  onClick={() => props.onChange({ kind: "toggleLock", id: layer.id })}
                >
                  {layer.locked ? "🔒" : "🔓"}
                </button>
                {isEditing() ? (
                  <input
                    class="min-w-0 flex-1 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular"
                    value={draftName()}
                    aria-label="Rename layer"
                    data-design-layer-input="rename"
                    onInput={(event) => setDraftName(event.currentTarget.value)}
                    onBlur={commitEdit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitEdit()
                      if (event.key === "Escape") setEditingId(undefined)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-12-regular"
                    data-design-layer-action="rename"
                    onDblClick={() => startEdit(layer)}
                    onClick={() => startEdit(layer)}
                  >
                    {layer.name}
                  </button>
                )}
                <button
                  type="button"
                  class="flex h-6 w-6 items-center justify-center rounded text-11-regular"
                  aria-label="Move layer up"
                  disabled={index() === 0}
                  data-design-layer-action="up"
                  onClick={() => move(layer.id, -1)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  class="flex h-6 w-6 items-center justify-center rounded text-11-regular"
                  aria-label="Move layer down"
                  disabled={index() === props.layers.length - 1}
                  data-design-layer-action="down"
                  onClick={() => move(layer.id, 1)}
                >
                  ▼
                </button>
              </li>
            )
          }}
        </For>
      </ol>
    </aside>
  )
}

/** Convenience: wraps the panel with a built-in store. */
export function DefaultLayersPanel(): JSX.Element {
  const [layers, setLayers] = createSignal<readonly Layer[]>(defaultLayers())
  const onChange = (change: LayerChange): void => {
    const next = applyLayers(layers(), change)
    setLayers(next)
  }
  return <DesignLayersPanel layers={layers()} onChange={onChange} />
}
