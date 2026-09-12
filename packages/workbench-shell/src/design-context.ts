/* SPDX-License-Identifier: MIT */

/**
 * P22 — Build the design-system preamble for a generation prompt.
 *
 * The workbench-shell owns the integration between the workspace
 * manifest (a list of `DesignSystemCatalog`) and the design-system
 * parser. The pure parser lives in `@unifia/design-system-runtime`; this
 * module is the one place that knows how to take a catalog and a piece
 * of `DESIGN.md` content and produce the English preamble a model is
 * asked to follow.
 *
 * The functions in this module are pure. The actual file I/O and the
 * choice of which catalog is active live in the caller (the workbench
 * app); what stays here is the transformation.
 */

import { buildDesignContext, parseDesignMd, type ParsedDesignSystem } from "@unifia/design-system-runtime"
import type { DesignSystemCatalog } from "./design-system.js"

export type DesignContextSource = {
  /** The catalog the preamble is for. */
  catalog: Pick<DesignSystemCatalog, "id" | "name" | "version" | "source">
  /** Raw `DESIGN.md` content. */
  designMd: string
}

/**
 * Parses a catalog's `DESIGN.md` and exposes the parsed shape.
 * Pure: same input always produces the same output.
 */
export function parseDesignContext(source: DesignContextSource): ParsedDesignSystem {
  return parseDesignMd(source.catalog.id, source.designMd)
}

/**
 * Builds the English preamble the model is asked to follow.
 * Returns the empty string when the catalog has no `DESIGN.md` content
 * (the model gets a clean prompt without any design-system instruction).
 */
export function buildCatalogContext(source: DesignContextSource): string {
  if (!source.designMd.trim()) return ""
  return buildDesignContext(parseDesignMd(source.catalog.id, source.designMd))
}

/**
 * Combines two or more catalog preambles into one preamble.
 * The active catalog comes first; the others are listed as supporting
 * references. Each preamble is separated by a blank line.
 */
export function combineCatalogContexts(sources: readonly DesignContextSource[]): string {
  const blocks: string[] = []
  for (const source of sources) {
    const block = buildCatalogContext(source)
    if (block) blocks.push(block)
  }
  return blocks.join("\n\n")
}
