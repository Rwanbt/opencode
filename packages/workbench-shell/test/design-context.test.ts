/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { buildCatalogContext, combineCatalogContexts, parseDesignContext } from "../src/design-context"

const CATALOG = { id: "linear-app", name: "Linear", version: "1.0.0", source: "workspace://imports/linear-app" }

const FULL_DESIGN_MD = `# Linear

## Color

Dark backgrounds, indigo accent.

## Typography

Inter Variable at 510 weight.

## Spacing

8px baseline.
`

describe("design-context", () => {
  test("parses a full DESIGN.md", () => {
    const parsed = parseDesignContext({ catalog: CATALOG, designMd: FULL_DESIGN_MD })
    expect(parsed.id).toBe("linear-app")
    expect(parsed.sections.color).toContain("Dark backgrounds")
    expect(parsed.missing).toContain("layout")
  })

  test("buildCatalogContext produces a deterministic preamble", () => {
    const a = buildCatalogContext({ catalog: CATALOG, designMd: FULL_DESIGN_MD })
    const b = buildCatalogContext({ catalog: CATALOG, designMd: FULL_DESIGN_MD })
    expect(a).toBe(b)
  })

  test("buildCatalogContext returns empty string on empty designMd", () => {
    expect(buildCatalogContext({ catalog: CATALOG, designMd: "" })).toBe("")
    expect(buildCatalogContext({ catalog: CATALOG, designMd: "   \n  " })).toBe("")
  })

  test("two catalogs produce two different preambles", () => {
    const other = { ...CATALOG, id: "minimal", name: "Minimal" }
    const linear = buildCatalogContext({ catalog: CATALOG, designMd: FULL_DESIGN_MD })
    const minimal = buildCatalogContext({
      catalog: other,
      designMd: `# Minimal\n\n## Color\n\nWhite on black.\n`,
    })
    expect(linear).not.toBe(minimal)
    expect(linear).toContain("linear-app")
    expect(minimal).toContain("minimal")
  })

  test("combineCatalogContexts joins multiple preambles with blank lines", () => {
    const other = { ...CATALOG, id: "minimal", name: "Minimal" }
    const combined = combineCatalogContexts([
      { catalog: CATALOG, designMd: FULL_DESIGN_MD },
      { catalog: other, designMd: `# Minimal\n\n## Color\n\nWhite on black.\n` },
    ])
    expect(combined).toContain("linear-app")
    expect(combined).toContain("minimal")
    // Two preambles are separated by at least one blank line.
    expect(combined).toMatch(/linear-app[\s\S]*?\n\n[\s\S]*?minimal/)
  })

  test("combineCatalogContexts filters out empty preambles", () => {
    const combined = combineCatalogContexts([
      { catalog: CATALOG, designMd: "" },
      { catalog: CATALOG, designMd: "# Title\n\nNo sections." },
      { catalog: CATALOG, designMd: FULL_DESIGN_MD },
    ])
    // Two non-empty preambles: the one with no sections returns "".
    const occurrences = combined.split("Design system:").length - 1
    expect(occurrences).toBe(1)
  })

  test("combineCatalogContexts returns empty string on an empty input", () => {
    expect(combineCatalogContexts([])).toBe("")
  })
})
