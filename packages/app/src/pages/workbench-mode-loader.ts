/* SPDX-License-Identifier: MIT */

/**
 * F10 — workbench mode loader.
 *
 * The workbench has three modes (Work, Design, Automate). Only one
 * is active at a time. Bundling them eagerly makes the entry chunk
 * carry the union of every surface's dependency tree — and per the
 * plan P1-B oracle «Work ne charge pas Design/Automate», a Work
 * session must NOT pay for Design/Automate at first paint.
 *
 * The actual lazy boundary is set in `workbench-mode.tsx` via
 * `lazy()`. This module is the testable surface around that
 * boundary: it exposes a loader table keyed by mode, an
 * `ensureModeLoaded` helper for hover/focus preloading, and counters
 * the unit tests can inspect to assert that Work is loaded
 * synchronously and Design/Automate stay unloaded until requested.
 *
 * The `importFns` dependency is injected so unit tests can swap
 * in stubs and avoid pulling the full surface dependency graph
 * (which includes solid-js features unavailable in the test env).
 */

export type WorkbenchModeId = "work" | "design" | "automate"

export type ModeLoader = {
  /** The import() function for the surface. Returns the loaded component. */
  load(): Promise<unknown>
  /** Whether the chunk has been requested at least once. */
  loaded(): boolean
}

export type LoaderDeps = Partial<Record<WorkbenchModeId, () => Promise<unknown>>>

/**
 * Build the loader table. The default `importFns` use relative
 * paths to the actual surfaces; tests pass stubs to avoid loading
 * the full dependency graph.
 */
export function buildModeLoaders(importFns: LoaderDeps = {}): Readonly<Record<WorkbenchModeId, ModeLoader>> {
  const inflight = new Map<WorkbenchModeId, Promise<unknown>>()
  const loaded = new Set<WorkbenchModeId>(["work"])  // Work is bundled eagerly (F10 rationale)
  const defaults: Record<WorkbenchModeId, () => Promise<unknown>> = {
    work: async () => ({ default: () => null }),  // Work is the synchronous import; placeholder for the API
    design: () => import("./workbench/design-surface").then((m) => ({ default: m.DesignSurface })),
    automate: () => import("./workbench/automate-surface").then((m) => ({ default: m.AutomateSurface })),
  }
  const sources = { ...defaults, ...importFns }
  const build = (mode: WorkbenchModeId): ModeLoader => ({
    load: () => {
      if (!inflight.has(mode)) {
        const promise = sources[mode]().then((value) => { loaded.add(mode); return value })
        inflight.set(mode, promise)
        return promise
      }
      return inflight.get(mode)!
    },
    loaded: () => loaded.has(mode),
  })
  return {
    work: build("work"),
    design: build("design"),
    automate: build("automate"),
  } as const
}

/**
 * Default loader table, used by `workbench-mode.tsx`. Tests should
 * call `buildModeLoaders` with stubs to avoid loading the actual
 * surfaces.
 */
export const MODE_LOADERS: Readonly<Record<WorkbenchModeId, ModeLoader>> = buildModeLoaders()

/**
 * Ensure a mode's chunk is loaded. Idempotent: subsequent calls
 * return the same promise. Used by hover/focus preloading (F10) and
 * by the test harness to assert that the loader is wired.
 */
export function ensureModeLoaded(mode: WorkbenchModeId, loaders: Readonly<Record<WorkbenchModeId, ModeLoader>> = MODE_LOADERS): Promise<unknown> {
  return loaders[mode].load()
}
