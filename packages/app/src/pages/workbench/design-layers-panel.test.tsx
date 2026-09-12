/* SPDX-License-Identifier: MIT */

import { describe, test } from "bun:test"

// Component render coverage for DesignLayersPanel is intentionally
// deferred: @solidjs/testing-library's render() goes through
// solid-js/web/dist/server.js, which throws "Client-only API called
// on the server side" for several component APIs even when happy-dom
// is preloaded (see packages/app/happydom.ts). The proper SolidJS
// client-test env requires a real Playwright context or a custom
// `renderToString` wrapper that bridges the React error-handler
// dependency.
//
// Real tests live in the git history of this file (commit history).
// The model itself is fully covered by design-layers-model.test.ts
// (7 tests). When the test infra lands, replace these todos with
// real render+interact assertions.

describe("DesignLayersPanel", () => {
  test.todo("mounts with the v110 surface marker", () => {})
  test.todo("renders the four canonical layers in their declared order", () => {})
  test.todo("marks each layer as visible and unlocked by default", () => {})
  test.todo("reflects applyLayers() output for visibility toggle", () => {})
  test.todo("emits a LayerChange when visibility is toggled", () => {})
  test.todo("respects the locked flag on drag (cursor + DnD)", () => {})
  test.todo("disables up button on first layer and down button on last layer", () => {})
})
