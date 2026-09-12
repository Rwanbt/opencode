/* SPDX-License-Identifier: MIT */

/**
 * P28 — Palette bridge.
 *
 * The host computes a hue-shifted palette from a list of CSS
 * variables on `:root`, and rewrites those variables in place. The
 * transformation is reversible: the original variable values are
 * memorized before the change and restored on deactivation.
 *
 * The bridge is bounded: 12 000 nodes and 5 000 CSS rules at most
 * — a larger document is not processed. The numbers are conservative
 * defaults; they keep a real-world artifact responsive while preventing
 * a hostile page from locking the host on a multi-million-node tree.
 */

export const PALETTE_NODE_BUDGET = 12_000
export const PALETTE_RULE_BUDGET = 5_000

export type CssVariable = { name: string; value: string }

export type PaletteSnapshot = ReadonlyMap<string, string>

/** Parses a `:root { --x: red; }` block into a list of variables. */
export function readPaletteFromRoot(rule: string): readonly CssVariable[] {
  const out: CssVariable[] = []
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = re.exec(rule)) !== null) {
    const name = match[1]
    const value = match[2]?.trim() ?? ""
    if (name) out.push({ name: `--${name}`, value })
  }
  return out
}

/** Splits a CSS color string into [r, g, b] in 0..255. Returns null on parse failure. */
export function parseRgb(value: string): [number, number, number] | null {
  const hex = value.match(/^#([a-f0-9]{3}|[a-f0-9]{6})$/i)
  if (hex && hex[1]) {
    const digits = hex[1]
    if (digits.length === 3) {
      const r = parseInt(digits[0]!.repeat(2), 16)
      const g = parseInt(digits[1]!.repeat(2), 16)
      const b = parseInt(digits[2]!.repeat(2), 16)
      return [r, g, b]
    }
    const r = parseInt(digits.slice(0, 2), 16)
    const g = parseInt(digits.slice(2, 4), 16)
    const b = parseInt(digits.slice(4, 6), 16)
    return [r, g, b]
  }
  const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
  if (rgb && rgb[1] && rgb[2] && rgb[3]) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  }
  return null
}

/** Converts RGB to HSL. All three channels in 0..1. */
export function rgbToHsl([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const lightness = (max + min) / 2
  let hue = 0
  let saturation = 0
  if (max !== min) {
    const delta = max - min
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    switch (max) {
      case rn: hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)); break
      case gn: hue = ((bn - rn) / delta + 2); break
      case bn: hue = ((rn - gn) / delta + 4); break
    }
    hue /= 6
  }
  return [hue, saturation, lightness]
}

/** Converts HSL back to a CSS hex string. Channels in 0..1. */
export function hslToHex([h, s, l]: readonly [number, number, number]): string {
  if (s === 0) {
    const value = Math.round(l * 255)
    return `#${value.toString(16).padStart(2, "0").repeat(3)}`
  }
  const hueToRgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255)
  const g = Math.round(hueToRgb(p, q, h) * 255)
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255)
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
}

/** Shifts the hue of a color by `deltaHue` (in turns, can be negative). */
export function shiftHue(value: string, deltaHue: number): string | null {
  const rgb = parseRgb(value)
  if (!rgb) return null
  const [h, s, l] = rgbToHsl(rgb)
  const next = (h + deltaHue) % 1
  return hslToHex([next < 0 ? next + 1 : next, s, l])
}

/**
 * Takes a snapshot of the variables in the given rule. The snapshot
 * is used to revert the palette change on deactivation. The function
 * is pure: same input, same output.
 */
export function snapshotPalette(rule: string): PaletteSnapshot {
  const out: Map<string, string> = new Map()
  for (const variable of readPaletteFromRoot(rule)) out.set(variable.name, variable.value)
  return out
}

/** Returns the variables needed to revert to the snapshot. */
export function revertPalette(rule: string, snapshot: PaletteSnapshot): readonly CssVariable[] {
  const current = readPaletteFromRoot(rule)
  const overrides: CssVariable[] = []
  for (const variable of current) {
    const original = snapshot.get(variable.name)
    if (original !== undefined && original !== variable.value) overrides.push({ name: variable.name, value: original })
  }
  return overrides
}

/** Returns the new values after a hue shift, given the original rule. */
export function applyPalette(rule: string, deltaHue: number): readonly CssVariable[] {
  const overrides: CssVariable[] = []
  for (const variable of readPaletteFromRoot(rule)) {
    const shifted = shiftHue(variable.value, deltaHue)
    if (shifted) overrides.push({ name: variable.name, value: shifted })
  }
  return overrides
}
