// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { describe, expect, test } from "bun:test"
import { trimTrailingSlashes } from "./url"

describe("trimTrailingSlashes", () => {
  test("behaves like the trailing-slash regex it replaces", () => {
    for (const input of ["", "/", "///", "https://a.b", "https://a.b/", "https://a.b///", "a//b//"]) {
      expect(trimTrailingSlashes(input)).toBe(input.replace(/\/+$/, ""))
    }
  })

  test("returns the same string instance when there is nothing to trim", () => {
    const input = "https://a.b"
    expect(trimTrailingSlashes(input)).toBe(input)
  })

  // The defect this guards: `replace(/\/+$/, "")` is quadratic on a slash run
  // that never reaches the `$` anchor. The same input took ~8 s through the
  // regex; anything near that budget means the regex crept back in.
  test("stays linear on a pathological slash run", () => {
    const pathological = "https://h/" + "/".repeat(100_000) + "x"

    const started = performance.now()
    const trimmed = trimTrailingSlashes(pathological)
    const elapsed = performance.now() - started

    expect(trimmed).toBe(pathological)
    expect(elapsed).toBeLessThan(100)
  })
})
