/* SPDX-License-Identifier: MIT */

import { createSignal, type Accessor, type Setter } from "solid-js"
import type { ViewportId } from "@unifia/artifact-render"
import { DEFAULT_VIEWPORT, DEFAULT_ZOOM } from "@unifia/artifact-render"
import { DEFAULT_TOOLBAR_MODE, type DesignToolbarMode } from "./design-toolbar"

/**
 * F11 (second extraction) — the Design toolbar's persisted state.
 *
 * The toolbar's `viewport`, `zoom`, `mode`, and `selectMode` are
 * P3-5 invariants: they must survive a tab switch and a return to
 * the artifact tab. Before F11 they lived in `design-surface.tsx`
 * alongside the snapshot state, the comment state, the stream
 * controller, and a dozen other signals. Pulling them into a
 * single 4-line helper:
 *   1. keeps the surface file under 800 LOC (the F11 runbook gate),
 *   2. makes the toolbar state trivially unit-testable (this
 *      module exports a factory with no Solid component overhead),
 *   3. is the smallest possible extraction that preserves the
 *      observable behaviour: the surface still owns the signals
 *      and the toolbar still receives them as props.
 *
 * The module is dependency-inverted: callers pass the defaults
 * they want (the production surface uses the module-level
 * constants). A test can swap the defaults in 2 lines.
 */

export type DesignToolbarState = {
  viewport: Accessor<ViewportId>
  setViewport: Setter<ViewportId>
  zoom: Accessor<number>
  setZoom: Setter<number>
  toolbarMode: Accessor<DesignToolbarMode>
  setToolbarMode: Setter<DesignToolbarMode>
  selectMode: Accessor<boolean>
  setSelectMode: Setter<boolean>
}

export function createDesignToolbarState(options: Partial<{ viewport: ViewportId; zoom: number; toolbarMode: DesignToolbarMode }> = {}): DesignToolbarState {
  const [viewport, setViewport] = createSignal<ViewportId>(options.viewport ?? DEFAULT_VIEWPORT)
  const [zoom, setZoom] = createSignal<number>(options.zoom ?? DEFAULT_ZOOM)
  const [toolbarMode, setToolbarMode] = createSignal<DesignToolbarMode>(options.toolbarMode ?? DEFAULT_TOOLBAR_MODE)
  const [selectMode, setSelectMode] = createSignal(false)
  return { viewport, setViewport, zoom, setZoom, toolbarMode, setToolbarMode, selectMode, setSelectMode }
}
