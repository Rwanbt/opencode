/* SPDX-License-Identifier: MIT */
/**
 * Real runtime for the knowledge CLI (cards C1 and C16).
 *
 * `unifia-knowledge.ts` used to build its registry from two notes declared
 * inline, so `search` answered from a synthetic corpus: two unrelated queries
 * both returned `hits=2 scanned=2`. It also built its provider plan as
 * `{ providerId: "x", defaultRestriction: "allow" }`, bypassing the
 * operator's policy entirely.
 *
 * Everything here resolves a real workspace, loads its policy, and mounts the
 * vault. Extracted into its own module so the dispatcher stops growing (the
 * CLI was 2048 lines against a 1500-line blocking budget).
 */

import { resolve } from "node:path"
import { composeKnowledgeService, type Composed } from "../../knowledge/facade/compose.js"
import {
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_SNIPPET_BYTES,
  DEFAULT_DEADLINE_MS_DESKTOP,
} from "@unifia/contracts/knowledge"

/**
 * Resolve the workspace a command should act on.
 *
 * Explicit argument first, then `UNIFIA_WORKSPACE`, then the working
 * directory. Always absolute: every downstream component refuses a relative
 * root rather than guessing.
 */
export function resolveWorkspace(explicit?: string): string {
  const raw = explicit ?? process.env.UNIFIA_WORKSPACE ?? process.cwd()
  return resolve(raw)
}

/**
 * Open a workspace for a read-only, on-device query.
 *
 * `local` is the honest destination for a CLI that prints to the operator's
 * own terminal: nothing leaves the machine, so a note restricted to
 * `remote_model: deny` is still readable here — while a note carrying
 * `local_model: deny` is not.
 */
export function openWorkspace(explicit?: string): Composed {
  return composeKnowledgeService({
    workspaceRoot: resolveWorkspace(explicit),
    providerId: "unifia-cli",
    destinationKind: "local",
  })
}

/**
 * Pull an optional workspace out of the arguments.
 *
 * Accepts `--workspace <path>` or a leading positional path, so every
 * command takes it the same way. Returns the remaining arguments.
 */
export function takeWorkspace(rest: readonly string[]): {
  workspace: string | undefined
  args: string[]
} {
  const args = [...rest]
  const at = args.indexOf("--workspace")
  if (at !== -1) {
    const workspace = args[at + 1]
    args.splice(at, 2)
    return { workspace, args }
  }
  if (args[0] !== undefined && !args[0].startsWith("-")) {
    return { workspace: args[0], args: args.slice(1) }
  }
  return { workspace: undefined, args }
}

export async function cmdStatus(rest: readonly string[]): Promise<number> {
  const { workspace } = takeWorkspace(rest)
  const { service, policy, mounted, policyFromFile } = openWorkspace(workspace)
  const status = await service.status()
  process.stdout.write(
    [
      "Sovereign Knowledge Core V1 — status",
      `  workspace:  ${resolveWorkspace(workspace)}`,
      `  spaces:     ${mounted.join(", ") || "(none)"}`,
      `  notes:      ${status.candidatesCount}`,
      `  index:      ${status.indexVersion} (linear scan over Class A)`,
      `  fts:        ${status.enabled.fts ? "enabled" : "disabled (no FTS5 runtime in V1)"}`,
      `  vector:     ${status.enabled.vector ? "enabled" : "disabled (no embedding model)"}`,
      `  graph:      ${status.enabled.graph ? "enabled (resolved from Class A)" : "disabled"}`,
      `  egress:     ${policy.egress} (${policyFromFile ? ".unifia/policy.json" : "built-in default, no policy file"})`,
      "",
    ].join("\n"),
  )
  return 0
}

export async function cmdSources(rest: readonly string[]): Promise<number> {
  const { workspace } = takeWorkspace(rest)
  const { registry } = openWorkspace(workspace)
  const all = registry.all()
  if (all.length === 0) {
    process.stdout.write("no sources mounted\n")
    return 0
  }
  for (const s of all) {
    process.stdout.write(`- ${s.space.kind}  id=${s.space.id}  label=${s.space.label}\n`)
  }
  return 0
}

export async function cmdSearch(rest: readonly string[]): Promise<number> {
  // `--workspace <path>` is optional; everything else is the query. A bare
  // leading path is not consumed here: it would swallow the first word.
  const args = [...rest]
  let workspace: string | undefined
  const wsAt = args.indexOf("--workspace")
  if (wsAt !== -1) {
    workspace = args[wsAt + 1]
    args.splice(wsAt, 2)
  }

  const query = args.join(" ").trim()
  if (query.length === 0) {
    process.stderr.write("search: missing query\n")
    return 2
  }

  const { service } = openWorkspace(workspace)
  const { pack, truncated } = await service.search({
    query,
    spaces: [],
    types: [],
    tags: [],
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    maxSnippetBytes: DEFAULT_MAX_SNIPPET_BYTES,
    deadlineMs: DEFAULT_DEADLINE_MS_DESKTOP,
  })

  process.stdout.write(
    `query=${JSON.stringify(query)}  hits=${pack.items.length}  scanned=${pack.diagnostics.candidatesScanned}` +
      `  dropped=${pack.diagnostics.candidatesDroppedByRestriction}${truncated ? "  (truncated)" : ""}\n`,
  )
  for (const item of pack.items) {
    const snippet = item.snippet.replace(/\s+/g, " ").slice(0, 100)
    process.stdout.write(
      `  ${item.relevance.toFixed(2)}  ${item.ref.locator}  [${item.type}/${item.temporalState ?? "?"}]  ${snippet}\n`,
    )
  }
  return 0
}
