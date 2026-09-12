/* SPDX-License-Identifier: MIT */

/**
 * Semantic color tokens for the v110 design language.
 *
 * Plain values (CSS custom properties will pick them up via var()).
 * Hosted in JS so they can also be imported by tests and by the
 * audit script (if/when one ships). v110.css references them as
 * `var(--text-danger, fallback)` so missing CSS tokens fall back
 * gracefully while we phase these in.
 *
 * Scope: severity (text-danger/warning/success), interactive state
 * (accent-base, border-focus), and elevation (shadow-overlay). All
 * values are RGB triplets — the design system CSS layer picks the
 * actual named color from the theme.
 *
 * The contract for these tokens is in the v110 INTERACTIONS.md
 * (severity, elevation) and VISUAL-GATES.md (palette cohesion). The
 * Phase 38 commit introduces them; Phase 39+ wires the theme CSS.
 */
export const SEMANTIC_TOKENS = {
  // Severity colours — text + background variants.
  textDanger: "rgb(220, 80, 80)",
  textWarning: "rgb(220, 170, 60)",
  textSuccess: "rgb(80, 170, 100)",
  textInfo: "rgb(80, 140, 200)",
  bgDanger: "rgba(220, 80, 80, 0.12)",
  bgWarning: "rgba(220, 170, 60, 0.12)",
  bgSuccess: "rgba(80, 170, 100, 0.12)",
  bgInfo: "rgba(80, 140, 200, 0.12)",

  // Interactive accent — focus ring, accent button background.
  accentBase: "rgb(120, 140, 220)",
  accentStrong: "rgb(140, 160, 240)",
  borderFocus: "rgb(140, 160, 240)",

  // Elevation — overlays, toasts, dialogs.
  shadowOverlay: "rgba(0, 0, 0, 0.32)",
  shadowFloating: "rgba(0, 0, 0, 0.18)",
} as const

export type SemanticToken = keyof typeof SEMANTIC_TOKENS

/** Stable CSS custom property names for the semantic tokens. */
export const SEMANTIC_CSS_VARS: Readonly<Record<SemanticToken, string>> = {
  textDanger: "--text-danger",
  textWarning: "--text-warning",
  textSuccess: "--text-success",
  textInfo: "--text-info",
  bgDanger: "--bg-danger",
  bgWarning: "--bg-warning",
  bgSuccess: "--bg-success",
  bgInfo: "--bg-info",
  accentBase: "--accent-base",
  accentStrong: "--accent-strong",
  borderFocus: "--border-focus",
  shadowOverlay: "--shadow-overlay",
  shadowFloating: "--shadow-floating",
} as const

/**
 * Render a CSS `:root { ... }` snippet that registers every semantic
 * token as a CSS custom property. Drop this in (or splice it into
 * your existing root CSS) to make the v110.css `var(--text-danger,
 * fallback)` calls resolve to real values instead of falling back.
 */
export function semanticTokensCssBlock(): string {
  const lines = Object.entries(SEMANTIC_TOKENS).map(([key, value]) => `  ${SEMANTIC_CSS_VARS[key as SemanticToken]}: ${value};`)
  return `:root {\n${lines.join("\n")}\n}\n`
}
