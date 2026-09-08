// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { describe, expect, test } from "bun:test"
import { brandColors, compactBelowColumns, logo, plainWordmark } from "../../src/cli/logo"

// brand/unifia/cli/unifia-cli-lockup.json is marked user-approved-final and owns
// every glyph, colour and dimension the CLI and TUI draw. These tests assert the
// code against that file rather than against copies of its values, so drift on
// either side fails here instead of shipping a logo nobody approved.
const spec = await Bun.file(new URL("../../../../brand/unifia/cli/unifia-cli-lockup.json", import.meta.url)).json()

describe("Unifia CLI lockup", () => {
  test("draws the approved symbol, glyph for glyph and colour mask included", () => {
    expect(logo.symbol.map((row) => ({ text: row.text, colors: row.colors }))).toEqual(spec.symbol)
  })

  test("draws the approved wordmark", () => {
    expect(logo.wordmark).toEqual(spec.wordmark)
  })

  test("uses the approved colours exactly, not an approximation", () => {
    expect(brandColors.purple).toBe(spec.colors.purple)
    expect(brandColors.blue).toBe(spec.colors.blue)
    expect(brandColors.orange).toBe(spec.colors.orange)
    expect(brandColors.white).toBe(spec.colors.wordmark)
  })

  test("keeps the approved 38-column, five-row lockup", () => {
    expect(logo.symbol).toHaveLength(spec.heightRows)
    expect(logo.wordmark).toHaveLength(spec.heightRows)
    for (const row of plainWordmark) {
      expect([...row]).toHaveLength(spec.widthColumns)
    }
  })

  test("aligns every colour mask with the glyph row it paints", () => {
    for (const row of logo.symbol) {
      expect([...row.colors]).toHaveLength([...row.text].length)
    }
  })

  test("falls back to the compact mark at the approved threshold", () => {
    expect(compactBelowColumns).toBe(spec.compactBelowColumns)
  })
})
