// FORK (Phase 3.1, PLAN-EDITEUR-IDE-DEFINITIF): settings migration
// `autoSave` (legacy = "format on save") → split into `autoSave` (autosave
// debounce) + `formatOnSave`. Migration runs once at persisted() load via
// `persisted({ key, migrate: migrateAutoSave })`. The function must be:
//   • idempotent — re-running on already-migrated data is a no-op;
//   • safe on malformed input — non-objects and non-object `general` are
//     returned untouched (settings layer handles defaults via merge());
//   • lossless — preserves every other key, including user overrides.

import { test, expect, describe } from "bun:test"
import { migrateAutoSave } from "./settings"

describe("settings migration — autoSave split (Phase 3.1)", () => {
  test("legacy autoSave:true → formatOnSave:true, autoSave:false", () => {
    const raw = { general: { autoSave: true, releaseNotes: true, followup: "steer" } }
    const next = migrateAutoSave(raw) as { general: Record<string, unknown> }
    expect(next.general.autoSave).toBe(false)
    expect(next.general.formatOnSave).toBe(true)
    expect(next.general.releaseNotes).toBe(true)
    expect(next.general.followup).toBe("steer")
  })

  test("legacy autoSave:false → formatOnSave:false (no other change)", () => {
    const raw = { general: { autoSave: false, releaseNotes: false } }
    const next = migrateAutoSave(raw) as { general: Record<string, unknown> }
    expect(next.general.autoSave).toBe(false)
    expect(next.general.formatOnSave).toBe(false)
    expect(next.general.releaseNotes).toBe(false)
  })

  test("already migrated (formatOnSave present) — no-op, preserves overrides", () => {
    const raw = { general: { autoSave: true, formatOnSave: false } }
    const next = migrateAutoSave(raw) as { general: Record<string, unknown> }
    // User explicitly chose autoSave:true with formatOnSave:false — keep it.
    expect(next).toEqual(raw)
  })

  test("missing general — passes through (defaults layer fills in)", () => {
    const raw = { appearance: { fontSize: 14 } }
    expect(migrateAutoSave(raw)).toBe(raw)
  })

  test("non-object input — passes through", () => {
    expect(migrateAutoSave(null)).toBe(null)
    expect(migrateAutoSave(undefined)).toBe(undefined)
    expect(migrateAutoSave("garbage")).toBe("garbage")
    expect(migrateAutoSave(42)).toBe(42)
  })

  test("idempotent — running twice yields the same result", () => {
    const raw = { general: { autoSave: true } }
    const once = migrateAutoSave(raw) as { general: Record<string, unknown> }
    const twice = migrateAutoSave(once) as { general: Record<string, unknown> }
    expect(twice).toEqual(once)
    expect(twice.general.formatOnSave).toBe(true)
    expect(twice.general.autoSave).toBe(false)
  })

  test("preserves keys outside general (updates, appearance, keybinds, ...)", () => {
    const raw = {
      general: { autoSave: true },
      appearance: { fontSize: 18, mono: "Fira Code" },
      keybinds: { "tab.close": "ctrl+w" },
      permissions: { autoApprove: true },
    }
    const next = migrateAutoSave(raw) as Record<string, unknown>
    expect(next.appearance).toEqual({ fontSize: 18, mono: "Fira Code" })
    expect(next.keybinds).toEqual({ "tab.close": "ctrl+w" })
    expect(next.permissions).toEqual({ autoApprove: true })
  })
})