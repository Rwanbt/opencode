/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * File-backed `DurableHistoryAuthority` (M1-10).
 *
 * Wraps `InMemoryDurableHistoryAuthority` with a JSON-on-disk
 * snapshot. The snapshot is written atomically (write to temp,
 * rename) at every accepted `transition`. On construction, the
 * authority reads the snapshot (if any) and rebuilds the in-memory
 * state. This gives:
 *
 *   - Crash recovery: the next process boot reads the last snapshot.
 *   - Determinism: a JSON snapshot round-trips through the same
 *     in-memory state.
 *   - Simplicity: no SQLite, no external dependency. The file format
 *     is the M1-09 in-memory state shape, JSON-encoded.
 *
 * Per ADR-031 §"Implémentation":
 *   - Atomic snapshot on every accepted transition.
 *   - Replay is deterministic and idempotent.
 *   - Validation at boot: if the snapshot is unreadable, fail
 *     closed (no silent partial state).
 *
 * Per ADR-031 §"Non-décisions": this is single-process / single-node
 * persistence. The replication topology (Raft, etc.) is a post-M0
 * decision.
 *
 * Per ADR-031 §"Aucun contrat M1-10 n'est ajouté à WorkspaceConfig":
 * the file-backed authority uses its own files at `options.snapshotPath`,
 * not the workspace.
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type {
  AtomicTransitionBoundary,
  DurableAuthorityKind,
  MaterializedRunProjection,
  OverlapPolicy,
  WorkflowRun,
} from "@unifia/contracts"
import {
  WorkflowRunSchema,
  AtomicTransitionBoundarySchema,
} from "@unifia/contracts"
import {
  InMemoryDurableHistoryAuthority,
  IllegalTransitionError,
  RunNotFoundError,
  type CommandEnvelope,
  type TimerEnvelope,
} from "./in-memory"
import type { DurableHistoryAuthority } from "./adapter"
import type { AuthorityToken } from "./authority.js"

// ============================================================================
// Snapshot shape
// ============================================================================

interface RunSnapshot {
  run: WorkflowRun
  commands: CommandEnvelope[]
  timers: TimerEnvelope[]
  history: AtomicTransitionBoundary[]
}

interface AuthoritySnapshot {
  /** File format version. Bump on incompatible changes. */
  version: 1
  /** Authority kind recorded when the snapshot was written. */
  authorityKind: DurableAuthorityKind
  /** All runs in this authority, keyed by runId. */
  runs: Record<string, RunSnapshot>
}

// ============================================================================
// Options
// ============================================================================

export interface FileBackedHistoryAuthorityOptions {
  /** Authority kind to record on newly created runs. */
  readonly authorityKind: DurableAuthorityKind
  /** File path for the JSON snapshot. */
  readonly snapshotPath: string
  /** Verbose mode: log every snapshot write. */
  readonly verbose?: boolean
}

// ============================================================================
// File-backed implementation
// ============================================================================

export class FileBackedDurableHistoryAuthority implements DurableHistoryAuthority {
  private readonly inner: InMemoryDurableHistoryAuthority
  private readonly options: FileBackedHistoryAuthorityOptions
  private readonly authorityKind: DurableAuthorityKind
  private snapshotWritten = false
  private lastSnapshotAt = 0

  constructor(options: FileBackedHistoryAuthorityOptions) {
    this.options = options
    this.authorityKind = options.authorityKind
    this.inner = new InMemoryDurableHistoryAuthority({
      authorityKind: options.authorityKind,
      verbose: options.verbose,
    })
  }

  /**
   * Register a new run. Mirrors the InMemory helper; useful for tests
   * and for bootstrapping. Writes a snapshot immediately so the
   * registration survives a crash.
   */
  async register(run: WorkflowRun): Promise<void> {
    this.inner.register(run)
    await this.writeSnapshot()
  }

