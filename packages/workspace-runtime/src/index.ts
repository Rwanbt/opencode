/* SPDX-License-Identifier: MIT */
import { WorkspaceStorage } from "./storage.js"
import { DurableQueue } from "./queue.js"
import { createHash, randomBytes } from "node:crypto"
import { promises as fs, watch as watchFiles, type FSWatcher } from "node:fs"
import path from "node:path"
import type {
  FileEvent,
  FileReadResult,
  FileRemoveResult,
  FileSessionId,
  FileWrite,
  FileWriteResult,
  Workspace,
  WorkspaceHandle,
  WorkspaceId,
  WorkspaceListPage,
  WorkspacePort,
  WorkspaceEntry,
} from "@unifia/contracts"

type Session = { workspace: Workspace; token: string; closed: boolean; watchers: Set<() => void> }

export type WorkspaceRuntimeOptions = {
  maxReadBytes?: number
  maxWriteBytes?: number
  now?: () => number
  /** Safety ceiling on entries collected in one list()/search() traversal — stops collecting silently, never throws (FUNC-004/C5-1). */
  maxEntries?: number
  /** Entries returned per list() page. */
  pageSize?: number
  /** Directory recursion depth ceiling. */
  maxDepth?: number
  /** Directory names never listed or descended into. */
  excludedNames?: ReadonlySet<string>
}

const DEFAULT_MAX_READ_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_WRITE_BYTES = 4 * 1024 * 1024
// FUNC-004/C5-1: was 2_000 and a hard throw. Now a silent collection
// ceiling (see #walkEntries) — the criterion is "50k files returns a first
// page without throwing", so the ceiling itself must clear that bar.
const DEFAULT_MAX_ENTRIES = 50_000
const DEFAULT_PAGE_SIZE = 500
const DEFAULT_MAX_DEPTH = 32
const DEFAULT_EXCLUDED_NAMES: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "build"])

/**
 * Workspace-relative paths are POSIX-separated everywhere this runtime reports
 * them (`#walkEntries` normalises listings the same way), so watcher events
 * must agree or a consumer can never match an event against a listing.
 *
 * WHY it is a named function: the watcher used to inline a replaceAll whose
 * search literal carried one escape too many, so it looked for a doubled
 * backslash — a sequence that never occurs in a Windows path — instead of the
 * single one fs.watch actually reports. Every event on Windows therefore kept
 * its backslashes while every listing had forward slashes. Pulling the rule
 * out of the callback makes it testable instead of hiding an escaping mistake
 * a reader has to decode by hand.
 */
export function toWorkspacePath(value: string): string {
  return value.replaceAll("\\", "/")
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function assertRelative(input: string): void {
  if (!input || input.includes("\0") || path.isAbsolute(input)) throw new Error("workspace path must be relative")
  const normalized = path.posix.normalize(input.replaceAll("\\", "/"))
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("workspace path escapes root")
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT")
}

/**
 * FUNC-004/C5-1: opaque, server-validated, bound to the workspace + prefix
 * that produced it. A cursor minted for a different workspace or a
 * different prefix is refused (list() below), not silently reinterpreted
 * against whatever tree happens to be at that offset.
 */
type ListCursor = { workspaceId: WorkspaceId; prefix: string; offset: number }

function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function decodeListCursor(value: string): ListCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (!parsed || typeof parsed !== "object") return undefined
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.workspaceId !== "string" || typeof candidate.prefix !== "string" || !Number.isInteger(candidate.offset) || (candidate.offset as number) < 0) return undefined
    return { workspaceId: candidate.workspaceId, prefix: candidate.prefix, offset: candidate.offset as number }
  } catch {
    return undefined
  }
}

function mimeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".json") return "application/json"
  if (extension === ".md" || extension === ".txt") return "text/plain; charset=utf-8"
  if (extension === ".ts" || extension === ".tsx" || extension === ".js") return "text/plain; charset=utf-8"
  return "application/octet-stream"
}

