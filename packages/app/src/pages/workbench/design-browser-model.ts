/* SPDX-License-Identifier: MIT */

export type BrowserHistoryAction = "back" | "forward" | "reload"

/**
 * Phase 14 — turns what the user typed into an address the native side will
 * accept, or nothing.
 *
 * The Rust command refuses any scheme other than http(s) (windows.rs), so a
 * bare host has to be promoted rather than passed through. Returning "" for
 * input the host would reject keeps the refusal on this side, where the tab
 * can explain it, instead of surfacing a Rust error string.
 */
export function normalizeBrowserAddress(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return ""
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return ""
  // A scheme with no host ("https://") parses, but names no page to open.
  if (!parsed.hostname) return ""
  return parsed.toString()
}
