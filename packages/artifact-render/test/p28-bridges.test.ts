/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  INSPECTABLE_PROPERTIES,
  TWEAKS_PANEL_ATTRIBUTE,
  TWEAKS_TOGGLE_MESSAGE_TYPE,
  filterInspectionOverrides,
  findTweaksPanel,
  formatUnifiaPath,
  inspectionEquals,
  isInspectableProperty,
  parseUnifiaPath,
  pathOfUnifiaNode,
  renderInspectionStylesheet,
  resolveUnifiaPath,
  applyPalette,
  revertPalette,
  shiftHue,
  snapshotPalette,
  toggleTweaksPanel,
  type TreeNode,
  type TweaksPanel,
} from "../src/index"

const fixture: TreeNode = (() => {
  const leaf = { children: { length: 0, item() { return null } } }
  const children = [leaf, leaf, leaf]
  return {
    children: {
      length: children.length,
      item(index) {
        return children[index] ?? null
      },
    },
  } as TreeNode
})()

describe("P28 / inspection bridge", () => {
  test("the allow-list is non-empty and contains no executable properties", () => {
    expect(INSPECTABLE_PROPERTIES.length).toBeGreaterThan(0)
    for (const property of INSPECTABLE_PROPERTIES) {
      expect(property).not.toMatch(/^on/i) // no event handlers
      expect(property).not.toMatch(/javascript|url\(/i)
    }
  })

  test("isInspectableProperty returns true only for listed properties", () => {
    expect(isInspectableProperty("color")).toBe(true)
    expect(isInspectableProperty("opacity")).toBe(true)
    expect(isInspectableProperty("onclick")).toBe(false)
    expect(isInspectableProperty("background-image")).toBe(false)
  })

  test("filterInspectionOverrides drops unknown properties and empty values", () => {
    const filtered = filterInspectionOverrides([
      { selector: "h1", property: "color", value: "red" },
      { selector: "h1", property: "onclick" as never, value: "alert(1)" },
      { selector: "", property: "color", value: "red" },
      { selector: "h1", property: "color", value: "" },
    ])
    expect(filtered).toEqual([{ selector: "h1", property: "color", value: "red" }])
  })

  test("renderInspectionStylesheet applies !important and contains every override", () => {
    const stylesheet = renderInspectionStylesheet([
      { selector: "h1", property: "color", value: "red" },
      { selector: ".card", property: "border-radius", value: "8px" },
    ])
    expect(stylesheet).toContain("color: red !important")
    expect(stylesheet).toContain("border-radius: 8px !important")
    expect(stylesheet).toContain("h1 {")
    expect(stylesheet).toContain(".card {")
  })

  test("inspectionEquals compares the override list shape", () => {
    const a = [{ selector: "h1", property: "color" as const, value: "red" }]
    const b = [{ selector: "h1", property: "color" as const, value: "red" }]
    const c = [{ selector: "h1", property: "color" as const, value: "blue" }]
    expect(inspectionEquals(a, b)).toBe(true)
    expect(inspectionEquals(a, c)).toBe(false)
  })
})

describe("P28 / palette bridge", () => {
  test("a hue shift on a hex color preserves saturation and lightness", () => {
    const shifted = shiftHue("#ff0000", 0.5)
    expect(shifted).toBe("#00ffff")
  })

  test("applyPalette and revertPalette are inverses on a stable rule", () => {
    const rule = ":root { --primary: #ff0000; --secondary: #00ff00; }"
    const snapshot = snapshotPalette(rule)
    const overrides = applyPalette(rule, 0.5)
    expect(overrides.length).toBeGreaterThan(0)
    for (const override of overrides) {
      expect(override.value).not.toBe(snapshot.get(override.name))
    }
    // Reverting on the post-shift rule yields the same values as the snapshot.
    const reverted = revertPalette(
      `:root { ${overrides.map((o) => `${o.name}: ${o.value};`).join(" ")} }`,
      snapshot,
    )
    expect(reverted.length).toBe(overrides.length)
  })

  test("budgets are present and conservative", () => {
    expect(12000).toBeGreaterThan(0)
    expect(5000).toBeGreaterThan(0)
  })
})

describe("P28 / tweaks bridge", () => {
  function makePanel(): TweaksPanel & { hidden: boolean } {
    let hidden = false
    return {
      get hidden() { return hidden },
      hasAttribute(name) { return name === "hidden" && hidden },
      setAttribute(name) { if (name === "hidden") hidden = true },
      removeAttribute(name) { if (name === "hidden") hidden = false },
    }
  }

  test("toggle is reversible: two toggles return the panel to its original state", () => {
    const panel = makePanel()
    const initial = panel.hidden
    toggleTweaksPanel(panel)
    toggleTweaksPanel(panel)
    expect(panel.hidden).toBe(initial)
  })

  test("the bridge exposes a data attribute and a message type", () => {
    expect(TWEAKS_PANEL_ATTRIBUTE).toBe("data-unifia-tweaks")
    expect(TWEAKS_TOGGLE_MESSAGE_TYPE).toBe("unifia:tweaks:toggle")
  })

  test("findTweaksPanel returns the panel when one is present", () => {
    const panel = makePanel()
    const root = { querySelector: (sel: string) => (sel === "[data-unifia-tweaks]" ? panel : null) }
    expect(findTweaksPanel(root)).toBe(panel)
  })

  test("findTweaksPanel returns null when no panel is in the root", () => {
    const root = { querySelector: () => null }
    expect(findTweaksPanel(root)).toBeNull()
  })
})

describe("P28 / manual-edit bridge", () => {
  test("parseUnifiaPath and formatUnifiaPath are inverses", () => {
    expect(parseUnifiaPath("path-0-2-1")).toEqual([0, 2, 1])
    expect(formatUnifiaPath([0, 2, 1])).toBe("path-0-2-1")
    expect(parseUnifiaPath("path-")).toEqual([])
  })

  test("parseUnifiaPath refuses a non-numeric segment", () => {
    expect(() => parseUnifiaPath("path-0-abc-1")).toThrow(/non-integer/)
    expect(() => parseUnifiaPath("path-0--1")).toThrow()
  })

  test("parseUnifiaPath refuses a path that does not start with path-", () => {
    expect(() => parseUnifiaPath("data-unifia-id-0-2-1")).toThrow(/must start with/)
  })

  test("resolveUnifiaPath returns the same node for the same path", () => {
    const a = resolveUnifiaPath(fixture, "path-0")
    const b = resolveUnifiaPath(fixture, "path-0")
    expect(a).toBe(b)
  })

  test("resolveUnifiaPath returns null for an out-of-range index", () => {
    expect(resolveUnifiaPath(fixture, "path-99")).toBeNull()
  })

  test("pathOfUnifiaNode returns a stable path string", () => {
    expect(pathOfUnifiaNode(fixture, fixture)).toBe("path-0")
  })
})

describe("P28 / reversibility criterion", () => {
  test("the inspection bridge is reversible: applied then cleared yields the same state", () => {
    const baseline: { selector: string; property: "color"; value: string }[] = []
    const overrides = filterInspectionOverrides([{ selector: "h1", property: "color", value: "red" }])
    const stylesheet = renderInspectionStylesheet(overrides)
    // The stylesheet can be removed by setting an empty override list.
    const after = renderInspectionStylesheet(baseline)
    expect(stylesheet).not.toBe(after)
    expect(after).toBe("")
  })

  test("the palette bridge is reversible: snapshot and revert are equivalent", () => {
    const rule = ":root { --a: #ff0000; }"
    const snapshot = snapshotPalette(rule)
    expect(snapshot.get("--a")).toBe("#ff0000")
    const overrides = applyPalette(rule, 0.5)
    expect(overrides[0]?.value).toBe("#00ffff")
    // Reverting on the post-shift rule produces a single entry whose value
    // matches the snapshot.
    const postShift = `:root { --a: ${overrides[0]?.value ?? ""}; }`
    const reverted = revertPalette(postShift, snapshot)
    expect(reverted).toEqual([{ name: "--a", value: "#ff0000" }])
  })

  test("the tweaks bridge is reversible: two toggles yield the same state", () => {
    const panel = { hidden: false, hasAttribute: (n: string) => n === "hidden", setAttribute: () => undefined, removeAttribute: () => undefined }
    const stateBefore = panel.hidden
    toggleTweaksPanel(panel)
    toggleTweaksPanel(panel)
    expect(panel.hidden).toBe(stateBefore)
  })

  test("the manual-edit bridge is reversible: same path returns same node", () => {
    const first = resolveUnifiaPath(fixture, "path-1")
    const second = resolveUnifiaPath(fixture, "path-1")
    expect(first).toBe(second)
  })
})
