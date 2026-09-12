/* SPDX-License-Identifier: MIT */

import type { ArtifactSummary, ExportedArtifact } from "./client.js"

export type ArtifactVersionSummary = ArtifactSummary & { sha256: string; relativePath: string; scan?: "clean" | "unscanned" }
export type ArtifactDiff = { changed: readonly string[]; added: readonly string[]; removed: readonly string[] }
export type ArtifactVersionPanelState = { history: readonly ArtifactVersionSummary[]; selectedVersion?: number; provenance?: Record<string, string>; export: { approved: boolean; result?: ExportedArtifact } }

export function createArtifactVersionPanelState(history: readonly ArtifactVersionSummary[], selectedVersion?: number, exportResult?: ExportedArtifact): ArtifactVersionPanelState {
  const ordered = [...history].sort((left, right) => left.version - right.version)
  const selected = ordered.find((artifact) => artifact.version === selectedVersion) ?? ordered.at(-1)
  return { history: ordered, selectedVersion: selected?.version, provenance: selected?.provenance, export: { approved: exportResult !== undefined, result: exportResult } }
}

export function diffArtifactVersions(previous: ArtifactVersionSummary | undefined, current: ArtifactVersionSummary | undefined): ArtifactDiff {
  if (!previous && !current) return { changed: [], added: [], removed: [] }
  if (!previous && current) return { changed: [], added: ["artifact"], removed: [] }
  if (previous && !current) return { changed: [], added: [], removed: ["artifact"] }
  if (!previous || !current) throw new Error("unreachable artifact diff state")
  const left = previous
  const right = current
  const changed: string[] = []
  const fields: Array<keyof ArtifactVersionSummary> = ["kind", "filename", "bytes", "sha256", "metadata", "provenance", "scan"]
  for (const field of fields) if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) changed.push(field)
  return { changed, added: [], removed: [] }
}
