/* SPDX-License-Identifier: MIT */
/**
 * Filesystem-backed knowledge source.
 *
 * Until now every `KnowledgeSource` in the tree was a decorator around an
 * injected implementation, and the only implementation the CLI ever injected
 * was a pair of hardcoded notes — so `knowledge search` answered from two
 * synthetic notes rather than the vault. This module is the missing leaf: it
 * reads Class A Markdown from disk.
 *
 * Class A is the source of truth (ADR-KNOW-0002), so this reads `.md` files
 * directly and never consults a derived index.
 */

import { constants } from "node:fs"
import * as fsp from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"
import type {
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeSpace,
} from "@unifia/contracts/knowledge"
import { KnowledgeFailure } from "../domain/errors.js"
import { parseDocument, type ParsedDocument } from "../parser/parser.js"
import type { KnowledgeSource, ListOptions, ListedNote, SourceEvent } from "./source.js"
// One containment definition, shared with the writer.
import { isContained, realOrNull, toNfc, toNfd } from "./containment.js"

/** Directories that never hold Class A notes. */
const SKIPPED_DIRECTORIES = new Set([".git", ".unifia", "node_modules", ".obsidian"])

/** W-FS-02: default bound on walk depth. 50 is far above any realistic
 *  vault and small enough that a runaway tree cannot exhaust the stack. */
const DEFAULT_MAX_DEPTH = 50

/**
 * How many truncated subtree paths a scan remembers.
 *
 * The list is diagnostic, not a work queue: a pathological tree could
 * produce thousands of them, and the point of a bound is not to replace one
 * unbounded structure with another.
 */
const MAX_RECORDED_TRUNCATIONS = 20

/**
 * `O_NOFOLLOW` where the platform has it, `0` where it does not.
 *
 * Linux and macOS refuse to open a final component that is a symbolic link
 * when this flag is set, which is the strongest form of the guarantee below.
 * Windows exposes no equivalent, so there the identity comparison in
 * `readContainedByHandle` carries the check alone.
 */
const O_NOFOLLOW_IF_AVAILABLE = constants.O_NOFOLLOW ?? 0

/** A file's identity, as the kernel reports it. */
interface FileIdentity {
  dev: bigint
  ino: bigint
}

/**
 * What a walk saw, and what it did not.
 *
 * A scan that stopped short is not the same corpus as a complete one, and a
 * count derived from it is not the vault's note count. `truncated` says the
 * difference exists; `truncatedPaths` says where, bounded so the diagnostic
 * cannot itself grow without limit.
 */
export interface VaultScanStatus {
  truncated: boolean
  reason: string | null
  truncatedPaths: string[]
}

function emptyScanStatus(): VaultScanStatus {
  return { truncated: false, reason: null, truncatedPaths: [] }
}

/**
 * Read `real` through a file descriptor, refusing any substitution.
 *
 * P1-A of the 2026-09-01 review: validating a path and then calling `stat`
 * and `readFile` *on that path* leaves a window. Every one of those calls
 * resolves the name again, so an actor who replaces the directory entry
 * between them gets their content read out of a location that passed the
 * containment check. Re-running `realpath` before the read narrows the
 * window; it does not close it, because the read still goes by name.
 *
 * This closes it by changing what the read is addressed to:
 *
 *   1. capture the identity of the validated path with `lstat` (which does
 *      not follow, so a link substituted here reports *its own* inode);
 *   2. open it once, with `O_NOFOLLOW` where the platform has it;
 *   3. `fstat` the descriptor and require the same `dev`/`ino`. A swap that
 *      raced step 2 shows up as a mismatch — on Windows, where the flag does
 *      not exist, this is the whole check;
 *   4. check the size and read the bytes *from the descriptor*.
 *
 * After step 2 the descriptor names an inode, not a path, so no later
 * substitution can redirect the read at all. `null` means absent — a
 * containment or identity failure throws, because "not found" and "someone
 * swapped this file" must not reach the caller as the same answer.
 */
