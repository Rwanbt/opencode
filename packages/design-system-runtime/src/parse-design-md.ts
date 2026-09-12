/* SPDX-License-Identifier: MIT */

/**
 * P22 — Parse a `DESIGN.md` file into the Unifia theme shape.
 *
 * WHY this is a parser and not a regex search: a design system description
 * is structured. The file uses nine `## ` sections, one per Unifia theme.
 * Treating the file as a free-form string would let the model misread the
 * wrong section as the right one, and a model that follows a wrong
 * theme is harder to debug than a model that follows no theme at all.
 *
 * The parser is pure: it takes a string and returns a typed object, with
 * no filesystem or network access. The caller (P22 wiring in
 * `design-surface.tsx`) decides which `DESIGN.md` content to read.
 */

export const DESIGN_SECTIONS = [
  "color",
  "typography",
  "spacing",
  "layout",
  "components",
  "motion",
  "voice",
  "brand",
  "anti-patterns",
] as const

export type DesignSection = (typeof DESIGN_SECTIONS)[number]

export type ParsedDesignSystem = {
  id: string
  sections: Partial<Record<DesignSection, string>>
  missing: readonly DesignSection[]
}

const SECTION_ALIASES: Readonly<Record<DesignSection, readonly string[]>> = {
  color: [
    "color",
    "colors",
    "color-palette",
    "color-palette-and-roles",
    "palette",
    "colors-and-roles",
  ],
  typography: ["typography", "type", "fonts", "typeface", "typography-rules"],
  spacing: ["spacing", "space", "rhythm", "gutter"],
  layout: ["layout", "grid", "composition", "layout-principles"],
  components: ["components", "component-stylings", "ui", "widgets"],
  motion: ["motion", "animation", "transitions", "depth", "depth-and-elevation"],
  voice: ["voice", "tone", "writing", "agent-prompt-guide", "messaging"],
  brand: ["brand", "theme", "atmosphere", "visual-theme", "visual-theme-and-atmosphere"],
  "anti-patterns": ["anti-patterns", "do-s-and-don-ts", "dos-and-donts", "donts"],
}

/** Normalises a heading into a section key, or `null` if it does not map. */
function matchSection(rawHeading: string): DesignSection | null {
  // Strip a leading numeric prefix (`1.`, `2)`, `42.`) before normalisation.
  const stripped = rawHeading.replace(/^\s*\d+[.)]?\s*/, "")
  const normalised = stripped
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s&-]/g, "") // strip punctuation, keep alphanumerics, spaces, &, -
    .replace(/\s*&\s*/g, "-and-")
    .replace(/\s+/g, "-")
  for (const section of DESIGN_SECTIONS) {
    const aliases = SECTION_ALIASES[section]
    if (aliases.includes(normalised)) return section
  }
  return null
}

const HEADING_PREFIX = /^##\s+(?:\d+[.)]?\s*)?(.+?)\s*$/gm

/**
 * Splits a `DESIGN.md` into its nine theme sections.
 *
 * - Splits on `## ` headings (level 2). Level 1 (`# `) and level 3+ are
 *   ignored for the section split.
 * - Heading matching is case-insensitive.
 * - A leading numeric prefix (`## 1. Color`, `## 2) Typography`) is
 *   stripped before the section match.
 * - Sections that do not match a Unifia theme are silently ignored —
 *   they are not invented in `missing`. The caller decides what to do
 *   with extra material.
 * - Sections that match a Unifia theme but are absent are reported in
 *   `missing`, so the UI can flag the design system as incomplete.
 */
export function parseDesignMd(id: string, source: string): ParsedDesignSystem {
  const sections: Partial<Record<DesignSection, string>> = {}
  const matchedHeadings: Array<{ index: number; section: DesignSection; title: string }> = []
  let match: RegExpExecArray | null
  HEADING_PREFIX.lastIndex = 0
  while ((match = HEADING_PREFIX.exec(source)) !== null) {
    const heading = match[1] ?? ""
    const section = matchSection(heading)
    if (section) matchedHeadings.push({ index: match.index + match[0].length, section, title: heading })
  }
  for (let index = 0; index < matchedHeadings.length; index += 1) {
    const current = matchedHeadings[index]
    const next = matchedHeadings[index + 1]
    if (!current) continue
    const endIndex = next ? source.lastIndexOf("## ", next.index) : source.length
    const startIndex = current.index
    const body = source.slice(startIndex, endIndex).trim()
    sections[current.section] = body
  }
  const missing = DESIGN_SECTIONS.filter((section) => !(section in sections))
  return { id, sections, missing }
}

/**
 * Builds the English preamble injected before a generation prompt.
 *
 * - The output is deterministic: same input always produces the same string.
 * - Sections are emitted in the canonical `DESIGN_SECTIONS` order, not the
 *   order in which they appear in the source file.
 * - Missing sections are omitted, not replaced with a default. A partial
 *   design system is still a valid input; inventing tokens would be a lie.
 * - The preamble is structured to be readable by a language model. It is
 *   not a list, not a JSON dump — it is a paragraph per section.
 */
export function buildDesignContext(parsed: ParsedDesignSystem): string {
  const present = DESIGN_SECTIONS.filter((section) => typeof parsed.sections[section] === "string")
  if (present.length === 0) return ""
  const lines: string[] = []
  lines.push(`Design system: ${parsed.id}.`)
  lines.push("Follow the design system conventions described below. Each section is authoritative for its slice of the artifact; do not invent values that the section does not state.")
  for (const section of present) {
    const body = parsed.sections[section]
    if (typeof body !== "string") continue
    const heading = section
      .split("-")
      .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
      .join(" ")
    lines.push("")
    lines.push(`## ${heading}`)
    lines.push(body)
  }
  if (parsed.missing.length > 0) {
    lines.push("")
    lines.push(`Sections not provided by this design system (do not invent defaults): ${parsed.missing.join(", ")}.`)
  }
  return lines.join("\n")
}
