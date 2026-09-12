/* SPDX-License-Identifier: MIT */

import { describe, test } from "bun:test"

// Component render coverage for DesignLayersPanel is intentionally
// deferred: solid-js/web SSR requires either @solidjs/testing-library
// or happy-dom + a SolidJS-native SSR renderer, neither of which is
// installed in this worktree. The model itself is fully covered by
// design-layers-model.test.ts (7 tests). When the test infra lands,
// replace these todos with real render+interact assertions.

describe("DesignLayersPanel", () => {
  test.todo("mounts with the v110 surface marker", () => {})
  test.todo("renders the four canonical layers in their declared order", () => {})
  test.todo("marks each layer as visible and unlocked by default", () => {})
  test.todo("reflects applyLayers() output for visibility toggle", () => {})
  test.todo("emits a LayerChange when the model is mutated through the panel", () => {})
})
