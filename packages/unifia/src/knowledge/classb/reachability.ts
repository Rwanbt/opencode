/* SPDX-License-Identifier: MIT */
/**
 * Class B reachability scan over a real directory (P2.7).
 *
 * Per runbook §12 P2.4: "Copy-on-write des révisions Class B,
 * invariant OLD VALID/NEW VALID/VALID + orphan harmless. GC
 * uniquement en Admin Task sous lock exclusif avec reachability
 * revalidée."
 *
 * Given a workspace root, this module:
 *  - reads the portable store (`.unifia/portable/store.json`);
 *  - scans the actual Markdown files on disk (Class A);
 *  - reports which Class B entries are reachable, which are
 *    orphans, and which Class A files lack a Class B sidecar.
 *
 * The scan is read-only: no mutation, no GC. The result is a
 * `ReachabilityScan` that the operator can review.
 */

import { readdirSync, statSync, existsSync } from "node:fs"
import { resolve, relative, join, isAbsolute } from "node:path"
import { readPortableStore, type PortableStore } from "./portable-store.js"

export interface ReachabilityScan {
  workspaceRoot: string
  classALocators: string[]
  classBEntries: Array<{ alias: string; locator: string; revision: number }>
  /** Class B entries whose locator exists in Class A. */
  reachable: string[]
  /** Class B entries whose locator does NOT exist in Class A. */
  orphans: string[]
  /** Class A files that have no Class B sidecar. */
  missingSidecars: string[]
  /** Total elapsed ms. */
  durationMs: number
}

/** Walk a directory recursively and yield `.md` file locators. */
export function listMarkdownLocators(root: string): string[] {
  if (!isAbsolute(root)) {
    throw new Error(`root must be absolute, got ${root}`)
  }
  const out: string[] = []
  walk(root, root, out)
  return out
}

function walk(root: string, dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === ".git" || name === ".unifia" || name === "node_modules") continue
    const full = join(dir, name)
    let s: ReturnType<typeof statSync>
    try {
      s = statSync(full)
    } catch {
      continue
    }
    if (s.isDirectory()) walk(root, full, out)
    else if (s.isFile() && name.endsWith(".md")) {
      const rel = relative(root, full).replace(/\\/g, "/")
      out.push(rel)
    }
  }
}

/** Run a reachability scan. */
export function scanReachability(workspaceRoot: string): ReachabilityScan {
  const t0 = Date.now()
  if (!isAbsolute(workspaceRoot)) {
    throw new Error(`workspaceRoot must be absolute, got ${workspaceRoot}`)
  }
  const store: PortableStore = existsSync(resolve(workspaceRoot, ".unifia/portable/store.json"))
    ? readPortableStore(workspaceRoot)
    : { entries: {}, version: 1, updatedAt: "" }

  const classA = new Set<string>(listMarkdownLocators(workspaceRoot))

  const reachable: string[] = []
  const orphans: string[] = []
  const classBEntries: Array<{ alias: string; locator: string; revision: number }> = []
  const bLocators = new Set<string>()

  for (const e of Object.values(store.entries)) {
    classBEntries.push({ alias: e.alias, locator: e.locator, revision: e.revision })
    bLocators.add(e.locator)
    if (classA.has(e.locator)) reachable.push(e.locator)
    else orphans.push(e.locator)
  }

  const missingSidecars: string[] = []
  for (const a of classA) {
    if (!bLocators.has(a)) missingSidecars.push(a)
  }

  return {
    workspaceRoot,
    classALocators: [...classA].sort(),
    classBEntries,
    reachable,
    orphans,
    missingSidecars,
    durationMs: Date.now() - t0,
  }
}