export class WorkspaceRuntime implements WorkspacePort {
  readonly #workspaces = new Map<WorkspaceId, Workspace>()
  readonly #sessions = new Map<FileSessionId, Session>()
  readonly #now: () => number
  readonly #maxReadBytes: number
  readonly #maxWriteBytes: number
  readonly #maxEntries: number
  readonly #pageSize: number
  readonly #maxDepth: number
  readonly #excludedNames: ReadonlySet<string>
  readonly #queues = new Map<WorkspaceId, DurableQueue<FileEvent>>()

  constructor(options: WorkspaceRuntimeOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES
    this.#maxWriteBytes = options.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    this.#maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
    this.#excludedNames = options.excludedNames ?? DEFAULT_EXCLUDED_NAMES
  }

  async register(input: { name: string; path: string }): Promise<Workspace> {
    const root = await fs.realpath(input.path)
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) throw new Error("workspace root must be a directory")
    const id = `workspace-${sha256(root).slice(0, 24)}`
    const existing = this.#workspaces.get(id)
    if (existing) return { ...existing, updatedAt: this.#now() }
    const workspace: Workspace = { id, name: input.name.trim() || path.basename(root), path: root, createdAt: this.#now(), updatedAt: this.#now() }
    this.#workspaces.set(id, workspace)
    return { ...workspace }
  }

  async open(id: WorkspaceId): Promise<WorkspaceHandle> {
    const workspace = this.#workspaces.get(id)
    if (!workspace) throw new Error("workspace is not registered")
    const token = randomBytes(24).toString("base64url")
    this.#sessions.set(token, { workspace, token, closed: false, watchers: new Set() })
    return { id, token }
  }

  async read(sessionId: FileSessionId, paths: string[]): Promise<FileReadResult[]> {
    const session = this.#session(sessionId)
    const results: FileReadResult[] = []
    let total = 0
    for (const relative of paths) {
      const absolute = await this.#resolveExisting(session.workspace.path, relative)
      const content = await fs.readFile(absolute)
      total += content.byteLength
      if (total > this.#maxReadBytes) throw new Error("workspace read quota exceeded")
      results.push({ path: relative, content, mime: mimeFor(relative), size: content.byteLength })
    }
    return results
  }

  async write(sessionId: FileSessionId, writes: FileWrite[]): Promise<FileWriteResult[]> {
    const session = this.#session(sessionId)
    const prepared: Array<{ input: FileWrite; absolute: string; content: Buffer }> = []
    let total = 0
    for (const input of writes) {
      const absolute = await this.#resolveExisting(session.workspace.path, input.path)
      const content = typeof input.content === "string" ? Buffer.from(input.content) : Buffer.from(input.content)
      total += content.byteLength
      if (total > this.#maxWriteBytes) throw new Error("workspace write quota exceeded")
      prepared.push({ input, absolute, content })
    }
    const results: FileWriteResult[] = []
    for (const { input, absolute, content } of prepared) {
      const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${randomBytes(8).toString("hex")}.tmp`)
      await fs.writeFile(temporary, content, { flag: "wx" })
      try {
        await fs.rename(temporary, absolute)
      } catch (error) {
        await fs.rm(temporary, { force: true })
        throw error
      }
      results.push({ path: input.path, bytesWritten: content.byteLength, sha: sha256(content) })
    }
    return results
  }

  /**
   * Deliberately a separate primitive from `write()`, not an upsert
   * flag on it: `write()`'s "must already exist" refusal is an asserted
   * safety invariant (see `runtime.test.ts` — "silent file creation was
   * not denied"), and mirrors how `createArtifact` is already a distinct
   * primitive from "modify an artifact" elsewhere in this codebase.
   * Refuses (EEXIST) if the target already exists — a Design Files tab
   * "create" action landing on an existing path is a name collision to
   * surface, not a silent overwrite.
   */
  async create(sessionId: FileSessionId, creates: FileWrite[]): Promise<FileWriteResult[]> {
    const session = this.#session(sessionId)
    const prepared: Array<{ input: FileWrite; absolute: string; content: Buffer }> = []
    let total = 0
    for (const input of creates) {
      const absolute = await this.#resolveForWrite(session.workspace.path, input.path)
      const content = typeof input.content === "string" ? Buffer.from(input.content) : Buffer.from(input.content)
      total += content.byteLength
      if (total > this.#maxWriteBytes) throw new Error("workspace write quota exceeded")
      prepared.push({ input, absolute, content })
    }
    const results: FileWriteResult[] = []
    for (const { input, absolute, content } of prepared) {
      try {
        await fs.writeFile(absolute, content, { flag: "wx" })
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST") {
          throw new Error(`workspace create target already exists: ${input.path}`)
        }
        throw error
      }
      results.push({ path: input.path, bytesWritten: content.byteLength, sha: sha256(content) })
    }
    return results
  }

  /**
   * Idempotent by design (matches `createArtifact`'s posture): a path
   * that's already gone reports `removed: false` instead of throwing,
   * so a double-click on "delete" or a stale row from another window
   * never surfaces as an error.
   */
  async remove(sessionId: FileSessionId, paths: string[]): Promise<FileRemoveResult[]> {
    const session = this.#session(sessionId)
    const results: FileRemoveResult[] = []
    for (const relative of paths) {
      assertRelative(relative)
      let absolute: string
      try {
        absolute = await fs.realpath(path.resolve(session.workspace.path, relative))
      } catch (error) {
        if (isMissingFileError(error)) {
          results.push({ path: relative, removed: false })
          continue
        }
        throw error
      }
      if (!isInside(session.workspace.path, absolute)) throw new Error("workspace path escapes root")
      const stat = await fs.stat(absolute)
      if (!stat.isFile()) throw new Error("workspace path is not a file")
      await fs.rm(absolute, { force: true })
      results.push({ path: relative, removed: true })
    }
    return results
  }

  /** Refuses when `to` already exists rather than silently overwriting it — a lost file from a rename collision has no undo. */
  async rename(sessionId: FileSessionId, from: string, to: string): Promise<FileWriteResult> {
    const session = this.#session(sessionId)
    const source = await this.#resolveExisting(session.workspace.path, from)
    const destination = await this.#resolveForWrite(session.workspace.path, to)
    const destinationExists = await fs.access(destination).then(
      () => true,
      () => false,
    )
    if (destinationExists) throw new Error("workspace rename target already exists")
    await fs.rename(source, destination)
    const stat = await fs.stat(destination)
    const content = await fs.readFile(destination)
    return { path: to, bytesWritten: stat.size, sha: sha256(content) }
  }

  async list(sessionId: FileSessionId, prefix = ".", cursor?: string): Promise<WorkspaceListPage> {
    const session = this.#session(sessionId)
    const workspaceId = session.workspace.id
    let offset = 0
    if (cursor !== undefined) {
      const decoded = decodeListCursor(cursor)
      if (!decoded || decoded.workspaceId !== workspaceId || decoded.prefix !== prefix) throw new Error("workspace listing cursor is invalid for this workspace or prefix")
      offset = decoded.offset
    }
    const directory = await this.#resolveDirectory(session.workspace.path, prefix)
    if (!directory) return { entries: [], skipped: 0 }
    const { entries: all, skipped } = await this.#walkEntries(session.workspace.path, directory, undefined)
    const page = all.slice(offset, offset + this.#pageSize)
    const nextCursor = offset + this.#pageSize < all.length ? encodeListCursor({ workspaceId, prefix, offset: offset + this.#pageSize }) : undefined
    return { entries: page, nextCursor, skipped }
  }

  async search(sessionId: FileSessionId, query: string, prefix = "."): Promise<readonly WorkspaceEntry[]> {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery || normalizedQuery.length > 256 || normalizedQuery.includes("\0")) throw new Error("workspace search query is invalid")
    const session = this.#session(sessionId)
    const directory = await this.#resolveDirectory(session.workspace.path, prefix)
    if (!directory) return []
    return (await this.#walkEntries(session.workspace.path, directory, normalizedQuery)).entries
  }
  watch(sessionId: FileSessionId): AsyncIterable<FileEvent> {
    const session = this.#session(sessionId)
    const queue: FileEvent[] = []
    const waiters: Array<{ resolve: (result: IteratorResult<FileEvent>) => void; reject: (error: unknown) => void }> = []
    let closed = false
    let persistenceError: Error | undefined
    let sequence = 0
    let writeChain = Promise.resolve()
    const deliver = (event: FileEvent) => {
      const waiter = waiters.shift()
      if (waiter) waiter.resolve({ done: false, value: event })
      else queue.push(event)
    }
    const watcher: FSWatcher = watchFiles(session.workspace.path, { recursive: true }, (eventType, filename) => {
      if (closed || !filename) return
      const relative = toWorkspacePath(filename.toString())
      const event: FileEvent = { type: eventType === "rename" ? "renamed" : "modified", path: relative, timestamp: this.#now() + sequence++ / 1000 }
      writeChain = writeChain.then(async () => {
        const stored = await this.appendFileEvent(session.workspace.id, event)
        if (!closed) deliver(stored)
      }).catch((error: unknown) => {
        persistenceError = error instanceof Error ? error : new Error("file event persistence failed")
        close()
      })
    })
    const close = () => {
      if (closed) return
      closed = true
      watcher.close()
      session.watchers.delete(close)
      for (const waiter of waiters.splice(0)) waiter.resolve({ done: true, value: undefined })
    }
    session.watchers.add(close)
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<FileEvent>> => {
          if (persistenceError) return Promise.reject(persistenceError)
          const event = queue.shift()
          if (event) return Promise.resolve({ done: false, value: event })
          if (closed) return Promise.resolve({ done: true, value: undefined })
          return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
        },
        return: async (): Promise<IteratorResult<FileEvent>> => { close(); return { done: true, value: undefined } },
      }),
    }
  }
  async appendFileEvent(workspaceId: WorkspaceId, event: FileEvent): Promise<FileEvent> {
    const workspace = this.#workspaces.get(workspaceId)
    if (!workspace) throw new Error("workspace is not registered")
    const item = await this.#queue(workspace).enqueue("outbox", { ...event, sequence: undefined })
    return { ...event, sequence: item.sequence }
  }

  async replayFileEvents(workspaceId: WorkspaceId, afterSequence = 0): Promise<FileEvent[]> {
    const workspace = this.#workspaces.get(workspaceId)
    if (!workspace) throw new Error("workspace is not registered")
    const items = await this.#queue(workspace).pending("outbox", afterSequence)
    return items.map((item) => ({ ...item.payload, sequence: item.sequence }))
  }

  async acknowledgeFileEvent(workspaceId: WorkspaceId, sequence: number): Promise<void> {
    const workspace = this.#workspaces.get(workspaceId)
    if (!workspace) throw new Error("workspace is not registered")
    await this.#queue(workspace).acknowledge("outbox", sequence)
  }

  async health(workspaceId: WorkspaceId) {
    const workspace = this.#workspaces.get(workspaceId)
    if (!workspace) throw new Error("workspace is not registered")
    return new WorkspaceStorage(workspace.path).health(workspace.id)
  }

  async close(sessionId: FileSessionId): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (!session) return
    session.closed = true
    for (const watcher of session.watchers) watcher()
    session.watchers.clear()
    this.#sessions.delete(sessionId)
  }

  #queue(workspace: Workspace): DurableQueue<FileEvent> {
    let queue = this.#queues.get(workspace.id)
    if (!queue) {
      queue = new DurableQueue<FileEvent>(workspace.path)
      this.#queues.set(workspace.id, queue)
    }
    return queue
  }

  async #resolveExisting(root: string, relative: string): Promise<string> {
    assertRelative(relative)
    const candidate = await fs.realpath(path.resolve(root, relative))
    if (!isInside(root, candidate)) throw new Error("workspace path escapes root")
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) throw new Error("workspace path is not a file")
    return candidate
  }

  /**
   * Resolves a target for create-or-overwrite: unlike `#resolveExisting`,
   * the path itself need not exist yet. Missing parent directories are
   * created (a UI "new file in a not-yet-existing subfolder" is a normal
   * flow), then the *parent's* real path is checked against root — a
   * pre-existing symlinked ancestor is exactly the escape `isInside`
   * guards elsewhere in this file, and it applies here too even though
   * the leaf file itself can't be realpath'd before it exists.
   */
  async #resolveForWrite(root: string, relative: string): Promise<string> {
    assertRelative(relative)
    const target = path.resolve(root, relative)
    const parent = path.dirname(target)
    await fs.mkdir(parent, { recursive: true })
    const realParent = await fs.realpath(parent)
    if (!isInside(root, realParent)) throw new Error("workspace path escapes root")
    return path.join(realParent, path.basename(target))
  }

  /**
   * FUNC-004/C5-1: returns undefined for a missing prefix instead of
   * throwing ENOENT — callers (list/search) treat that as an empty result,
   * distinct from "exists but is not a directory" (a real error) and from
   * "escapes root" (a security violation, still thrown).
   */
  async #resolveDirectory(root: string, relative: string): Promise<string | undefined> {
    assertRelative(relative)
    let candidate: string
    try {
      candidate = await fs.realpath(path.resolve(root, relative))
    } catch (error) {
      if (isMissingFileError(error)) return undefined
      throw error
    }
    if (!isInside(root, candidate)) throw new Error("workspace path escapes root")
    const stat = await fs.stat(candidate)
    if (!stat.isDirectory()) throw new Error("workspace path is not a directory")
    return candidate
  }

  /**
   * FUNC-004/C5-1: a symlink/junction whose realpath resolves outside the
   * workspace root is skipped (counted in `skipped`) instead of aborting
   * the whole traversal. Children are sorted so paginated offsets stay
   * stable across calls as long as the tree itself is unchanged. Excluded
   * directory names are neither listed nor descended into. Depth and
   * maxEntries bound the walk without throwing — see list()'s pagination.
   */
  async #walkEntries(root: string, directory: string, query: string | undefined): Promise<{ entries: WorkspaceEntry[]; skipped: number }> {
    const results: WorkspaceEntry[] = []
    let skipped = 0
    const visit = async (current: string, depth: number): Promise<void> => {
      if (results.length >= this.#maxEntries) return
      const children = await fs.readdir(current, { withFileTypes: true })
      children.sort((a, b) => a.name.localeCompare(b.name))
      for (const child of children) {
        if (results.length >= this.#maxEntries) return
        if (this.#excludedNames.has(child.name)) continue
        let absolute: string
        try {
          absolute = await fs.realpath(path.join(current, child.name))
        } catch {
          skipped += 1
          continue
        }
        if (!isInside(root, absolute)) {
          skipped += 1
          continue
        }
        const stat = await fs.stat(absolute)
        const relative = toWorkspacePath(path.relative(root, absolute))
        const entry: WorkspaceEntry = { path: relative, kind: stat.isDirectory() ? "directory" : "file", size: stat.isFile() ? stat.size : 0, modifiedAt: stat.mtimeMs }
        if (!query || relative.toLocaleLowerCase().includes(query)) results.push(entry)
        if (stat.isDirectory() && depth < this.#maxDepth) await visit(absolute, depth + 1)
      }
    }
    await visit(directory, 0)
    return { entries: results, skipped }
  }

  #session(id: FileSessionId): Session {
    const session = this.#sessions.get(id)
    if (!session || session.closed) throw new Error("file session is closed or unknown")
    return session
  }
}
export * from "./storage.js"

export * from "./queue.js"
