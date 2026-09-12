/* SPDX-License-Identifier: MIT */

import { describe, test } from "bun:test"

// Component render coverage for the vector tools MVP is intentionally
// deferred: solid-js/web SSR requires either @solidjs/testing-library
// or happy-dom + a SolidJS-native SSR renderer, neither of which is
// installed in this worktree. The canvas-runtime integration tests
// live with design-sketch-tab.tsx and artifact-preview. When the test
// infra lands, replace these todos with real render+interact assertions.

describe("DesignVectorToolbar", () => {
  test.todo("mounts with the v110 surface marker", () => {})
  test.todo("renders the five canonical tools", () => {})
  test.todo("marks the active tool as pressed", () => {})
})

describe("DesignSelectionHandles", () => {
  test.todo("renders no frame when there is no selection", () => {})
  test.todo("renders 8 handles + a selection frame when given a selection", () => {})
})

describe("DesignBezierPath", () => {
  test.todo("returns an empty path attribute for fewer than two anchors", () => {})
  test.todo("emits a quadratic path for two anchors and a T-smoothed tail for more", () => {})
})

describe("DesignVectorCanvas", () => {
  test.todo("mounts with the v110 canvas marker and default tool state", () => {})
  test.todo("renders the embedded Bezier when provided", () => {})
})
