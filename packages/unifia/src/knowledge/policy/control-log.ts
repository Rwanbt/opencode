/* SPDX-License-Identifier: MIT */
/**
 * Persistent Class C control log (ADR-KNOW-0006 §6, R-0012, R-0015).
 *
 * The in-memory audit closed "every decision is emitted". It did not close
 * "every decision is auditable": the trail died with the process, so nobody
 * could answer *did this note ever leave?* after a crash, a restart, or an
 * incident. For a product whose central invariant is sovereignty, a
 * non-persistent trail is not a V2 nicety — it is the control that makes the
 * invariant checkable at all.
 *
 * ## What is recorded, and what is not
 *
 * An entry carries the content **hash**, the destination, the decision, the
 * reason, the guard version and a timestamp. It never carries the note body,
 * a snippet, a token, or a locator: a log that quotes what it refused to
 * release would leak exactly what the guard withheld. The hash is enough to
 * answer "did *this* content go there", which is the question an audit has
 * to answer.
 *
 * ## Why it batches, stated plainly
 *
 * The first version fsynced every entry. Measured on the development
 * machine that is **10.9 ms per decision**, and `backlinks()` takes one
 * decision per note in the vault — eleven seconds of audit on a thousand
 * notes. An audit that slow is an audit an operator turns off, which is
 * strictly worse than a bounded window.
 *
 * So entries buffer and a `flush()` writes the batch in one durable append.
 * The cost is explicit: **a crash loses at most the entries since the last
 * flush** — the current request's, at most `FLUSH_AT_ENTRIES` of them. That
 * window is the price of a trail that is actually kept. Callers flush at
 * request boundaries; `flushOnExit` covers an orderly shutdown.
 *
 * What is *not* traded away: a flush is a single fsynced append, so an entry
 * that reached disk is on the physical device, and a torn tail cannot
 * corrupt the next batch (`appendLineDurable` re-separates).
 */

