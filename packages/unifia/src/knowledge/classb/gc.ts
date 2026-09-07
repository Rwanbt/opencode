/* SPDX-License-Identifier: MIT */
/**
 * Class B GC recommendation (P2.8).
 *
 * Per runbook §12 P2.4: "GC uniquement en Admin Task sous lock
 * exclusif avec reachability revalidée."
 *
 * V1 ships a *recommendation* only. The actual GC is performed
 * by the operator after a manual review; V1 never deletes
 * Class B entries automatically.
 *
 * The recommendation:
 *  - flags orphans (Class B without Class A) as candidates;
 *  - reports the count of reachable / orphan / missing-sidecar;
 *  - produces a `GcRecommendation` that the operator can apply
 *    (after revalidation) via `applyGcRecommendation`.
 */

import { listMarkdownLocators } from "./reachability.js"
import { readPortableStore, writePortableStore, type PortableStore } from "./portable-store.js"
import { isAbsolute } from "node:path"

export interface GcRecommendation {
  workspaceRoot: string
  /** Aliases that are orphans (Class B without Class A). */
  orphanAliases: string[]
  /** Aliases that are reachable (Class B with Class A). */
  reachableAliases: string[]
  /** Class A files that lack a Class B sidecar. */
  missingSidecarLocators: string[]
  /** Recommended action summary. */
  action: "noop" | "remove-orphans" | "rebuild-class-b"
  /** True if a GC would be a no-op. */
  safeToApply: boolean
}

export function recommendGc(workspaceRoot: string): GcRecommendation {
  if (!isAbsolute(workspaceRoot)) {
    throw new Error(`workspaceRoot must be absolute, got ${workspaceRoot}`)
  }
  const classA = new Set<string>(listMarkdownLocators(workspaceRoot))
  const store: PortableStore = readPortableStore(workspaceRoot)

  const orphanAliases: string[] = []
  const reachableAliases: string[] = []
  const bLocators = new Set<string>()

  for (const [alias, entry] of Object.entries(store.entries)) {
    bLocators.add(entry.locator)
    if (classA.has(entry.locator)) reachableAliases.push(alias)
    else orphanAliases.push(alias)
  }

  const missingSidecarLocators: string[] = []
  for (const a of classA) {
    if (!bLocators.has(a)) missingSidecarLocators.push(a)
  }

  let action: GcRecommendation["action"]
  if (orphanAliases.length === 0 && missingSidecarLocators.length === 0) action = "noop"
  else if (missingSidecarLocators.length === 0) action = "remove-orphans"
  else action = "rebuild-class-b"

  // The GC is safe to apply if there are no missing sidecars
  // (otherwise the user might prefer a rebuild over a removal).
  const safeToApply = missingSidecarLocators.length === 0

  return {
    workspaceRoot,
    orphanAliases,
    reachableAliases,
    missingSidecarLocators,
    action,
    safeToApply,
  }
}

/** Apply a GC recommendation. Removes orphan entries. */
export function applyGcRecommendation(
  workspaceRoot: string,
  rec: GcRecommendation,
): PortableStore {
  if (!isAbsolute(workspaceRoot)) {
    throw new Error(`workspaceRoot must be absolute, got ${workspaceRoot}`)
  }
  if (!rec.safeToApply) {
    throw new Error(
      "refusing to apply GC: there are missing sidecars; rebuild Class B first",
    )
  }
  if (rec.action === "noop") {
    return readPortableStore(workspaceRoot)
  }
  const store = readPortableStore(workspaceRoot)
  const next: PortableStore = {
    entries: { ...store.entries },
    version: 1,
    updatedAt: new Date().toISOString(),
  }
  for (const alias of rec.orphanAliases) {
    delete next.entries[alias]
  }
  writePortableStore(workspaceRoot, next)
  return next
}
