/* SPDX-License-Identifier: MIT */
/**
 * Class A writer (card C25).
 *
 * V1 had no write path at all: `MutationWriter` was an interface with no
 * implementation, so `knowledge_propose` could only refuse. A memory layer
 * that cannot remember is not a memory layer.
 *
 * Every mutation here:
 * - is validated against `MutationIntentSchema`;
 * - is confined to the workspace on resolved real paths, shared with the
 *   reader so the two cannot disagree about the boundary;
 * - is refused when the body carries a credential (ADR-KNOW-0006 §5);
 * - honours compare-and-swap on the observed version hash;
 * - is recorded in an append-only WAL before the file is made visible;
 * - is applied atomically (write to a temporary file, then rename).
 *
 * `delete` removes the note from the vault the way Obsidian does: it leaves
 * its locator and moves to `.unifia/trash/`, recorded in the WAL and
 * restorable by audit id. P10 forbids a *silent* destructive operation, and
 * a recorded reversible move is neither — see the ADR-KNOW-0009 amendment of
 * 2026-08-30. `archive` remains distinct: it retires a note from retrieval
 * without removing it from the vault.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from "node:fs"
import * as fsp from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, isAbsolute, join } from "node:path"
import type {
  MutationIntent,
  MutationResult,
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeVersionHash,
  NoteFrontmatter,
} from "@unifia/contracts/knowledge"
import { MutationIntentSchema, portableRestrictionsToFrontmatter } from "@unifia/contracts/knowledge"
import { KnowledgeFailure } from "../domain/errors.js"
import { parseFrontmatter, serialiseNote } from "../parser/frontmatter.js"
import { classifyText } from "../context/dataflow.js"
import { isContained, wouldBeContained, realOrNull } from "../source/containment.js"
import { VaultSource } from "../source/vault.js"
import { isTransitionAllowed } from "../memory/lifecycle.js"
import type { WalEntry, WalKind } from "../wal/wal.js"
import { validateEntry } from "../wal/wal.js"
import type { MutationWriter } from "../facade/service.js"
import {
  TMP_SUFFIX,
  WriteLock,
  appendLineDurable,
  fsyncDirectory,
  readWalTolerant,
  recover,
  writeFileDurable,
  type RecoveryReport,
} from "./durability.js"

/** Where the append-only write-ahead log lives. */
export const WAL_FILE = ".unifia/wal.jsonl"

/** Serialises writers within and across processes. */
export const LOCK_FILE = ".unifia/write.lock"

/**
 * Where deleted notes go.
 *
 * Obsidian's default is a trash folder inside the vault, and that is the
 * behaviour V1 implements: a delete is reversible until the trash is emptied.
 * Emptying it is a separate, explicit operation — the only one that actually
 * destroys, and the one P10 asks the operator to confirm.
 */
export const TRASH_DIR = ".unifia/trash"

/** One entry in the trash. */
export interface TrashedNote {
  /** Where the note lived before it was deleted. */
  locator: string
  /** Audit id of the deletion; the handle a restore is addressed by. */
  auditId: string
  deletedAt: string
}

export interface VaultMutationWriterConfig {
  /** Absolute path to the vault root that receives the writes. */
  root: string
  /** Where new notes are created when the intent gives no locator. */
  inboxSubdir?: string
  /**
   * Reconcile the vault against its WAL on open. Defaults to true; only a
   * test that wants to observe an unrecovered state turns it off.
   */
  recoverOnOpen?: boolean
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex")
}

export class VaultMutationWriter implements MutationWriter {
  private readonly root: string
  private readonly realRoot: string
  private readonly inbox: string
  private readonly lock: WriteLock
  private readonly lastRecovery: RecoveryReport