import { existsSync, readFileSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { DomainBus, DomainEvent } from "../events/bus.js"
import { appendLineDurable } from "../mutation/durability.js"
import type { EgressAudit, EgressAuditEntry } from "./audit.js"

/** Where the control log lives inside a workspace. */
export const CONTROL_LOG_FILE = ".unifia/control-log.jsonl"

/** Flush once the buffer reaches this, so the window stays bounded. */
export const FLUSH_AT_ENTRIES = 64

/**
 * Rotate past this size.
 *
 * An append-only log that nothing bounds fills the disk and, worse, becomes
 * too slow to read — an audit nobody can open is not an audit. Rotation keeps
 * one previous generation rather than deleting: erasing an audit trail is not
 * something this module decides on its own.
 */
export const ROTATE_AT_BYTES = 8 * 1024 * 1024

export interface ControlLogReadOptions {
  /** Only entries at or after this ISO-8601 instant. */
  since?: string
  /** Only decisions of this kind. */
  decision?: "allow" | "deny"
  /** Only entries about this content hash. */
  hash?: string
}

/**
 * Audit sink that writes to disk and emits on the bus.
 *
 * Bus emission is immediate — a subscriber watching decisions live must not
 * wait for a flush. Only the durable write batches.
 */
export class PersistentEgressAudit implements EgressAudit {
  private readonly pending: EgressAuditEntry[] = []
  private exitHookInstalled = false
  private failure: Error | null = null

  constructor(
    private readonly workspaceRoot: string,
    private readonly bus?: DomainBus,
  ) {}

  get file(): string {
    return join(this.workspaceRoot, CONTROL_LOG_FILE)
  }

  record(entry: EgressAuditEntry): void {
    // A trail that has stopped recording must stop the traffic it cannot
    // describe. Serving content while unable to say where it went is the
    // precise failure this module exists to prevent, so a broken log is a
    // loud error rather than a silent degradation.
    if (this.failure !== null) {
      throw new Error(`egress control log is unwritable: ${this.failure.message}`)
    }
    this.pending.push(entry)
    if (this.pending.length >= FLUSH_AT_ENTRIES) this.flush()

    if (this.bus === undefined) return
    const event: DomainEvent = {
      id: randomUUID(),
      kind: "egress.decision",
      timestamp: entry.timestamp,
      payload: {
        hash: entry.hash,
        destination: entry.destination,
        decision: entry.decision,
        reason: entry.reason,
        guardVersion: entry.guardVersion,
      },
    }
    this.bus.emit(event)
  }

  /** Entries recorded but not yet on disk. */
  get pendingCount(): number {
    return this.pending.length
  }

  /**
   * Write everything buffered, in one fsynced append.
   *
   * Idempotent and safe to call when nothing is pending, so a caller can put
   * it at the end of every request without checking.
   */
  flush(): void {
    if (this.pending.length === 0) return
    this.rotateIfLarge()
    // Serialised field by field rather than spread: a future field added to
    // EgressAuditEntry must be considered here before it reaches the log, so
    // a snippet or a token cannot arrive by accident.
    const batch = this.pending
      .map((entry) =>
        JSON.stringify({
          hash: entry.hash,
          destination: entry.destination,
          decision: entry.decision,
          reason: entry.reason,
          guardVersion: entry.guardVersion,
          timestamp: entry.timestamp,
        }),
      )
      .join("\n")
    const written = this.pending.splice(0, this.pending.length)
    try {
      appendLineDurable(this.file, batch)
    } catch (error) {
      // Put them back. A partially-landed batch could now be recorded twice,
      // and that is the trade taken deliberately: for an audit, a duplicated
      // entry is a nuisance and a lost one is a hole.
      this.pending.unshift(...written)
      this.failure = error instanceof Error ? error : new Error(String(error))
      throw this.failure
    }
  }

  /** Set once a write has failed; the sink refuses to record after that. */
  get broken(): Error | null {
    return this.failure
  }

  /**
   * Flush when the process ends normally.
   *
   * `exit` only, and only synchronous work: a hook that promises to catch a
   * `SIGKILL` or a power loss would be a false guarantee. The bounded window
   * documented above is the real one.
   *
   * Registration goes through one shared listener rather than one per sink:
   * a long-lived daemon composes a service per workspace, and a listener each
   * would trip Node's max-listeners warning and then leak them.
   */
  flushOnExit(): void {
    if (this.exitHookInstalled) return
    this.exitHookInstalled = true
    registerForExitFlush(this)
  }

  /**
   * Read the trail back, oldest first, including anything still buffered.
   *
   * Tolerates a torn final line for the same reason the WAL does: a crash
   * mid-append must not make every earlier entry unreadable.
   */
  entries(options: ControlLogReadOptions = {}): EgressAuditEntry[] {
    const out: EgressAuditEntry[] = []
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (line.trim().length === 0) continue
        let entry: EgressAuditEntry
        try {
          entry = JSON.parse(line) as EgressAuditEntry
        } catch {
          continue
        }
        if (matches(entry, options)) out.push(entry)
      }
    }
    for (const entry of this.pending) {
      if (matches(entry, options)) out.push(entry)
    }
    return out
  }

  /** How many decisions went each way over the whole trail. */
  tally(options: ControlLogReadOptions = {}): { allow: number; deny: number } {
    let allow = 0
    let deny = 0
    for (const e of this.entries(options)) {
      if (e.decision === "allow") allow += 1
      else deny += 1
    }
    return { allow, deny }
  }

  /**
   * Answer the question an audit exists for: did this content ever leave,
   * and where to.
   */
  destinationsFor(
    hash: string,
  ): Array<{ destination: string; decision: "allow" | "deny"; timestamp: string }> {
    return this.entries({ hash }).map((e) => ({
      destination: e.destination,
      decision: e.decision,
      timestamp: e.timestamp,
    }))
  }

  private rotateIfLarge(): void {
    try {
      if (statSync(this.file).size < ROTATE_AT_BYTES) return
      renameSync(this.file, `${this.file}.1`)
    } catch {
      // No file yet, or rotation is not possible; appending still works.
    }
  }
}

/**
 * Sinks to flush at exit, held weakly.
 *
 * A strong set would keep every composition alive for the life of the
 * process — the audit trail is not a reason to leak the vault it describes.
 */
const exitFlushSet = new Set<WeakRef<PersistentEgressAudit>>()
let exitHook: (() => void) | null = null

function registerForExitFlush(sink: PersistentEgressAudit): void {
  exitFlushSet.add(new WeakRef(sink))
  if (exitHook !== null) return
  exitHook = () => {
    for (const ref of exitFlushSet) {
      try {
        ref.deref()?.flush()
      } catch {
        // Nothing useful can be reported from an exit handler, and throwing
        // here would mask the real reason the process is ending.
      }
    }
  }
  process.on("exit", exitHook)
}

function matches(entry: EgressAuditEntry, options: ControlLogReadOptions): boolean {
  if (options.decision !== undefined && entry.decision !== options.decision) return false
  if (options.hash !== undefined && entry.hash !== options.hash) return false
  if (options.since !== undefined && entry.timestamp < options.since) return false
  return true
}
