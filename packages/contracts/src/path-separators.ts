/* SPDX-License-Identifier: MIT */

/**
 * Removes trailing `/` and `\` from a path.
 *
 * WHY this is a loop and not `replace(/[\\/]+$/, "")`: that regex is a
 * polynomial ReDoS (CodeQL `js/polynomial-redos`). A repetition anchored to the
 * end backtracks over every split point when the tail is a long run of
 * separators, so a caller-supplied path of many slashes costs quadratic time.
 * These values reach the sandbox from configuration and from tool arguments, so
 * they are not all trusted. Scanning backwards is linear and has no such edge.
 *
 * Kept in one place because the same trim appeared in three call sites across
 * two files, which is how the identical vulnerability got introduced three
 * times.
 */
export function trimTrailingSeparators(value: string): string {
  let end = value.length
  while (end > 0) {
    const char = value[end - 1]
    if (char !== "/" && char !== "\\") break
    end--
  }
  return end === value.length ? value : value.slice(0, end)
}
