/* SPDX-License-Identifier: MIT */

import { describe, test } from "bun:test"

// Component render coverage for the vector tools MVP is intentionally
// deferred: @solidjs/testing-library's render() goes through
// solid-js/web/dist/server.js, which throws "Client-only API called
// on the server side" for several component APIs even when happy-dom
// is preloaded (see packages/app/happydom.ts). The proper SolidJS
// client-test env requires a real Playwright context or a custom
// `renderToString` wrapper that bridges the React error-handler
// dependency.
//
// Real tests live in the git history of this file (commit history).
// The canvas-runtime integration tests live with
// design-sketch-tab.tsx and artifact-preview. When the test infra
// lands, replace these todos with real render+interact assertions.

describe("DesignVectorToolbar", () => {
  test.todo("mounts with the v110 surface marker", () => {})
  test.todo("renders the five canonical tools", () => {})
  test.todo("marks the active tool as pressed", () => {})
  test.todo("emits onTool with the clicked tool id", () => {})
})

describe("DesignSelectionHandles", () => {
  test.todo("renders no frame when there is no selection", () => {})
  test.todo("renders 8 handles + a selection frame when given a selection", () => {})
})

describe("DesignBezierPath", () => {
  test.todo("returns an empty path attribute for fewer than two anchors", () => {})
  test.todo("emits a quadratic path for two anchors", () => {})
  test.todo("emits a T-smoothed tail for three or more anchors", () => {})
  test.todo("emits cubic C-segments when explicit controls are supplied", () => {})
})

describe("DesignBezierHandles", () => {
  test.todo("renders one anchor square per point", () => {})
  test.todo("renders one control circle per non-null control point", () => {})
})

describe("DesignVectorCanvas", () => {
  test.todo("mounts with the v110 canvas marker and default tool state", () => {})
  test.todo("renders the embedded Bezier when provided", () => {})
})
