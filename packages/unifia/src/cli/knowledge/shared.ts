/* SPDX-License-Identifier: MIT */
/**
 * Helpers shared by the knowledge CLI dispatcher and its command modules
 * (card C16). Kept in one place so the dispatcher and the extracted command
 * files cannot drift on how a flag is parsed.
 */

/** Memory types, in the order the distribution tables render them. */
export const LCD_TYPES = [
  "decision",
  "constraint",
  "preference",
  "failure",
  "learning",
  "procedure",
  "reference",
  "semantic",
  "episodic",
] as const

/** Lifecycle states, in transition order. */
export const LCD_LIFECYCLES = ["candidate", "active", "superseded", "archived"] as const

/**
 * Parse `--key=value` flags. A bare `--key` is recorded with an empty value
 * so `flags.has("key")` works for switches.
 */
export function parseFlags(rest: readonly string[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const arg of rest) {
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq > 0) m.set(arg.slice(2, eq), arg.slice(eq + 1))
    else m.set(arg.slice(2), "")
  }
  return m
}

/** Join path parts with forward slashes, collapsing separators. */
export function join_(...parts: string[]): string {
  return parts.join("/").replace(/[\/]+/g, "/")
}

/** True when `--name` or `--name=...` is present. */
export function hasFlag(args: readonly string[], name: string): boolean {
  for (const a of args) {
    if (a === `--${name}`) return true
    if (a.startsWith(`--${name}=`)) return true
  }
  return false
}

/** A parsed command line: the subcommand and everything after it. */
export interface ParsedArgs {
  cmd: string | null
  rest: string[]
}
