/* SPDX-License-Identifier: MIT */

import { For, type JSX, createSignal } from "solid-js"
import { applyLayers, defaultLayers, type Layer, type LayerChange } from "./design-layers-model"

/**
 * A6-D02 Layers panel MVP — v110 surface.
 *
 * Renders the four canonical layers (background / structure / content /
 * annotations) with rename, visibility, lock, and up/down reorder. The
 * contract calls for drag-reorder too; that ships behind the buttons here
 * while a full pointer-based DnD wiring lives with the canvas runtime.
 */
export function DesignLayersPanel(props: {
  layers: readonly Layer[]
  onChange: (change: LayerChange) => void
}): JSX.Element {
  const [editingId, setEditingId] = createSignal<string>()
  const [draftName, setDraftName] = createSignal("")
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
      <ol class="flex flex-col gap-1" data-design-layers-list>
        <For each={props.layers}>
          {(layer, index) => {
            const isEditing = (): boolean => editingId() === layer.id
            return (
              <li
                class="flex items-center gap-1 rounded px-2 py-1 hover:bg-background-base"
                classList={{ "bg-background-base": index() === 0 }}
                data-design-layer-id={layer.id}
                data-design-layer-visible={layer.visible}
                data-design-layer-locked={layer.locked}
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
