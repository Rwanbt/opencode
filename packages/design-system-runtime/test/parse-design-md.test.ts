/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  DESIGN_SECTIONS,
  buildDesignContext,
  parseDesignMd,
} from "../src/parse-design-md"

const FULL_DESIGN_MD = `# Linear-Inspired Design System

Some preamble. Headings start at level 2.

## Color

Use dark backgrounds with cool accents. The accent is \`#5e6ad2\`.

## Typography

Inter Variable at 510 weight for body, 590 for emphasis.

## Spacing

8px baseline, 24px gutter.

## Layout

12-column grid, 1440px max content width.

## Components

Buttons have a 6px radius. Cards have a 1px subtle border.

## Motion

150ms ease-out for hovers. 250ms ease-in-out for modal mounts.

## Voice

Concise, declarative, engineer-flavoured.

## Brand

Dark-mode native. Indigo-violet accent.

## Anti-Patterns

No drop shadows on a light surface. No pure white text on light backgrounds.

End of file.
`

describe("parseDesignMd", () => {
  test("all nine sections present produces an empty missing list", () => {
    const parsed = parseDesignMd("linear-app", FULL_DESIGN_MD)
    expect(parsed.id).toBe("linear-app")
    expect(parsed.missing).toEqual([])
    for (const section of DESIGN_SECTIONS) {
      expect(parsed.sections[section]).toBeTypeOf("string")
      expect((parsed.sections[section] ?? "").length).toBeGreaterThan(0)
    }
  })

  test("numeric prefix is stripped from headings", () => {
    const source = `# Open Design

## 1. Color Palette & Roles

Dark surface, indigo accent.

## 2. Typography Rules

Inter at 510 weight.

## 3. Layout Principles

12-column grid.
`
    const parsed = parseDesignMd("od", source)
    expect(parsed.sections.color).toContain("Dark surface")
    expect(parsed.sections.typography).toContain("Inter")
    expect(parsed.sections.layout).toContain("12-column grid")
  })

  test("mixed case is recognised", () => {
    const source = `# x

## COLOR

Dark surface.

## typography

Inter at 510.

## Spacing

8px baseline.
`
    const parsed = parseDesignMd("mixed-case", source)
    expect(parsed.sections.color).toContain("Dark surface")
    expect(parsed.sections.typography).toContain("Inter")
    expect(parsed.sections.spacing).toContain("8px baseline")
  })

  test("section absent from source is reported in `missing` and not invented", () => {
    const source = `# x

## Color

Use dark surfaces.

## Typography

Inter at 510.
`
    const parsed = parseDesignMd("partial", source)
    expect(parsed.sections.color).toContain("dark surfaces")
    expect(parsed.sections.typography).toContain("Inter")
    expect(parsed.sections.spacing).toBeUndefined()
    expect(parsed.missing).toContain("spacing")
    expect(parsed.missing).toContain("layout")
    expect(parsed.missing).toContain("components")
    expect(parsed.missing).toContain("motion")
    expect(parsed.missing).toContain("voice")
    expect(parsed.missing).toContain("brand")
    expect(parsed.missing).toContain("anti-patterns")
  })

  test("unknown section is ignored, not surfaced in `missing`", () => {
    const source = `# x

## Color

Dark surface.

## Some unknown section

Random material we do not model.

## Typography

Inter.
`
    const parsed = parseDesignMd("with-extras", source)
    expect(parsed.sections.color).toContain("Dark surface")
    expect(parsed.sections.typography).toContain("Inter")
    // Unknown section is not in `missing` (it is silently ignored).
    expect(parsed.missing).not.toContain("Some unknown section" as never)
    expect(parsed.missing).not.toContain("color")
  })

  test("aliases map to the canonical section", () => {
    const source = `# x

## Palette

Dark.

## Typeface

Inter.

## Animation

150ms.

## Dos and Don'ts

No pure white.
`
    const parsed = parseDesignMd("aliases", source)
    expect(parsed.sections.color).toContain("Dark")
    expect(parsed.sections.typography).toContain("Inter")
    expect(parsed.sections.motion).toContain("150ms")
    expect(parsed.sections["anti-patterns"]).toContain("pure white")
  })

  test("input order does not affect the output sections", () => {
    const orderedSource = `# x

## Color

A

## Typography

B

## Spacing

C
`
    const shuffledSource = `# x

## Spacing

C

## Typography

B

## Color

A
`
    const a = parseDesignMd("a", orderedSource)
    const b = parseDesignMd("b", shuffledSource)
    expect(a.sections.color).toBe(b.sections.color)
    expect(a.sections.typography).toBe(b.sections.typography)
    expect(a.sections.spacing).toBe(b.sections.spacing)
  })

  test("non-`## ` headings do not split sections", () => {
    const source = `# Title

# This should not split (also level 1)

## Color

Body for color.

### Sub-heading inside color

More body for color.

## Typography

Body for typography.
`
    const parsed = parseDesignMd("nested", source)
    // The `### Sub-heading inside color` body should belong to `color`,
    // not to a phantom `sub-heading` section.
    expect(parsed.sections.color).toContain("More body for color")
    expect(parsed.sections.typography).toContain("Body for typography")
  })
})

describe("buildDesignContext", () => {
  test("output is in DESIGN_SECTIONS order regardless of input order", () => {
    const source = `# x

## Typography

B

## Color

A

## Spacing

C
`
    const parsed = parseDesignMd("x", source)
    const context = buildDesignContext(parsed)
    const colorAt = context.indexOf("## Color")
    const typographyAt = context.indexOf("## Typography")
    const spacingAt = context.indexOf("## Spacing")
    expect(colorAt).toBeGreaterThanOrEqual(0)
    expect(typographyAt).toBeGreaterThan(colorAt)
    expect(spacingAt).toBeGreaterThan(typographyAt)
  })

  test("missing sections are omitted, not replaced by defaults", () => {
    const source = `# x

## Color

A
`
    const parsed = parseDesignMd("only-color", source)
    const context = buildDesignContext(parsed)
    expect(context).toContain("## Color")
    expect(context).not.toContain("## Typography")
    expect(context).toContain("Sections not provided")
    expect(context).toContain("typography")
  })

  test("deterministic for the same input", () => {
    const a = buildDesignContext(parseDesignMd("x", FULL_DESIGN_MD))
    const b = buildDesignContext(parseDesignMd("x", FULL_DESIGN_MD))
    expect(a).toBe(b)
  })

  test("two design systems produce two different preambles", () => {
    const linear = buildDesignContext(parseDesignMd("linear-app", FULL_DESIGN_MD))
    const minimal = buildDesignContext(parseDesignMd("minimal", `# x\n\n## Color\n\nPure white on black.\n\n## Typography\n\nSystem UI.\n`))
    expect(linear).not.toBe(minimal)
    expect(linear).toContain("linear-app")
    expect(minimal).toContain("minimal")
  })

  test("empty parsed system returns the empty string", () => {
    expect(buildDesignContext(parseDesignMd("empty", "# only a top heading\n\nNo sections.\n"))).toBe("")
  })

  test("the preamble is English and is the head of the generation context", () => {
    const context = buildDesignContext(parseDesignMd("x", FULL_DESIGN_MD))
    // English-only signal: French diacritics would be a sign of leak.
    expect(context).not.toMatch(/[éèàçùêîôûâäëïöü]/)
    // The preamble names the design system at the top.
    expect(context.startsWith("Design system: x.")).toBe(true)
  })
})