  /**
   * Load the snapshot from disk (if any) and rebuild the in-memory
   * state. Fail closed on read errors. This is a synchronous-feeling
   * async step that must be awaited before any other method.
   */
  async load(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.options.snapshotPath, "utf-8")
    } catch (err: unknown) {
      // File doesn't exist yet = first boot, no error.
      if (isNoEnt(err)) return
      // Any other read error = fail closed per ADR-031.
      throw new Error(
        `FileBackedDurableHistoryAuthority: failed to read snapshot at ${this.options.snapshotPath}: ${String(err)}`,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err: unknown) {
      throw new Error(
        `FileBackedDurableHistoryAuthority: snapshot is not valid JSON: ${String(err)}`,
      )
    }
    if (!isAuthoritySnapshot(parsed)) {
      throw new Error(
        `FileBackedDurableHistoryAuthority: snapshot is not a valid AuthoritySnapshot (missing fields)`,
      )
    }
    for (const [runId, snap] of Object.entries(parsed.runs)) {
      this.inner.register(snap.run)
      this.inner.restore(snap)
    }
    this.lastSnapshotAt = Date.now()
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    return this.inner.getRun(runId)
  }

  async transition(token: AuthorityToken, runId: string, event: AtomicTransitionBoundary): Promise<void> {
    await this.inner.transition(token, runId, event)
    await this.writeSnapshot()
  }

  async enqueueCommand(
    token: AuthorityToken,
    runId: string,
    command: { kind: string; payload: unknown },
  ): Promise<void> {
    await this.inner.enqueueCommand(token, runId, command)
    await this.writeSnapshot()
  }

  async scheduleTimer(
    token: AuthorityToken,
    timerId: string,
    runId: string,
    fireAt: number,
    overlapPolicy: OverlapPolicy,
  ): Promise<void> {
    await this.inner.scheduleTimer(token, timerId, runId, fireAt, overlapPolicy)
    await this.writeSnapshot()
  }

  async getMaterializedProjection(
    runId: string,
  ): Promise<MaterializedRunProjection | null> {
    return this.inner.getMaterializedProjection(runId)
  }

  /**
   * Force a snapshot write. Useful for tests + recovery drills.
   */
  async flush(): Promise<void> {
    await this.writeSnapshot()
  }

  /**
   * Internal: write the current in-memory state to disk atomically
   * (write-to-temp + rename). Per ADR-031, this is the only way
   * persistence is allowed to happen — never write the canonical
   * file in place.
   */
  private async writeSnapshot(): Promise<void> {
    const snapshot = this.collectSnapshot()
    const json = JSON.stringify(snapshot, null, 2)
    const tmp = `${this.options.snapshotPath}.tmp-${process.pid}-${Date.now()}`
    const dir = dirname(this.options.snapshotPath)
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, json, "utf-8")
    await rename(tmp, this.options.snapshotPath)
    this.snapshotWritten = true
    this.lastSnapshotAt = Date.now()
    if (this.options.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[file-backed] snapshot written: ${this.options.snapshotPath} (${json.length} bytes)`)
    }
  }

  /**
   * Collect the current in-memory state into an AuthoritySnapshot.
   * This requires reading from the inner authority via its public
   * methods. We re-use the inspection helpers registered on the
   * inner authority.
   */
  private collectSnapshot(): AuthoritySnapshot {
    // The inner authority exposes the runs via getRun. For snapshot
    // purposes we need to enumerate all runs. The inner class keeps
    // a private Map; for now we expose a snapshot() method on the
    // inner class (or we duplicate the logic). To keep the surface
    // small, we add a private accessor on InMemoryDurableHistoryAuthority.
    return {
      version: 1,
      authorityKind: this.authorityKind,
      runs: this.inner.snapshot(),
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function isNoEnt(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "ENOENT"
  )
}

function isAuthoritySnapshot(x: unknown): x is AuthoritySnapshot {
  if (typeof x !== "object" || x === null) return false
  const o = x as Record<string, unknown>
  return (
    o.version === 1 &&
    typeof o.authorityKind === "string" &&
    typeof o.runs === "object" &&
    o.runs !== null
  )
}

// Re-export errors for callers
export { IllegalTransitionError, RunNotFoundError }