async function readContainedByHandle(
  real: string,
  locator: string,
  maxNoteBytes: number,
): Promise<string | null> {
  const before = await identityOf(real)
  if (before === null) return null

  let handle: fsp.FileHandle
  try {
    handle = await fsp.open(real, constants.O_RDONLY | O_NOFOLLOW_IF_AVAILABLE)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === "ELOOP") {
      // The final component became a symbolic link after it was validated.
      // That is the attack the flag exists to catch, not a missing file.
      throw KnowledgeFailure.pathUnresolved(
        `locator became a link after validation: ${locator}`,
      )
    }
    return null
  }

  try {
    const st = await handle.stat({ bigint: true })
    if (!st.isFile()) {
      throw KnowledgeFailure.pathUnresolved(
        `locator is not a regular file: ${locator}`,
      )
    }
    if (st.dev !== before.dev || st.ino !== before.ino) {
      throw KnowledgeFailure.pathUnresolved(
        `locator identity changed after validation: ${locator}` +
          ` (was ${before.dev}:${before.ino}, now ${st.dev}:${st.ino})`,
      )
    }
    // W-FS-03: the size comes from the descriptor, before any bytes are
    // pinned in memory. The cap is hard; a caller that needs a larger note
    // is expected to chunk it, not to read it and truncate downstream.
    const size = Number(st.size)
    if (size > maxNoteBytes) {
      throw KnowledgeFailure.boundExceeded(
        `note size ${size} exceeds maxNoteBytes ${maxNoteBytes}: ${locator}`,
        { size, maxNoteBytes },
      )
    }
    return await handle.readFile("utf8")
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** `dev`/`ino` of `path` without following a final symbolic link. */
async function identityOf(path: string): Promise<FileIdentity | null> {
  try {
    const st = await fsp.lstat(path, { bigint: true })
    return { dev: st.dev, ino: st.ino }
  } catch {
    return null
  }
}

/**
 * Walk `dir`, collecting locators relative to `realRoot`, POSIX-separated.
 *
 * `visited` holds real paths so a link cycle terminates instead of recursing
 * until the stack gives out. `depth` and `maxDepth` enforce W-FS-02: a tree
 * deeper than `maxDepth` stops the descent; the caller surfaces the
 * truncation through the `truncated` flag on the scan result.
 */
async function walkMarkdown(
  realRoot: string,
  dir: string,
  out: string[],
  visited: Set<string>,
  excluded: ReadonlySet<string>,
  depth: number,
  maxDepth: number,
  state: VaultScanStatus,
): Promise<void> {
  if (depth > maxDepth) {
    // The caller asked the walk to descend no further. Mark the
    // truncation so the surface (`locators()`) can expose the reason, and
    // name the subtree that was cut so the state is diagnosable.
    state.truncated = true
    state.reason = "maxDepth"
    if (state.truncatedPaths.length < MAX_RECORDED_TRUNCATIONS) {
      state.truncatedPaths.push(relative(realRoot, dir).split(sep).join("/"))
    }
    return
  }
  const realDir = realOrNull(dir)
  if (realDir === null || visited.has(realDir)) return
  visited.add(realDir)

  let entries: string[]
  try {
    entries = await fsp.readdir(dir)
  } catch {
    // An unreadable directory is not a corpus error: skip it and keep going.
    return
  }
  for (const name of entries) {
    if (SKIPPED_DIRECTORIES.has(name)) continue
    const full = join(dir, name)
    // Excluded names apply at the vault root only: a nested `memory/` inside
    // a project subdirectory is ordinary content.
    if (realDir === realRoot && excluded.has(name)) continue

    let stats: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stats = await fsp.stat(full)
    } catch {
      continue
    }

    // Junctions are not symbolic links on Windows, so containment is checked
    // for every entry rather than only for the ones lstat calls a link.
    if (!isContained(realRoot, full)) continue

    if (stats.isDirectory()) {
      // A subtree that hits `maxDepth` marks `state.truncated` and stops
      // descending — it does not stop the walk. The first version returned
      // here, so one over-deep directory hid every sibling after it: a
      // vault could lose most of its notes to a single stray tree, and the
      // only signal was a boolean the product never read.
      await walkMarkdown(realRoot, full, out, visited, excluded, depth + 1, maxDepth, state)
      continue
    }
    if (!name.toLowerCase().endsWith(".md")) continue
    const realFile = realOrNull(full)
    if (realFile === null) continue
    // W-FS-04: normalise the recorded locator to NFC. macOS HFS+ stores
    // file names in NFD; Windows and most Linux file systems store
    // bytes verbatim. Wikilinks and edits tend to be written in NFC.
    // Pinning the locator form to NFC means the rest of the system
    // (sort, dedup, prefix filter) sees a single canonical form, and
    // the read path can recognise both forms by normalising the
    // incoming locator to NFC before joining with the vault root.
    out.push(relative(realRoot, realFile).split(sep).join("/").normalize("NFC"))
  }
}