  constructor(config: VaultMutationWriterConfig) {
    if (!isAbsolute(config.root)) {
      throw KnowledgeFailure.pathUnresolved(`vault root must be absolute, got ${config.root}`)
    }
    const real = realOrNull(config.root)
    if (real === null) {
      throw KnowledgeFailure.pathUnresolved(`vault root cannot be resolved: ${config.root}`)
    }
    this.root = config.root
    this.realRoot = real
    this.inbox = config.inboxSubdir ?? "inbox"
    this.lock = new WriteLock(join(config.root, LOCK_FILE))

    // Reconcile before the first write. A vault opened after a crash must not
    // be extended on top of an unfinished commit.
    this.lastRecovery = config.recoverOnOpen === false
      ? { completed: [], discarded: [], truncatedWalLines: 0 }
      : recover(config.root, WAL_FILE)
  }

  /** What the opening reconciliation did, for `doctor` and for tests. */
  recovery(): RecoveryReport {
    return this.lastRecovery
  }

  async apply(input: {
    intent: unknown
    reason: string
    source: string
  }): Promise<MutationResult> {
    const parsed = MutationIntentSchema.safeParse(input.intent)
    if (!parsed.success) {
      throw KnowledgeFailure.mutationRefused(
        `invalid mutation intent: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      )
    }
    const intent = parsed.data as MutationIntent

    const auditId = randomUUID()
    switch (intent.kind) {
      case "create":
        return this.create(intent, auditId)
      case "update":
        return this.update(intent, auditId)
      case "move":
        return this.move(intent, auditId)
      case "delete":
        return this.remove(intent, auditId)
      case "promote":
      case "supersede":
      case "archive":
      case "restore":
        return this.transition(intent, auditId)
      default:
        throw KnowledgeFailure.mutationRefused(`unsupported mutation kind: ${intent.kind}`)
    }
  }

  // -- kinds ---------------------------------------------------------------

  private async create(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const content = intent.newContent
    if (content === undefined) {
      throw KnowledgeFailure.mutationRefused("create requires newContent")
    }
    this.refuseCredentials(content.body)

    const locator = intent.targetLocator ?? `${this.inbox}/${auditId}.md`
    const full = this.resolveWritable(locator)
    if (existsSync(full)) {
      throw KnowledgeFailure.casMismatch("absent", "present")
    }

    const now = new Date().toISOString()
    const frontmatter: NoteFrontmatter = {
      unifia_schema: 1,
      unifia_id: (intent.targetId ?? randomUUIDv7()) as KnowledgeId,
      unifia_type: content.type,
      // A new note enters as a candidate: promotion is a separate, audited
      // step (ADR-KNOW-0009 §1), never a side effect of writing.
      unifia_lifecycle: "candidate",
      unifia_created_at: now,
      unifia_updated_at: now,
      unifia_project_ref: intent.source,
      unifia_supersedes: [],
      unifia_tags: intent.tags ?? [],
    }
    const restrictions = portableRestrictionsToFrontmatter(content.restrictions)
    if (Object.keys(restrictions).length > 0) {
      frontmatter.unifia_restrictions = restrictions
    }

    const raw = serialiseNote({ frontmatter, body: content.body, raw: "" })
    return this.commit("create", locator, full, raw, null, intent, auditId)
  }

  private async update(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const content = intent.newContent
    if (content === undefined) {
      throw KnowledgeFailure.mutationRefused("update requires newContent")
    }
    this.refuseCredentials(content.body)

    const { locator, full, raw: current } = await this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const note = parseFrontmatter(current)
    const next: NoteFrontmatter = {
      ...note.frontmatter,
      unifia_type: content.type,
      unifia_updated_at: new Date().toISOString(),
      unifia_tags: intent.tags ?? note.frontmatter.unifia_tags,
    }
    const restrictions = portableRestrictionsToFrontmatter(content.restrictions)
    if (Object.keys(restrictions).length > 0) next.unifia_restrictions = restrictions
    else delete next.unifia_restrictions

    const raw = serialiseNote({ frontmatter: next, body: content.body, raw: current })
    return this.commit("update", locator, full, raw, sha256(current), intent, auditId)
  }

  private async transition(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const { locator, full, raw: current } = await this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const note = parseFrontmatter(current)
    const from = note.frontmatter.unifia_lifecycle
    const to =
      intent.kind === "promote" || intent.kind === "restore"
        ? "active"
        : intent.kind === "archive"
          ? "archived"
          : "superseded"

    if (!isTransitionAllowed(from, to)) {
      throw KnowledgeFailure.mutationRefused(`transition ${from} -> ${to} is not allowed`)
    }

    const next: NoteFrontmatter = {
      ...note.frontmatter,
      unifia_lifecycle: to,
      unifia_updated_at: new Date().toISOString(),
    }

    if (intent.kind === "supersede") {
      return await this.supersede(intent, auditId, { locator, full, current, next, note })
    }

    const raw = serialiseNote({ frontmatter: next, body: note.body, raw: current })
    return this.commit(intent.kind as WalKind, locator, full, raw, sha256(current), intent, auditId)
  }

  /**
   * Mark `targetId` superseded and record the reference on its successor.
   *
   * This touches two files. `successorId` used to be validated by the schema
   * and then ignored: the target's own list was copied back onto itself, so
   * nothing recorded the replacement and the successor never learned it had
   * one.
   *
   * V1 has no multi-file transaction. The order is chosen so the recoverable
   * state is the tolerable one: the successor gains its reference first, then
   * the target is marked. A crash in between leaves a successor claiming to
   * replace a still-active note — visible to `doctor` and repairable — rather
   * than a superseded note nothing points at. Both writes share one auditId
   * so the WAL identifies them as one operation.
   */
  private async supersede(
    intent: MutationIntent,
    auditId: string,
    target: {
      locator: string
      full: string
      current: string
      next: NoteFrontmatter
      note: ReturnType<typeof parseFrontmatter>
    },
  ): Promise<MutationResult> {
    const successorId = intent.successorId
    if (successorId === undefined) {
      throw KnowledgeFailure.mutationRefused("supersede requires successorId")
    }
    if (successorId === intent.targetId) {
      throw KnowledgeFailure.mutationRefused("a note cannot supersede itself")
    }

    const successor = await this.locate(successorId as KnowledgeId)
    const successorNote = parseFrontmatter(successor.raw)

    // Refuse a cycle: the target must not already supersede the successor.
    if (target.note.frontmatter.unifia_supersedes.includes(successorId)) {
      throw KnowledgeFailure.mutationRefused(
        `supersession cycle: ${intent.targetId} already supersedes ${successorId}`,
      )
    }

    const targetId = intent.targetId as string
    if (!successorNote.frontmatter.unifia_supersedes.includes(targetId)) {
      const successorNext: NoteFrontmatter = {
        ...successorNote.frontmatter,
        unifia_supersedes: [...successorNote.frontmatter.unifia_supersedes, targetId],
        unifia_updated_at: new Date().toISOString(),
      }
      const successorRaw = serialiseNote({
        frontmatter: successorNext,
        body: successorNote.body,
        raw: successor.raw,
      })
      this.commit(
        "update",
        successor.locator,
        successor.full,
        successorRaw,
        sha256(successor.raw),
        intent,
        auditId,
      )
    }

    const raw = serialiseNote({
      frontmatter: target.next,
      body: target.note.body,
      raw: target.current,
    })
    return this.commit(
      "supersede",
      target.locator,
      target.full,
      raw,
      sha256(target.current),
      intent,
      auditId,
    )
  }

  /**
   * Remove a note from the vault, recorded and reversible.
   *
   * This is Obsidian's default meaning of "delete": the note leaves its
   * locator — gone from listings, retrieval and backlinks — and moves to a
   * trash folder rather than being unlinked. ADR-KNOW-0009's amendment of
   * 2026-08-30 records the decision: what P10 forbids is a *silent*
   * destructive operation, and a WAL-recorded, restorable move is neither
   * silent nor destructive.
   *
   * The WAL entry carries `newHash: null` because no content remains at the
   * locator — the existing invariant holds unchanged.
   */
  private async remove(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const { locator, full, raw: current } = await this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const trashed = join(this.root, TRASH_DIR, `${auditId}.md`)

    return this.lock.withLock(() => {
      mkdirSync(dirname(trashed), { recursive: true })

      // The sidecar records where it came from, so a restore does not have to
      // parse the WAL to know the destination.
      writeFileDurable(
        `${trashed}.origin.json`,
        JSON.stringify({ locator, auditId, deletedAt: new Date().toISOString() }, null, 2),
      )
      writeFileDurable(trashed, current)

      appendLineDurable(
        join(this.root, WAL_FILE),
        JSON.stringify({
          seq: this.nextSeq(),
          kind: "delete",
          locator,
          previousHash: sha256(current) as WalEntry["previousHash"],
          newHash: null,
          auditId,
          source: intent.source,
          reason: intent.reason,
          timestamp: new Date().toISOString(),
        } satisfies WalEntry),
      )

      // Only now does the note leave the vault: the copy and the record are
      // already durable, so a crash here loses nothing.
      unlinkSync(full)
      fsyncDirectory(dirname(full))

      const written = parseFrontmatter(current).frontmatter
      return {
        applied: true,
        auditId,
        ref: {
          id: written.unifia_id as KnowledgeId,
          locator: locator as KnowledgeLocator,
          versionHash: sha256(current) as KnowledgeVersionHash,
        },
      }
    })
  }

  /** What is in the trash, newest first. */
  trash(): TrashedNote[] {
    const dir = join(this.root, TRASH_DIR)
    if (!existsSync(dir)) return []
    const out: TrashedNote[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".origin.json")) continue
      try {
        const meta = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
          locator: string
          auditId: string
          deletedAt: string
        }
        out.push(meta)
      } catch {
        // A sidecar we cannot read is not a restorable entry.
      }
    }
    out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    return out
  }

  /**
   * Permanently destroy trashed notes. The only operation that truly erases.
   *
   * Deletion is reversible until this runs, which is what makes the delete
   * safe — and what makes this one dangerous. P10 asks for a confirmation
   * exactly here: `confirm` is required and must be `true`, so no caller
   * empties the trash by passing an options object it did not think about.
   *
   * The purge itself is recorded in the WAL. An erasure that left no trace
   * would be the silent destructive operation P10 forbids, only one level
   * further down.
   */
  async emptyTrash(options: {
    confirm: true
    /** Only destroy entries deleted more than this many days ago. */
    olderThanDays?: number
    /** Only destroy this one entry. */
    auditId?: string
    source?: string
  }): Promise<{ destroyed: TrashedNote[]; kept: TrashedNote[] }> {
    if (options.confirm !== true) {
      throw KnowledgeFailure.mutationRefused(
        "emptyTrash permanently destroys notes and requires confirm: true",
      )
    }

    const cutoff =
      options.olderThanDays === undefined
        ? undefined
        : Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000

    const destroyed: TrashedNote[] = []
    const kept: TrashedNote[] = []

    for (const entry of this.trash()) {
      const selected =
        (options.auditId === undefined || options.auditId === entry.auditId) &&
        (cutoff === undefined || Date.parse(entry.deletedAt) < cutoff)
      if (!selected) {
        kept.push(entry)
        continue
      }
      destroyed.push(entry)
    }

    if (destroyed.length === 0) return { destroyed, kept }

    this.lock.withLock(() => {
      for (const entry of destroyed) {
        const trashed = join(this.root, TRASH_DIR, `${entry.auditId}.md`)
        // Record before destroying: the trace has to outlive the content.
        appendLineDurable(
          join(this.root, WAL_FILE),
          JSON.stringify({
            seq: this.nextSeq(),
            kind: "delete",
            locator: entry.locator,
            previousHash: sha256(readFileSync(trashed, "utf8")) as WalEntry["previousHash"],
            newHash: null,
            auditId: `purge-${entry.auditId}`,
            source: options.source ?? "operator",
            reason: `permanent erasure of ${entry.locator}`,
            timestamp: new Date().toISOString(),
          } satisfies WalEntry),
        )
        try {
          unlinkSync(trashed)
          unlinkSync(`${trashed}.origin.json`)
        } catch {
          // Already gone; the record stands either way.
        }
      }
    })

    return { destroyed, kept }
  }

  /**
   * Put a deleted note back where it came from.
   *
   * Refuses when something already occupies the locator: restoring must not
   * overwrite work done since the deletion.
   */
  async restoreDeleted(auditId: string): Promise<MutationResult> {
    const trashed = join(this.root, TRASH_DIR, `${auditId}.md`)
    const sidecar = `${trashed}.origin.json`
    if (!existsSync(trashed) || !existsSync(sidecar)) {
      throw KnowledgeFailure.sourceInconsistent(`nothing in the trash for audit ${auditId}`)
    }
    const meta = JSON.parse(readFileSync(sidecar, "utf8")) as { locator: string }
    const raw = readFileSync(trashed, "utf8")
    const destination = this.resolveWritable(meta.locator)
    if (existsSync(destination)) {
      throw KnowledgeFailure.casMismatch("absent", "present")
    }

    const restoreId = randomUUID()
    const result = this.commit(
      "restore",
      meta.locator,
      destination,
      raw,
      null,
      { ...({} as MutationIntent), reason: `restore of ${auditId}`, source: "trash" },
      restoreId,
    )
    try {
      unlinkSync(trashed)
      unlinkSync(sidecar)
    } catch {
      // The note is back; a leftover trash copy is harmless.
    }
    return result
  }

  /**
   * Rename a note inside the vault.
   *
   * `move` was in the contract and reached `unsupported mutation kind` only
   * after dispatch, so a schema-valid intent failed for a reason the schema
   * could not express.
   */
  private async move(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const destination = intent.targetLocator
    if (destination === undefined) {
      throw KnowledgeFailure.mutationRefused("move requires targetLocator")
    }
    const { locator, full, raw: current } = await this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const destinationFull = this.resolveWritable(destination)
    if (existsSync(destinationFull)) {
      throw KnowledgeFailure.casMismatch("absent", "present")
    }

    // The content is unchanged; only its locator moves. Record the arrival
    // first so the WAL names the destination, then remove the old path.
    const result = this.commit(
      "move",
      destination,
      destinationFull,
      current,
      sha256(current),
      intent,
      auditId,
    )
    if (destinationFull !== full) {
      try {
        unlinkSync(full)
      } catch {
        // The source is already gone; the note is at its destination either
        // way, which is the state the WAL recorded.
      }
    }
    void locator
    return result
  }

  // -- shared --------------------------------------------------------------

  /**
   * Append the WAL entry, then make the new content visible.
   *
   * Order matters: the log records the intent before the rename, so a crash
   * between the two leaves a recoverable trace rather than a silent change.
   */
  private commit(
    kind: WalKind,
    locator: string,
    full: string,
    raw: string,
    previousHash: string | null,
    intent: MutationIntent,
    auditId: string,
  ): MutationResult {
    const newHash = sha256(raw)
    validateEntry({
      kind,
      locator,
      previousHash: previousHash as WalEntry["previousHash"],
      newHash: newHash as WalEntry["newHash"],
      source: intent.source,
      reason: intent.reason,
    })

    // One lock for the whole commit. Without it two writers can read the same
    // sequence number, and their appends interleave into a log whose order no
    // longer matches what happened on disk.
    this.lock.withLock(() => {
      mkdirSync(dirname(full), { recursive: true })
      const tmp = `${full}${TMP_SUFFIX}`

      // 1. bytes on disk...
      writeFileDurable(tmp, raw)
      try {
        // 2. ...then the intent, durably: this is the commit point.
        appendLineDurable(
          join(this.root, WAL_FILE),
          JSON.stringify({
            seq: this.nextSeq(),
            kind,
            locator,
            previousHash: previousHash as WalEntry["previousHash"],
            newHash: newHash as WalEntry["newHash"],
            auditId,
            source: intent.source,
            reason: intent.reason,
            timestamp: new Date().toISOString(),
          } satisfies WalEntry),
        )
      } catch (e) {
        // Nothing was recorded, so nothing happened: remove the temporary
        // rather than leaving a write recovery would have to guess about.
        try {
          unlinkSync(tmp)
        } catch {
          // Already gone.
        }
        throw e
      }

      // 3. make it visible, 4. and flush the directory entry.
      renameSync(tmp, full)
      fsyncDirectory(dirname(full))
    })

    // The contract declares ref and newLifecycle; returning only
    // { applied, auditId } left the caller unable to observe what it wrote.
    const written = parseFrontmatter(raw).frontmatter
    return {
      applied: true,
      auditId,
      ref: {
        id: written.unifia_id as KnowledgeId,
        locator: locator as KnowledgeLocator,
        versionHash: newHash as KnowledgeVersionHash,
      },
      newLifecycle: written.unifia_lifecycle,
    }
  }


  /** Entries already recorded, so a restart continues the sequence. */
  /**
   * Next sequence number, derived from the last durable entry.
   *
   * Read under the commit lock, so two writers cannot observe the same value.
   * Counting lines instead would let a torn final append shift every
   * subsequent number by one, silently desynchronising the log from what
   * actually happened on disk.
   */
  private nextSeq(): number {
    const { entries } = readWalTolerant(join(this.root, WAL_FILE))
    const last = entries.at(-1)
    return last === undefined ? 1 : last.seq + 1
  }

  /** The WAL as recorded, for recovery and for the audit trail. */
  readWal(): WalEntry[] {
    // Tolerant: an append interrupted by a power loss leaves a partial JSON
    // line, and refusing to read the log because of it would lose every entry
    // before it.
    return readWalTolerant(join(this.root, WAL_FILE)).entries
  }

  private refuseCredentials(body: string): void {
    const classified = classifyText(body)
    if (classified.classification === "secret") {
      throw KnowledgeFailure.mutationRefused(
        `refusing to write credential content into the vault: ${classified.reason}`,
      )
    }
  }

  private assertCas(current: string, expected?: string): void {
    const observed = sha256(current)
    if (expected === undefined) {
      throw KnowledgeFailure.mutationRefused("this mutation requires expectedVersionHash")
    }
    if (expected !== observed) {
      throw KnowledgeFailure.casMismatch(expected, observed)
    }
  }

  /** Resolve a locator that must stay inside the vault once created. */
  private resolveWritable(locator: string): string {
    const full = join(this.root, locator)
    if (!wouldBeContained(this.realRoot, full)) {
      throw KnowledgeFailure.pathUnresolved(`locator escapes the vault root: ${locator}`)
    }
    return full
  }

  /** Find an existing note by id. */
  private async locate(
    id?: KnowledgeId,
  ): Promise<{ locator: string; full: string; raw: string }> {
    if (id === undefined) {
      throw KnowledgeFailure.mutationRefused("this mutation requires targetId")
    }
    for (const locator of await this.markdownLocators()) {
      const full = join(this.root, locator)
      if (!isContained(this.realRoot, full)) continue
      let raw: string
      try {
        raw = await fsp.readFile(full, "utf8")
      } catch {
        continue
      }
      try {
        if (parseFrontmatter(raw).frontmatter.unifia_id === id) return { locator, full, raw }
      } catch {
        // A note that does not parse is not the target.
      }
    }
    throw KnowledgeFailure.sourceInconsistent(`no note with id ${id}`)
  }

  private async markdownLocators(): Promise<string[]> {
    // Reuse the reader's walk so writer and reader see the same corpus, with
    // the same containment rules and the same skipped directories.
    return new VaultSource({
      root: this.root,
      space: { kind: "personal", id: "writer", label: "writer" },
    }).locators()
  }
}

/** UUIDv7: 48-bit big-endian timestamp, version 7, variant 10. */
function randomUUIDv7(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const ms = BigInt(Date.now())
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
