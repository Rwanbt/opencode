// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

/**
 * Drops the trailing `/` run of a URL or path.
 *
 * WHY not `replace(/\/+$/, "")`: the anchored `+` makes the engine retry from
 * every offset, so the cost is quadratic in the length of a trailing slash run
 * that never reaches the `$` anchor (CodeQL `js/polynomial-redos`). Measured on
 * this repo's Bun build with `"https://h/" + "/".repeat(n) + "x"`:
 *
 *   n        regex      this
 *   10 000   222 ms     0.004 ms
 *   50 000   2 914 ms   0.004 ms
 *   100 000  8 001 ms   0.004 ms
 *
 * Every caller here normalizes a URL the user typed or pasted, so the input
 * length is attacker-chosen and 8 s is a frozen WebView. One backward walk is
 * linear, and allocates nothing when there is nothing to trim.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") end--
  return end === value.length ? value : value.slice(0, end)
}