export interface VaultSourceConfig {
  /** Absolute path to the vault root. */
  root: string
  /** The space this vault backs. */
  space: KnowledgeSpace
  /**
   * Top-level directory names this vault must not descend into.
   *
   * The project space is the workspace root and the personal space is
   * `memory/` inside it, so without this the same note is listed by both and
   * every count, ranking and budget doubles.
   */
  excludeDirectories?: readonly string[]
  /**
   * W-FS-02: maximum walk depth. The vault root is depth 0; a file at
   * `lvl3/leaf.md` sits at depth 4. A walk that would descend past this
   * bound is truncated with `truncated: true, reason: "maxDepth"`. Must
   * be >= 1; the default tolerates realistic vault depths.
   */
  maxDepth?: number
  /**
   * W-FS-03: maximum size in bytes of a single note. The size is checked
   * before the full read so an oversized note is rejected with a typed
   * error rather than loaded into memory and then truncated downstream.
   * Must be > 0; the default is generous.
   */
  maxNoteBytes?: number
}

/** W-FS-03: default cap on a single note's size, in bytes. */
const DEFAULT_MAX_NOTE_BYTES = 5 * 1024 * 1024

/**
 * A `KnowledgeSource` reading Class A Markdown from a directory.
 *
 * `list` skips files that fail to parse rather than aborting the whole scan:
 * a vault is user-editable and one malformed note must not blind retrieval.
 * The count is reported through `lastScanErrors` so a caller can surface it
 * instead of silently swallowing the failures.
 */
export class VaultSource implements KnowledgeSource {
  readonly space: KnowledgeSpace
  private readonly root: string
  /** `root` with every link resolved; containment is decided against this. */
  private readonly realRoot: string
  private readonly excluded: ReadonlySet<string>
  private readonly maxDepth: number
  private readonly maxNoteBytes: number
  private scanErrors: Array<{ locator: string; message: string }> = []
  private scanStatus: VaultScanStatus = emptyScanStatus()

  constructor(config: VaultSourceConfig) {
    if (!isAbsolute(config.root)) {
      throw KnowledgeFailure.pathUnresolved(
        `vault root must be absolute, got ${config.root}`,
      )
    }
    this.root = config.root
    const real = realOrNull(config.root)
    if (real === null) {
      throw KnowledgeFailure.pathUnresolved(`vault root cannot be resolved: ${config.root}`)
    }
    this.realRoot = real
    this.excluded = new Set(config.excludeDirectories ?? [])
    this.maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH
    if (!Number.isFinite(this.maxDepth) || this.maxDepth < 1) {
      throw KnowledgeFailure.boundExceeded(
        `maxDepth must be >= 1, got ${String(config.maxDepth)}`,
      )
    }
    this.maxNoteBytes = config.maxNoteBytes ?? DEFAULT_MAX_NOTE_BYTES
    if (!Number.isFinite(this.maxNoteBytes) || this.maxNoteBytes <= 0) {
      throw KnowledgeFailure.boundExceeded(
        `maxNoteBytes must be > 0, got ${String(config.maxNoteBytes)}`,
      )
    }
    this.space = config.space
  }

