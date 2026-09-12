/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  activeDesignSystems,
  buildActiveDesignSystemHint,
  toggleActiveDesignSystemId,
  type DesignCatalogRef,
} from "@/pages/workbench/context-chips"

function catalog(overrides: Partial<DesignCatalogRef> = {}): DesignCatalogRef {
  return { id: "cat-1", name: "Aurora", version: "1.0.0", source: "aurora/DESIGN.md", ...overrides }
}

describe("toggleActiveDesignSystemId", () => {
  test("adds an id that isn't active", () => {
    expect(toggleActiveDesignSystemId(new Set(), "cat-1").has("cat-1")).toBe(true)
  })

  test("removes an id that is already active", () => {
    expect(toggleActiveDesignSystemId(new Set(["cat-1"]), "cat-1").has("cat-1")).toBe(false)
  })

  test("never mutates the input set", () => {
    const original = new Set(["cat-1"])
    toggleActiveDesignSystemId(original, "cat-2")
    expect(original.size).toBe(1)
  })
})

describe("activeDesignSystems", () => {
  test("filters to only the active catalogs, preserving order", () => {
    const catalogs = [catalog({ id: "a" }), catalog({ id: "b" }), catalog({ id: "c" })]
    expect(activeDesignSystems(catalogs, new Set(["c", "a"])).map((c) => c.id)).toEqual(["a", "c"])
  })

  test("an empty active set returns an empty list", () => {
    expect(activeDesignSystems([catalog()], new Set())).toEqual([])
  })
})

describe("buildActiveDesignSystemHint", () => {
  test("no active catalogs produces an empty string", () => {
    expect(buildActiveDesignSystemHint([catalog()], new Set())).toBe("")
  })

  test("one active catalog is referenced by name, version and source", () => {
    const hint = buildActiveDesignSystemHint([catalog({ name: "Aurora", version: "2.1.0", source: "aurora/DESIGN.md" })], new Set(["cat-1"]))
    expect(hint).toContain("Aurora")
    expect(hint).toContain("2.1.0")
    expect(hint).toContain("aurora/DESIGN.md")
  })

  test("multiple active catalogs are all referenced, one per line", () => {
    const catalogs = [catalog({ id: "a", name: "Aurora" }), catalog({ id: "b", name: "Borealis" })]
    const hint = buildActiveDesignSystemHint(catalogs, new Set(["a", "b"]))
    expect(hint).toContain("Aurora")
    expect(hint).toContain("Borealis")
  })

  test("an inactive catalog is not referenced", () => {
    const catalogs = [catalog({ id: "a", name: "Aurora" }), catalog({ id: "b", name: "Borealis" })]
    const hint = buildActiveDesignSystemHint(catalogs, new Set(["a"]))
    expect(hint).not.toContain("Borealis")
  })
})
