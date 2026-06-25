// FORK (Phase 3.4, PLAN-EDITEUR-IDE-DEFINITIF): pure-helper tests for the
// dirty-close guard. The full provider is exercised by manual / E2E;
// these tests pin the gating rules so a future refactor can't silently
// regress "Cancel leaves the tab open" or "Don't save closes without
// saving".

import { test, expect, describe } from "bun:test"
import { shouldGuardDirtyClose } from "./close-guard-helpers"

describe("shouldGuardDirtyClose — dirty-close gating", () => {
  test("system tab 'context' → never guarded", () => {
    expect(shouldGuardDirtyClose("context", "src/app.ts", "dirty")).toBe(false)
    expect(shouldGuardDirtyClose("context", undefined, undefined)).toBe(false)
  })

  test("system tab 'review' → never guarded", () => {
    expect(shouldGuardDirtyClose("review", "src/app.ts", "dirty")).toBe(false)
  })

  test("unparseable tab (no file path) → not guarded, closes immediately", () => {
    expect(shouldGuardDirtyClose("file://broken", undefined, undefined)).toBe(false)
  })

  test("file tab status=clean → not guarded", () => {
    expect(shouldGuardDirtyClose("file://src/app.ts", "src/app.ts", "clean")).toBe(false)
  })

  test("file tab status=saving → not guarded (save in flight; let it finish)", () => {
    expect(shouldGuardDirtyClose("file://src/app.ts", "src/app.ts", "saving")).toBe(false)
  })

  test("file tab status=conflict → not guarded (banner already shows 409)", () => {
    expect(shouldGuardDirtyClose("file://src/app.ts", "src/app.ts", "conflict")).toBe(false)
  })

  test("file tab status=missing → not guarded (banner already shows delete)", () => {
    expect(shouldGuardDirtyClose("file://src/app.ts", "src/app.ts", "missing")).toBe(false)
  })

  test("file tab status=dirty → GUARDED (show dialog)", () => {
    expect(shouldGuardDirtyClose("file://src/app.ts", "src/app.ts", "dirty")).toBe(true)
  })

  test("file tab path missing from FileStore (undefined status) → not guarded", () => {
    expect(shouldGuardDirtyClose("file://src/app.ts", "src/app.ts", undefined)).toBe(false)
  })
})