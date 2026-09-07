/* SPDX-License-Identifier: MIT */
/**
 * The memory vault, as the application sees it.
 *
 * `composeKnowledgeService` turns a workspace path into a working service,
 * and until now the only caller was the CLI. That is why the Sovereign
 * Knowledge Core could be correct, tested and shipped, and still not be a
 * feature: nothing inside the agent ever asked it a question.
 *
 * This module is the one place that answers *which directory is the memory,
 * and what may it say to the model currently running*. The tools
 * (`memory_search`, `memory_read`, `memory_write`) and the automatic recall
 * in the system prompt all go through here, so they cannot disagree about
 * the vault, the destination, or the policy that governs it.
 *
 * Deliberately free of any dependency on the config service: it takes a
 * plain settings object. The knowledge core must not learn about the
 * application's configuration layer in order to be usable by it.
 */

import { existsSync, mkdirSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import type { DestinationKind } from "@unifia/contracts/knowledge"
import { composeKnowledgeService, type Composed } from "../facade/compose.js"
import { DEFAULT_POLICY, POLICY_FILE, writePolicy } from "../policy/store.js"

/**
 * Where the memory lives when the user names no directory.
 *
 * Inside `.unifia/` rather than at the worktree root: the vault must be a
 * directory of notes and nothing else. Pointing the core at the repository
 * itself would mount every source file as a project-space note — thousands
 * of candidates per query, past the measured retrieval cliff (R-0018), to
 * answer questions the code search tools already answer better.
 */
export const DEFAULT_MEMORY_DIRECTORY = ".unifia/memory"

/** Recall bounds. Small on purpose: this budget is spent on every turn. */
export const DEFAULT_RECALL_MAX_NOTES = 5
export const DEFAULT_RECALL_DEADLINE_MS = 1_500

/** The application settings this module needs. Mirrors `config.memory`. */
export interface MemorySettings {
  enabled?: boolean
  directory?: string
  remote_recall?: boolean
  max_notes?: number
  deadline_ms?: number
}

export interface OpenMemoryInput {
  /** Project root, used to resolve a relative memory directory. */
  worktree: string
  settings?: MemorySettings | undefined
  /** Provider the retrieved notes are bound for. */
  providerId: string
  /** Whether that provider runs on this machine. */
  destinationKind: DestinationKind
  /** Enable Class A writes. Off unless the caller is the write path. */
  writable?: boolean
  /**
   * Create the vault when it does not exist yet.
   *
   * Only the write path passes this. A recall must never bring a directory
   * into being as a side effect of asking a question.
   */
  create?: boolean
}

/** Resolve the memory directory, absolute. */
export function resolveMemoryRoot(worktree: string, settings?: MemorySettings): string {
  const configured = settings?.directory
  if (configured === undefined || configured.trim() === "") {
    return join(worktree, DEFAULT_MEMORY_DIRECTORY)
  }
  return isAbsolute(configured) ? resolve(configured) : resolve(worktree, configured)
}

/** True unless the user turned memory off. Opt-out, not opt-in. */
export function memoryEnabled(settings?: MemorySettings): boolean {
  return settings?.enabled !== false
}

interface CacheEntry {
  composed: Composed
  /** Policy file mtime when this composition was built; 0 when absent. */
  policyMtimeMs: number
}

/**
 * One composition per (vault, destination, writability).
 *
 * Recomposing per call would be cheap in itself — no directory is scanned —
 * but each composition registers its control log for the exit flush, and a
 * long-lived server would accumulate one registration per tool call.
 *
 * The policy file's mtime is part of the validity of an entry, so editing
 * `.unifia/policy.json` takes effect on the next call rather than on the
 * next restart.
 */
const cache = new Map<string, CacheEntry>()

function policyMtime(root: string): number {
  try {
    return statSync(join(root, POLICY_FILE)).mtimeMs
  } catch {
    // Absent is a legitimate state — the built-in default policy applies —
    // and 0 distinguishes it from any mtime a real file can carry.
    return 0
  }
}

/**
 * Seed a fail-closed policy in a vault this process just created.
 *
 * Deliberately free of any destination entry, including one derived from
 * `remote_recall`. Baking that setting into the file at creation time made
 * it a decision the user could take exactly once: flipping the setting later
 * changed nothing, silently, because a policy file now existed and the file
 * is the authority. The setting travels as `operatorEgress` on every open
 * instead, so it stays a setting.
 *
 * An existing vault — the user's own Obsidian vault, say — is never seeded:
 * it keeps whatever posture it has, or none.
 */
function seedPolicy(root: string): void {
  writePolicy(root, { ...DEFAULT_POLICY, updatedAt: new Date().toISOString() })
}

/**
 * The destination entry the application's own settings contribute.
 *
 * Only ever an `allow` for the one destination in play, and only when the
 * user asked for it. Nothing here can deny — a refusal already comes from
 * the default posture.
 */
function operatorEgressFrom(
  providerId: string,
  destinationKind: DestinationKind,
  settings: MemorySettings | undefined,
): Record<string, "allow" | "deny"> {
  if (settings?.remote_recall !== true || destinationKind === "local") return {}
  return { [`provider:${providerId}:remote`]: "allow" }
}

/**
 * Open the memory vault, or return undefined when there is nothing to open.
 *
 * Undefined means *no memory yet*, which is a normal state — a fresh project
 * has written nothing. It never hides a failure: a vault that exists but
 * cannot be composed throws.
 */
export function openMemory(input: OpenMemoryInput): Composed | undefined {
  if (!memoryEnabled(input.settings)) return undefined

  const root = resolveMemoryRoot(input.worktree, input.settings)
  if (!existsSync(root)) {
    if (input.create !== true) return undefined
    mkdirSync(root, { recursive: true })
    seedPolicy(root)
  }

  const operatorEgress = operatorEgressFrom(input.providerId, input.destinationKind, input.settings)
  // The operator setting is part of what a composition *is*, so it belongs
  // in the key. Leaving it out would serve a cached remote-denying plan
  // after the user turned recall on: the same silent no-op, one layer down.
  const key = [
    root,
    input.providerId,
    input.destinationKind,
    input.writable === true,
    Object.keys(operatorEgress).length > 0,
  ].join(" ")
  const mtime = policyMtime(root)
  const hit = cache.get(key)
  if (hit !== undefined && hit.policyMtimeMs === mtime) return hit.composed

  const composed = composeKnowledgeService({
    workspaceRoot: root,
    providerId: input.providerId,
    destinationKind: input.destinationKind,
    operatorEgress,
    ...(input.writable === true ? { writable: true } : {}),
  })
  cache.set(key, { composed, policyMtimeMs: mtime })
  return composed
}

/** Drop every cached composition, flushing their trails. For tests. */
export function resetMemoryCache(): void {
  for (const entry of cache.values()) entry.composed.controlLog?.flush()
  cache.clear()
}
