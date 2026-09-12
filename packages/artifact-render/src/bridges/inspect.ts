/* SPDX-License-Identifier: MIT */

/**
 * P28 — Inspection bridge.
 *
 * The host injects a stylesheet with overrides from a closed allow-list
 * (the properties a model is allowed to tweak). The host never trusts
 * an `overrides` message coming from the iframe; it re-validates
 * against its own list. The stylesheet is keyed `data-unifia-inspect`
 * and uses `!important` so it beats inline styles a generation tool
 * might have written.
 *
 * The `inspectBridgeScript` is a self-installing IIFE inlined into the
 * srcdoc. It listens for `unifia:inspect-apply` and
 * `unifia:inspect-revert` messages and calls into the host
 * `applyInspection`/`revertInspection` callbacks wired at construction
 * time.
 */

/** Closed allow-list of CSS properties the host accepts from the iframe. */
export const INSPECTABLE_PROPERTIES = [
  "color",
  "background",
  "background-color",
  "border-color",
  "border-radius",
  "border-width",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "opacity",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "text-align",
  "text-decoration",
  "transform",
] as const

export type InspectableProperty = (typeof INSPECTABLE_PROPERTIES)[number]

export type InspectOverride = {
  selector: string
  property: InspectableProperty
  value: string
}

export function isInspectableProperty(property: string): property is InspectableProperty {
  return (INSPECTABLE_PROPERTIES as readonly string[]).includes(property)
}

export const INSPECT_STYLESHEET_ID = "data-unifia-inspect" as const

/**
 * Validates an array of `InspectOverride` against the allow-list.
 * Returns the overrides that pass validation. The host calls this
 * before writing anything to the document; the iframe can suggest
 * any value, but the host only writes what the allow-list accepts.
 */
export function filterInspectionOverrides(overrides: readonly InspectOverride[]): readonly InspectOverride[] {
  const out: InspectOverride[] = []
  for (const override of overrides) {
    if (!isInspectableProperty(override.property)) continue
    if (typeof override.selector !== "string" || override.selector.length === 0) continue
    if (typeof override.value !== "string" || override.value.length === 0) continue
    out.push(override)
  }
  return out
}

/**
 * Renders a validated list of overrides as a single CSS string with
 * `!important` on each declaration. The selector is preserved as-is;
 * callers should ensure the selector is safe to embed (this function
 * does not sanitise it).
 */
export function renderInspectionStylesheet(overrides: readonly InspectOverride[]): string {
  if (overrides.length === 0) return ""
  const declarations = overrides.map((o) => `  ${o.property}: ${o.value} !important;`).join("\n")
  return overrides.map((o) => `${o.selector} {\n${declarations}\n}`).join("\n")
}

/** Returns true when the two arrays of overrides are equivalent. */
export function inspectionEquals(left: readonly InspectOverride[], right: readonly InspectOverride[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.selector !== right[index]?.selector) return false
    if (left[index]?.property !== right[index]?.property) return false
    if (left[index]?.value !== right[index]?.value) return false
  }
  return true
}
