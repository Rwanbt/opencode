/* SPDX-License-Identifier: MIT */

import { expect, test, describe } from "bun:test"
import { buildModeLoaders, ensureModeLoaded, type WorkbenchModeId } from "./workbench-mode-loader"

describe("F10 — buildModeLoaders (lazy boundary per mode)", () => {
  test("Work is loaded eagerly; Design and Automate start unloaded (stubs avoid the solid-js import chain)", () => {
    // WHY stubs: the real surfaces pull in `@unifia/ui/context` which
    // uses `use` from `solid-js/web` (a browser export). The test
    // environment is Node-side, so we inject no-op import functions
    // and verify the table's behaviour without loading the surfaces.
    const loaders = buildModeLoaders({
      design: async () => ({ default: () => "DesignSurface-stub" }),
      automate: async () => ({ default: () => "AutomateSurface-stub" }),
    })
    expect(loaders.work.loaded()).toBe(true)
    expect(loaders.design.loaded()).toBe(false)
    expect(loaders.automate.loaded()).toBe(false)
  })

  test("ensureModeLoaded is idempotent (returns the same promise on repeated calls)", async () => {
    const loaders = buildModeLoaders({
      design: async () => ({ default: () => "DesignSurface-stub" }),
      automate: async () => ({ default: () => "AutomateSurface-stub" }),
    })
    const a = ensureModeLoaded("design", loaders)
    const b = ensureModeLoaded("design", loaders)
    expect(a).toBe(b)
    await a
    expect(loaders.design.loaded()).toBe(true)
  })

  test("loading one mode does not load the others", async () => {
    const loaders = buildModeLoaders({
      design: async () => ({ default: () => "DesignSurface-stub" }),
      automate: async () => ({ default: () => "AutomateSurface-stub" }),
    })
    await ensureModeLoaded("design", loaders)
    expect(loaders.design.loaded()).toBe(true)
    expect(loaders.automate.loaded()).toBe(false)
  })

  test("every mode has a loader entry with load() and loaded()", () => {
    const loaders = buildModeLoaders({
      design: async () => ({ default: () => "stub" }),
      automate: async () => ({ default: () => "stub" }),
    })
    const modes: WorkbenchModeId[] = ["work", "design", "automate"]
    for (const mode of modes) {
      expect(loaders[mode]).toBeDefined()
      expect(typeof loaders[mode].load).toBe("function")
      expect(typeof loaders[mode].loaded).toBe("function")
    }
  })
})
