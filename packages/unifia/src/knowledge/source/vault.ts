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
import { isContained, realOrNull } from "./containment.js"

/** Directories that never hold Class A notes. */
const SKIPPED_DIRECTORIES = new Set([".git", ".unifia", "node_modules", ".obsidian"])

/** W-FS-02: default bound on walk depth. 50 is far above any realistic
 *  vault and small enough that a runaway tree cannot exhaust the stack. */
const DEFAULT_MAX_DEPTH = 50

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
  state: { truncated: boolean; reason: string | null },
): Promise<void> {
  if (depth > maxDepth) {
    // The caller asked the walk to descend no further. Mark the
    // truncation so the surface (`locators()`) can expose the reason.
    state.truncated = true
    state.reason = "maxDepth"
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
      await walkMarkdown(realRoot, full, out, visited, excluded, depth + 1, maxDepth, state)
      // A truncated subtree must not be reported as a complete scan: the
      // outer caller would otherwise see `truncated: false` from the
      // perspective of the next entry and lose the marker.
      if (state.truncated) return
      continue
    }
    if (!name.toLowerCase().endsWith(".md")) continue
    const realFile = realOrNull(full)
    if (realFile === null) continue
    out.push(relative(realRoot, realFile).split(sep).join("/"))
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
}

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
  private scanErrors: Array<{ locator: string; message: string }> = []
  private scanStatus: { truncated: boolean; reason: string | null } = {
    truncated: false,
    reason: null,
  }

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
  get lastScan(): { truncated: boolean; reason: string | null } {
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
    this.scanStatus = { truncated: false, reason: null }
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
      let parsed: ParsedDocument
      try {
        parsed = parseDocument(await fsp.readFile(join(this.root, locator), "utf8"))
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
    // Containment on the lexical path first: reject `..` before touching the
    // filesystem at all.
    const full = join(this.root, locator)
    const lexical = relative(this.root, full)
    if (lexical.startsWith("..") || isAbsolute(lexical)) {
      throw KnowledgeFailure.pathUnresolved(`locator escapes the vault root: ${locator}`)
    }
    // Then on the real path: a lexically innocent locator can still traverse a
    // junction or a symlink pointing outside the workspace. A path that does
    // not resolve at all is simply absent — "not found" and "out of bounds"
    // are different answers and must not be collapsed.
    const real = realOrNull(full)
    if (real === null) return null
    if (!isContained(this.realRoot, full)) {
      throw KnowledgeFailure.pathUnresolved(
        `locator resolves outside the vault root: ${locator}`,
      )
    }
    // W-FS-01 (TOCTOU): a concurrent actor could swap the directory entry at
    // `full` for a symlink pointing outside the vault between the validation
    // above and the read below. Re-validate the canonical real path against
    // the captured identity, then read via that canonical path — not the
    // lexical one — so a swap of `full` after this point cannot redirect
    // the read. A change in canonical identity would mean another swap
    // happened; the comparison makes the contract explicit so a future
    // audit can confirm it.
    const realAfter = realOrNull(full)
    if (realAfter !== real) {
      throw KnowledgeFailure.pathUnresolved(
        `locator identity changed after validation: ${locator} (was ${real}, now ${realAfter ?? "unresolved"})`,
      )
    }
    let raw: string
    try {
      // Read the canonical, validated path. The lexical entry could have
      // been swapped for a symlink; we no longer consult it.
      raw = await fsp.readFile(real, "utf8")
    } catch {
      return null
    }
    try {
      return parseDocument(raw)
    } catch {
      return null
    }
  }

  watch(_onChange: (event: SourceEvent) => void): () => void {
    // V1 ships no filesystem watcher. Returning a no-op unsubscribe would
    // look like a live subscription that never fires, so refuse instead.
    throw KnowledgeFailure.indexUnavailable(
      "filesystem watching is not implemented in V1; re-run the query to pick up changes",
    )
  }
}