  /** Notes skipped by the last `list()` because they failed to parse. */
  get lastScanErrors(): ReadonlyArray<{ locator: string; message: string }> {
    return this.scanErrors
  }

  /**
   * State of the most recent `locators()` walk. `truncated: true` means
   * the walk did not visit every entry under the root; `reason` names
   * the bound or condition that stopped it. Callers can surface this so
   * the Inspector or a CLI flag can tell the user "the vault is
   * partial" without having to introspect the result.
   */
  get lastScan(): Readonly<VaultScanStatus> {
    return this.scanStatus
  }

  /**
   * Locators of every Markdown file under the root.
   *
   * Async because the walk awaits `readdir` and `stat`: a synchronous scan
   * holds the event loop, so a retrieval deadline could not fire while it ran
   * and a bound checked only between files was not a bound.
   */
  async locators(): Promise<string[]> {
    const out: string[] = []
    // Each scan starts from a clean truncation state: a previous
    // truncated run must not leave a stale flag on an empty follow-up.
    this.scanStatus = emptyScanStatus()
    await walkMarkdown(
      this.realRoot,
      this.root,
      out,
      new Set(),
      this.excluded,
      0,
      this.maxDepth,
      this.scanStatus,
    )
    out.sort()
    return out
  }

  async list(options: ListOptions): Promise<ListedNote[]> {
    const errors: Array<{ locator: string; message: string }> = []
    const notes: ListedNote[] = []

    const lifecycles = options.lifecycles
    const prefix = options.prefix

    for (const locator of await this.locators()) {
      if (prefix !== undefined && prefix.length > 0 && !locator.startsWith(prefix)) continue
      // W-FS-03: an oversized note is a scan error, not a reason to
      // crash the listing. The size check lives in `readValidatedFile`
      // so it cannot drift between read and list.
      let raw: string | null
      try {
        raw = await this.readValidatedFile(locator)
      } catch (e) {
        if (e instanceof KnowledgeFailure && e.kind === "bound_exceeded") {
          errors.push({ locator, message: e.message })
          continue
        }
        if (
          e instanceof Error &&
          /outside the vault root|identity changed|became a link|not a regular file/.test(e.message)
        ) {
          // Containment failure in a listing is a security boundary
          // being crossed — refuse loudly rather than skip silently.
          throw e
        }
        errors.push({ locator, message: (e as Error).message })
        continue
      }
      // The walk saw this locator; if it is gone by the time we read it, the
      // vault changed under us. That is a skip, not a parse error.
      if (raw === null) continue
      let parsed: ParsedDocument
      try {
        parsed = parseDocument(raw)
      } catch (e) {
        errors.push({ locator, message: (e as Error).message })
        continue
      }
      const fm = parsed.note.frontmatter
      if (lifecycles !== undefined && !lifecycles.includes(fm.unifia_lifecycle)) continue
      notes.push({
        ref: { id: fm.unifia_id as KnowledgeId, locator: locator as KnowledgeLocator },
        type: fm.unifia_type,
        lifecycle: fm.unifia_lifecycle,
        updatedAt: fm.unifia_updated_at,
      })
    }

    this.scanErrors = errors
    // Newest first, then locator so equal timestamps stay deterministic.
    notes.sort((a, b) =>
      a.updatedAt === b.updatedAt
        ? a.ref.locator.localeCompare(b.ref.locator)
        : b.updatedAt.localeCompare(a.updatedAt),
    )
    const limit = options.limit
    return limit !== undefined && limit >= 0 ? notes.slice(0, limit) : notes
  }

