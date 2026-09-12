/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const TABS_BAR = resolve(import.meta.dir, "./workspace-tabs-bar.tsx")
const source = readFileSync(TABS_BAR, "utf-8")

// V07 — the audit caught three warnings on a viewport resize
// (1440 -> 768 -> 375) while a tab was being dragged:
//
//   nonexistent droppable
//   nonexistent draggable
//   sortableOffset
//
// The root cause: `onDragOver` committed a reorder on every frame.
// When the SortableProvider re-rendered with a fresh id list, a
// drag-over event arrived carrying a stale droppable id. solid-dnd
// logged the warning; the reorder reducer silently dropped the
// event.
//
// The fix is structural. Static tests assert the contract so a
// future refactor cannot re-introduce the issue.
describe("V07 — WorkspaceTabsBar DnD commit on drag end, not on drag over", () => {
  test("handleDragOver is a no-op (no tabs.reorder call, no state mutation)", () => {
    // Locate the function body and assert it does not call reorder.
    const idx = source.indexOf("function handleDragOver")
    const endIdx = source.indexOf("function handleDragEnd", idx)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(endIdx).toBeGreaterThan(idx)
    const body = source.slice(idx, endIdx)
    expect(body).not.toMatch(/tabs\.reorder\(/)
    expect(body).not.toMatch(/setState\(/)
    expect(body).toMatch(/no-op/i)
  })

  test("handleDragEnd is the one place that calls tabs.reorder", () => {
    const idx = source.indexOf("function handleDragEnd")
    expect(idx).toBeGreaterThanOrEqual(0)
    const reorderIdx = source.indexOf("tabs.reorder(", idx)
    expect(reorderIdx).toBeGreaterThan(idx)
    // There is exactly one ACTUAL call to `tabs.reorder(` in the
    // file. The other occurrence is a comment in the "before V07"
    // narrative (a `// tabs.reorder(...) à chaque mouvement`).
    // The call lives inside handleDragEnd, not handleDragOver.
    const handleDragOverIdx = source.indexOf("function handleDragOver")
    const handleDragOverEnd = source.indexOf("function handleDragEnd")
    const overBody = source.slice(handleDragOverIdx, handleDragOverEnd)
    expect(overBody).not.toMatch(/^\s*tabs\.reorder\(/m)
    // Locate every line that *is* a call (not a comment): the
    // identifier must be preceded by whitespace and not preceded by
    // `//`.
    const callLines = source.split("\n").filter((line) => /^\s*tabs\.reorder\(/.test(line))
    expect(callLines.length).toBe(1)
  })

  test("handleDragEnd filters stale ids: droppable not in the store, or draggable gone, both bail out", () => {
    const idx = source.indexOf("function handleDragEnd")
    const endIdx = source.indexOf("createEffect", idx)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(endIdx).toBeGreaterThan(idx)
    const body = source.slice(idx, endIdx)
    expect(body).toMatch(/toIndex === -1/)
    expect(body).toMatch(/fromStillPresent/)
  })

  test("DragDropProvider wires both onDragOver and onDragEnd", () => {
    // The provider must keep an onDragOver slot (solid-dnd requires
    // it; we just turned it into a no-op). The new onDragEnd is the
    // commit point.
    expect(source).toMatch(/DragDropProvider[\s\S]+?onDragOver=\{handleDragOver\}[\s\S]+?onDragEnd=\{handleDragEnd\}/)
  })

  test("the discipline comment explicitly notes console.warn must stay enabled", () => {
    // V07 plan: "ne pas masquer console.warn". A refactor that
    // wraps the warning in a try/catch or silences it would
    // re-introduce the bug silently; this test pins the policy.
    // The comment in the source is in French ("ne pas masquer"),
    // so the assertion is locale-agnostic: just confirm the source
    // contains a comment that mentions both "console.warn" and
    // "masquer" / "mask" / "silence".
    expect(source).toMatch(/console\.warn/)
    expect(source).toMatch(/masquer|mask|silence/i)
  })
})