  async read(locator?: KnowledgeLocator, id?: KnowledgeId): Promise<ParsedDocument | null> {
    if (locator === undefined && id === undefined) {
      throw KnowledgeFailure.sourceInconsistent("read requires a locator or an id")
    }

    if (locator !== undefined) {
      return this.readLocator(locator)
    }

    // No derived index in V1: resolve an id by scanning Class A.
    for (const candidate of await this.locators()) {
      const doc = await this.readLocator(candidate as KnowledgeLocator)
      if (doc !== null && doc.note.frontmatter.unifia_id === id) return doc
    }
    return null
  }

  private async readLocator(locator: KnowledgeLocator): Promise<ParsedDocument | null> {
    const raw = await this.readValidatedFile(locator)
    if (raw === null) return null
    try {
      return parseDocument(raw)
    } catch {
      return null
    }
  }

  /**
   * Read and validate a single note by locator, returning the raw text.
   *
   * Shared by `readLocator` (which parses) and `list` (which records
   * parse errors rather than aborting). All containment, TOCTOU, and
   * size checks live here so the two callers cannot diverge.
   *
   * W-FS-04: the locator is accepted in any normalisation form. The
   * filesystem stores file names verbatim on most systems, but HFS+/
   * APFS (macOS) stores them in NFD. The walk records locators in NFC
   * so callers can compare them byte-for-byte; the read path
   * recognises the on-disk form (whether NFC or NFD) by trying both
   * and using the first one that resolves to a contained file. The
   * normalisation is not applied blindly: only when the literal-byte
   * lookup would otherwise miss.
   */
  private async readValidatedFile(locator: string): Promise<string | null> {
    // Containment on the lexical path first: reject `..` before touching the
    // filesystem at all. Run the check on every candidate form so a
    // normalised alias that climbs out is still refused.
    for (const candidate of this.normalisedForms(locator)) {
      const full = join(this.root, candidate)
      const lexical = relative(this.root, full)
      if (lexical.startsWith("..") || isAbsolute(lexical)) {
        throw KnowledgeFailure.pathUnresolved(
          `locator escapes the vault root: ${locator}`,
        )
      }
      // Then on the real path: a lexically innocent locator can still traverse a
      // junction or a symlink pointing outside the workspace. A path that does
      // not resolve at all is simply absent — "not found" and "out of bounds"
      // are different answers and must not be collapsed.
      const real = realOrNull(full)
      if (real === null) continue
      if (!isContained(this.realRoot, full)) {
        throw KnowledgeFailure.pathUnresolved(
          `locator resolves outside the vault root: ${locator}`,
        )
      }
      const raw = await readContainedByHandle(real, locator, this.maxNoteBytes)
      if (raw === null) continue
      return raw
    }
    return null
  }

  /**
   * Candidate forms of `locator` to try, in order.
   *
   * The literal form is tried first so a caller passing the exact
   * bytes the filesystem uses pays no normalisation tax. NFC and NFD
   * are appended as fallbacks so callers writing in either form can
   * find a file stored in the other. Duplicates collapse: NFC of an
   * already-NFC string is a no-op, and a string that happens to be in
   * both forms only appears once.
   */
  private normalisedForms(locator: string): string[] {
    const forms: string[] = [locator]
    const nfc = toNfc(locator)
    if (!forms.includes(nfc)) forms.push(nfc)
    const nfd = toNfd(locator)
    if (!forms.includes(nfd)) forms.push(nfd)
    return forms
  }

  watch(_onChange: (event: SourceEvent) => void): () => void {
    // V1 ships no filesystem watcher. Returning a no-op unsubscribe would
    // look like a live subscription that never fires, so refuse instead.
    throw KnowledgeFailure.indexUnavailable(
      "filesystem watching is not implemented in V1; re-run the query to pick up changes",
    )
  }
}
