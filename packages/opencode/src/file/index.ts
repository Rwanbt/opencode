import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { Git } from "@/git"
import { Cause, Effect, Layer, ServiceMap } from "effect"
import { formatPatch, structuredPatch } from "diff"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import { createHash } from "node:crypto"
import { mkdir as fsMkdir, open as fsOpen, rename as fsRename, rm as fsRm } from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Bus } from "../bus"
import { Format } from "../format"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { LSP } from "../lsp"
import { Protected } from "./protected"
import { Ripgrep } from "./ripgrep"
import { FileTime } from "./time"
import { FileWatcher } from "./watcher"

export namespace File {
  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .meta({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  export const Node = z
    .object({
      name: z.string(),
      path: z.string(),
      absolute: z.string(),
      type: z.enum(["file", "directory"]),
      ignored: z.boolean(),
    })
    .meta({
      ref: "FileNode",
    })
  export type Node = z.infer<typeof Node>

  export const Content = z
    .object({
      type: z.enum(["text", "binary"]),
      content: z.string(),
      diff: z.string().optional(),
      patch: z
        .object({
          oldFileName: z.string(),
          newFileName: z.string(),
          oldHeader: z.string().optional(),
          newHeader: z.string().optional(),
          hunks: z.array(
            z.object({
              oldStart: z.number(),
              oldLines: z.number(),
              newStart: z.number(),
              newLines: z.number(),
              lines: z.array(z.string()),
            }),
          ),
          index: z.string().optional(),
        })
        .optional(),
      encoding: z.literal("base64").optional(),
      mimeType: z.string().optional(),
    })
    .meta({
      ref: "FileContent",
    })
  export type Content = z.infer<typeof Content>

  export const Event = {
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  const log = Log.create({ service: "file" })

  const binary = new Set([
    "exe",
    "dll",
    "pdb",
    "bin",
    "so",
    "dylib",
    "o",
    "a",
    "lib",
    "wav",
    "mp3",
    "ogg",
    "oga",
    "ogv",
    "ogx",
    "flac",
    "aac",
    "wma",
    "m4a",
    "weba",
    "mp4",
    "avi",
    "mov",
    "wmv",
    "flv",
    "webm",
    "mkv",
    "zip",
    "tar",
    "gz",
    "gzip",
    "bz",
    "bz2",
    "bzip",
    "bzip2",
    "7z",
    "rar",
    "xz",
    "lz",
    "z",
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "dmg",
    "iso",
    "img",
    "vmdk",
    "ttf",
    "otf",
    "woff",
    "woff2",
    "eot",
    "sqlite",
    "db",
    "mdb",
    "apk",
    "ipa",
    "aab",
    "xapk",
    "app",
    "pkg",
    "deb",
    "rpm",
    "snap",
    "flatpak",
    "appimage",
    "msi",
    "msp",
    "jar",
    "war",
    "ear",
    "class",
    "kotlin_module",
    "dex",
    "vdex",
    "odex",
    "oat",
    "art",
    "wasm",
    "wat",
    "bc",
    "ll",
    "s",
    "ko",
    "sys",
    "drv",
    "efi",
    "rom",
    "com",
  ])

  const image = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "webp",
    "ico",
    "tif",
    "tiff",
    "svg",
    "svgz",
    "avif",
    "apng",
    "jxl",
    "heic",
    "heif",
    "raw",
    "cr2",
    "nef",
    "arw",
    "dng",
    "orf",
    "raf",
    "pef",
    "x3f",
  ])

  const text = new Set([
    "ts",
    "tsx",
    "mts",
    "cts",
    "mtsx",
    "ctsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "psm1",
    "cmd",
    "bat",
    "json",
    "jsonc",
    "json5",
    "yaml",
    "yml",
    "toml",
    "md",
    "mdx",
    "txt",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "graphql",
    "gql",
    "sql",
    "ini",
    "cfg",
    "conf",
    "env",
  ])

  const textName = new Set([
    "dockerfile",
    "makefile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".npmrc",
    ".nvmrc",
    ".prettierrc",
    ".eslintrc",
  ])

  const mime: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    ico: "image/x-icon",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
    svgz: "image/svg+xml",
    avif: "image/avif",
    apng: "image/apng",
    jxl: "image/jxl",
    heic: "image/heic",
    heif: "image/heif",
  }

  type Entry = { files: string[]; dirs: string[] }

  const ext = (file: string) => path.extname(file).toLowerCase().slice(1)
  const name = (file: string) => path.basename(file).toLowerCase()
  const isImageByExtension = (file: string) => image.has(ext(file))
  const isTextByExtension = (file: string) => text.has(ext(file))
  const isTextByName = (file: string) => textName.has(name(file))
  const isBinaryByExtension = (file: string) => binary.has(ext(file))
  const isImage = (mimeType: string) => mimeType.startsWith("image/")
  const getImageMimeType = (file: string) => mime[ext(file)] || "image/" + ext(file)

  function shouldEncode(mimeType: string) {
    const type = mimeType.toLowerCase()
    log.debug("shouldEncode", { type })
    if (!type) return false
    if (type.startsWith("text/")) return false
    if (type.includes("charset=")) return false
    const top = type.split("/", 2)[0]
    return ["image", "audio", "video", "font", "model", "multipart"].includes(top)
  }

  const hidden = (item: string) => {
    const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
    return normalized.split("/").some((part) => part.startsWith(".") && part.length > 1)
  }

  const sortHiddenLast = (items: string[], prefer: boolean) => {
    if (prefer) return items
    const visible: string[] = []
    const hiddenItems: string[] = []
    for (const item of items) {
      if (hidden(item)) hiddenItems.push(item)
      else visible.push(item)
    }
    return [...visible, ...hiddenItems]
  }

  // Guard against symlink escapes: Instance.containsPath is a *textual* check on
  // the joined path, so a symlink planted at `project/docs/evil` pointing to
  // `/etc` would still pass. Resolve the real path and re-check containment. For
  // paths that do not exist yet, the canonical form falls back to the textual
  // path — use assertWritableTarget for write/create targets.
  // Module-scope so both the Effect service (read/list/mkdir) and the file write
  // API (write/rename/move/delete) share one guard. See ADR-0004.
  function assertInsideProject(full: string) {
    if (!Instance.containsPath(full)) {
      throw new Error("Access denied: path escapes project directory")
    }
    try {
      const real = AppFileSystem.resolve(full)
      if (!Instance.containsPath(real)) {
        throw new Error("Access denied: symlink escapes project directory")
      }
    } catch (e: any) {
      if (typeof e?.message === "string" && e.message.startsWith("Access denied")) {
        throw e
      }
      // Missing path or permission issue — the textual check already passed.
    }
  }

  // FORK: file write API (ADR-0004) — parent-aware escape guard.
  // For a target that may not exist yet (write/create, rename/move destination),
  // AppFileSystem.resolve(full) returns the textual path, so a symlinked parent
  // pointing outside the project would slip through assertInsideProject. Resolve
  // the nearest EXISTING ancestor and re-check containment against its realpath.
  function assertWritableTarget(full: string) {
    assertInsideProject(full)
    let ancestor = path.dirname(full)
    while (ancestor && ancestor !== path.dirname(ancestor)) {
      if (Filesystem.stat(ancestor)) {
        const real = AppFileSystem.resolve(ancestor)
        if (!Instance.containsPath(real)) {
          throw new Error("Access denied: symlink escapes project directory")
        }
        return
      }
      ancestor = path.dirname(ancestor)
    }
  }
  // END FORK

  interface State {
    cache: Entry
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<File.Info[]>
    readonly read: (file: string) => Effect.Effect<File.Content>
    readonly list: (dir?: string) => Effect.Effect<File.Node[]>
    readonly mkdir: (dir: string) => Effect.Effect<{ absolute: string }>
    readonly search: (input: {
      query: string
      limit?: number
      dirs?: boolean
      type?: "file" | "directory"
    }) => Effect.Effect<string[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/File") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("File.state")(() =>
          Effect.succeed({
            cache: { files: [], dirs: [] } as Entry,
          }),
        ),
      )

      const scan = Effect.fn("File.scan")(function* () {
        if (Instance.directory === path.parse(Instance.directory).root) return
        const isGlobalHome = Instance.directory === Global.Path.home && Instance.project.id === "global"
        const next: Entry = { files: [], dirs: [] }

        if (isGlobalHome) {
          const dirs = new Set<string>()
          const protectedNames = Protected.names()
          const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
          const shouldIgnoreName = (name: string) => name.startsWith(".") || protectedNames.has(name)
          const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)
          const top = yield* appFs.readDirectoryEntries(Instance.directory).pipe(
            // DEBT: D-10 — don't swallow scan failures silently; an unreadable
            // top dir means an incomplete listing, which must be observable.
            Effect.catchCause((cause) => {
              log.warn("readDirectoryEntries failed; listing may be incomplete", {
                dir: Instance.directory,
                cause: Cause.pretty(cause),
              })
              return Effect.succeed([])
            }),
          )

          for (const entry of top) {
            if (entry.type !== "directory") continue
            if (shouldIgnoreName(entry.name)) continue
            dirs.add(entry.name + "/")

            const base = path.join(Instance.directory, entry.name)
            const children = yield* appFs.readDirectoryEntries(base).pipe(
              // DEBT: D-10 — log rather than silently dropping a subtree.
              Effect.catchCause((cause) => {
                log.warn("readDirectoryEntries failed; subtree skipped", {
                  dir: base,
                  cause: Cause.pretty(cause),
                })
                return Effect.succeed([])
              }),
            )
            for (const child of children) {
              if (child.type !== "directory") continue
              if (shouldIgnoreNested(child.name)) continue
              dirs.add(entry.name + "/" + child.name + "/")
            }
          }

          next.dirs = Array.from(dirs).toSorted()
        } else {
          const files = yield* Effect.promise(() => Array.fromAsync(Ripgrep.files({ cwd: Instance.directory })))
          const seen = new Set<string>()
          for (const file of files) {
            next.files.push(file)
            let current = file
            while (true) {
              const dir = path.dirname(current)
              if (dir === ".") break
              if (dir === current) break
              current = dir
              if (seen.has(dir)) continue
              seen.add(dir)
              next.dirs.push(dir + "/")
            }
          }
        }

        const s = yield* InstanceState.get(state)
        s.cache = next
      })

      // DEBT: D-11 — a failed scan used to invalidate the cache silently. Log
      // the cause so a stale or empty file cache is diagnosable.
      const scanLoggingCause = (cause: Cause.Cause<unknown>) => {
        log.warn("file scan failed; cache may be stale", { cause: Cause.pretty(cause) })
        return Effect.void
      }
      let cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(scanLoggingCause)))

      const ensure = Effect.fn("File.ensure")(function* () {
        yield* cachedScan
        cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(scanLoggingCause)))
      })

      const init = Effect.fn("File.init")(function* () {
        yield* ensure()
      })

      const status = Effect.fn("File.status")(function* () {
        if (Instance.project.vcs !== "git") return []

        return yield* Effect.promise(async () => {
          const diffOutput = (
            await Git.run(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "diff", "--numstat", "HEAD"], {
              cwd: Instance.directory,
            })
          ).text()

          const changed: File.Info[] = []

          if (diffOutput.trim()) {
            for (const line of diffOutput.trim().split("\n")) {
              const [added, removed, file] = line.split("\t")
              changed.push({
                path: file,
                added: added === "-" ? 0 : parseInt(added, 10),
                removed: removed === "-" ? 0 : parseInt(removed, 10),
                status: "modified",
              })
            }
          }

          const untrackedOutput = (
            await Git.run(
              [
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.quotepath=false",
                "ls-files",
                "--others",
                "--exclude-standard",
              ],
              {
                cwd: Instance.directory,
              },
            )
          ).text()

          if (untrackedOutput.trim()) {
            for (const file of untrackedOutput.trim().split("\n")) {
              try {
                const content = await Filesystem.readText(path.join(Instance.directory, file))
                changed.push({
                  path: file,
                  added: content.split("\n").length,
                  removed: 0,
                  status: "added",
                })
              } catch {
              }
            }
          }

          const deletedOutput = (
            await Git.run(
              [
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.quotepath=false",
                "diff",
                "--name-only",
                "--diff-filter=D",
                "HEAD",
              ],
              {
                cwd: Instance.directory,
              },
            )
          ).text()

          if (deletedOutput.trim()) {
            for (const file of deletedOutput.trim().split("\n")) {
              changed.push({
                path: file,
                added: 0,
                removed: 0,
                status: "deleted",
              })
            }
          }

          return changed.map((item) => {
            const full = path.isAbsolute(item.path) ? item.path : path.join(Instance.directory, item.path)
            return {
              ...item,
              path: path.relative(Instance.directory, full),
            }
          })
        })
      })

      const read = Effect.fn("File.read")(function* (file: string) {
        using _ = log.time("read", { file })
        const full = path.join(Instance.directory, file)

        assertInsideProject(full)

        if (isImageByExtension(file)) {
          const exists = yield* appFs.existsSafe(full)
          if (exists) {
            const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
            return {
              type: "text" as const,
              content: Buffer.from(bytes).toString("base64"),
              mimeType: getImageMimeType(file),
              encoding: "base64" as const,
            }
          }
          return { type: "text" as const, content: "" }
        }

        const knownText = isTextByExtension(file) || isTextByName(file)

        if (isBinaryByExtension(file) && !knownText) return { type: "binary" as const, content: "" }

        const exists = yield* appFs.existsSafe(full)
        if (!exists) return { type: "text" as const, content: "" }

        const mimeType = AppFileSystem.mimeType(full)
        const encode = knownText ? false : shouldEncode(mimeType)

        if (encode && !isImage(mimeType)) return { type: "binary" as const, content: "", mimeType }

        if (encode) {
          const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
          return {
            type: "text" as const,
            content: Buffer.from(bytes).toString("base64"),
            mimeType,
            encoding: "base64" as const,
          }
        }

        // Delegate to readRaw() so the editor (readRaw) and viewer (read)
        // share a single source of truth on disk bytes. Phase 2.3 — keeps the
        // empty-string contract on missing/directory paths via Effect.catch.
        const raw = yield* Effect.promise(() => readRaw(file)).pipe(
          Effect.catch(() => Effect.succeed({ content: "", stamp: { hash: "" } })),
        )
        const content = raw.content

        if (Instance.project.vcs === "git") {
          return yield* Effect.promise(async (): Promise<File.Content> => {
            let diff = (
              await Git.run(["-c", "core.fsmonitor=false", "diff", "--", file], { cwd: Instance.directory })
            ).text()
            if (!diff.trim()) {
              diff = (
                await Git.run(["-c", "core.fsmonitor=false", "diff", "--staged", "--", file], {
                  cwd: Instance.directory,
                })
              ).text()
            }
            if (diff.trim()) {
              const original = (await Git.run(["show", `HEAD:${file}`], { cwd: Instance.directory })).text()
              const patch = structuredPatch(file, file, original, content, "old", "new", {
                context: Infinity,
                ignoreWhitespace: true,
              })
              return { type: "text", content, patch, diff: formatPatch(patch) }
            }
            return { type: "text", content }
          })
        }

        return { type: "text" as const, content }
      })

      const list = Effect.fn("File.list")(function* (dir?: string) {
        const exclude = [".git", ".DS_Store"]
        let ignored = (_: string) => false
        if (Instance.project.vcs === "git") {
          const ig = ignore()
          const gitignore = path.join(Instance.project.worktree, ".gitignore")
          const gitignoreText = yield* appFs.readFileString(gitignore).pipe(Effect.catch(() => Effect.succeed("")))
          if (gitignoreText) ig.add(gitignoreText)
          const ignoreFile = path.join(Instance.project.worktree, ".ignore")
          const ignoreText = yield* appFs.readFileString(ignoreFile).pipe(Effect.catch(() => Effect.succeed("")))
          if (ignoreText) ig.add(ignoreText)
          ignored = ig.ignores.bind(ig)
        }

        const resolved = dir ? path.join(Instance.directory, dir) : Instance.directory
        assertInsideProject(resolved)

        const entries = yield* appFs.readDirectoryEntries(resolved).pipe(
          // DEBT: D-10 — surface scan failures instead of returning an empty list.
          Effect.catchCause((cause) => {
            log.warn("readDirectoryEntries failed; listing may be incomplete", {
              dir: resolved,
              cause: Cause.pretty(cause),
            })
            return Effect.succeed([])
          }),
        )

        const nodes: File.Node[] = []
        for (const entry of entries) {
          if (exclude.includes(entry.name)) continue
          const absolute = path.join(resolved, entry.name)
          const file = path.relative(Instance.directory, absolute)
          const type = entry.type === "directory" ? "directory" : "file"
          nodes.push({
            name: entry.name,
            path: file,
            absolute,
            type,
            ignored: ignored(type === "directory" ? file + "/" : file),
          })
        }
        return nodes.sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      })

      const search = Effect.fn("File.search")(function* (input: {
        query: string
        limit?: number
        dirs?: boolean
        type?: "file" | "directory"
      }) {
        yield* ensure()
        const { cache } = yield* InstanceState.get(state)

        const query = input.query.trim()
        const limit = input.limit ?? 100
        const kind = input.type ?? (input.dirs === false ? "file" : "all")
        log.info("search", { query, kind })

        const preferHidden = query.startsWith(".") || query.includes("/.")

        if (!query) {
          if (kind === "file") return cache.files.slice(0, limit)
          return sortHiddenLast(cache.dirs.toSorted(), preferHidden).slice(0, limit)
        }

        const items =
          kind === "file" ? cache.files : kind === "directory" ? cache.dirs : [...cache.files, ...cache.dirs]

        const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
        const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((item) => item.target)
        const output = kind === "directory" ? sortHiddenLast(sorted, preferHidden).slice(0, limit) : sorted

        log.info("search", { query, kind, results: output.length })
        return output
      })

      const mkdir = Effect.fn("File.mkdir")(function* (dir: string) {
        const resolved = path.isAbsolute(dir) ? dir : path.join(Instance.directory, dir)
        // assertInsideProject falls back to a textual check if the target
        // does not yet exist (mkdir's normal case), which is fine: any
        // symlink on the parent chain would itself be detected because
        // AppFileSystem.resolve walks existing segments.
        assertInsideProject(resolved)
        // DEBT: D-11 — a swallowed mkdir failure looked like success; log it.
        yield* appFs.ensureDir(resolved).pipe(
          Effect.catch((err) => {
            log.warn("ensureDir failed", { dir: resolved, error: String(err) })
            return Effect.void
          }),
        )
        return { absolute: resolved }
      })

      log.info("init")
      return Service.of({ init, status, read, list, mkdir, search })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function init() {
    return runPromise((svc) => svc.init())
  }

  export async function status() {
    return runPromise((svc) => svc.status())
  }

  export async function read(file: string): Promise<Content> {
    return runPromise((svc) => svc.read(file))
  }

  export async function list(dir?: string) {
    return runPromise((svc) => svc.list(dir))
  }

  export async function mkdir(dir: string) {
    return runPromise((svc) => svc.mkdir(dir))
  }

  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    return runPromise((svc) => svc.search(input))
  }

  // FORK: file write API for the human editor (ADR-0004) — write/rename/move/delete.
  // Implemented as plain async namespace functions (not through the Effect service)
  // because they orchestrate other runPromise-backed APIs (FileTime.withLock, LSP,
  // Bus) imperatively. Conflict = content sha256 (stateless, robust on Android FUSE
  // where mtime is unreliable). Writes are atomic (temp + fsync + rename). Text-only;
  // format-on-save lives in the editor frontend (PR 1b).

  export interface Stamp {
    hash: string
    mtime: number | undefined
    size: number | undefined
  }

  export interface RawContent {
    content: string
    stamp: Stamp
  }

  // 409 — file changed on disk since the client read it (or precondition stale).
  export class ConflictError extends Error {
    constructor(
      readonly file: string,
      message: string,
    ) {
      super(message)
      this.name = "FileConflictError"
    }
  }
  // 404 — operation target does not exist.
  export class PathNotFoundError extends Error {
    constructor(readonly file: string) {
      super(`File not found: ${file}`)
      this.name = "FilePathNotFoundError"
    }
  }
  // 409 — destination already exists (best-effort no-clobber).
  export class TargetExistsError extends Error {
    constructor(readonly file: string) {
      super(`Destination already exists: ${file}`)
      this.name = "FileTargetExistsError"
    }
  }

  function hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex")
  }

  function stampOf(content: string, info: ReturnType<typeof Filesystem.stat>): Stamp {
    const size = info?.size
    return {
      hash: hashContent(content),
      mtime: info?.mtimeMs !== undefined ? Math.floor(Number(info.mtimeMs)) : undefined,
      size: size !== undefined ? Number(size) : undefined,
    }
  }

  async function diskStamp(full: string): Promise<Stamp> {
    const content = await Filesystem.readText(full)
    return stampOf(content, Filesystem.stat(full))
  }

  // Atomic write: temp file in the same directory, fsync, then rename. Never
  // leaves a truncated target on crash / process kill / sdcard-full / FUSE glitch.
  async function atomicWrite(full: string, content: string): Promise<void> {
    const dir = path.dirname(full)
    await fsMkdir(dir, { recursive: true })
    const tmp = path.join(dir, `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`)
    const handle = await fsOpen(tmp, "w")
    try {
      await handle.writeFile(content, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fsRename(tmp, full)
    } catch (e) {
      await fsRm(tmp, { force: true }).catch(() => {})
      throw e
    }
    // FORK (BUG-A Phase 8 diagnostic): re-read full to confirm the rename landed.
    // On Windows + antivirus/FUSE/OneDrive, the rename can succeed at the API
    // level but the FS still serves cached old bytes until next flush. We log a
    // warning so the next save failure has a hook without paying a hash cost.
    try {
      const written = await Filesystem.readText(full)
      if (written !== content) {
        log.warn("atomicWrite post-rename mismatch — FS may be caching old bytes", {
          full,
          expectedLen: content.length,
          actualLen: written.length,
        })
      }
    } catch (e) {
      log.warn("atomicWrite post-rename read-back failed", { full, error: String(e) })
    }
  }

  async function notifyWrite(full: string, kind: "add" | "change") {
    const key = toCanonicalRelative(full)
    Bus.publish(Event.Edited, { file: key })
    await Bus.publish(FileWatcher.Event.Updated, { file: key, event: kind })
    // LSP refresh is best-effort in 1a; the editor consumes diagnostics in Phase 2.
    // LSP.touchFile still takes the absolute path — its own internal contract.
    await LSP.touchFile(full, false).catch(() => {})
  }

  async function notifyDelete(full: string) {
    const key = toCanonicalRelative(full)
    Bus.publish(Event.Edited, { file: key })
    await Bus.publish(FileWatcher.Event.Updated, { file: key, event: "unlink" })
    await LSP.touchFile(full, false).catch(() => {})
  }

  // WHY (R2 in PLAN-EDITEUR-IDE-DEFINITIF): the frontend FileStore keys file
  // content by the canonical key produced by
  // packages/app/src/context/file/canonical.ts — forward-slash, no `file://`,
  // no query/hash, no git quoting, relative to the project root. Publishing
  // that exact shape from the backend makes the contract structural: the
  // client never has to defensively re-normalize. Native parcel/watcher
  // callbacks and our own writes produce absolute native paths
  // ("D:\\repo\\src\\app.ts" on win32). This function is the ONE place that
  // converts absolute → relative-canonical for event payloads.
  // LSP and other consumers that need an absolute path must keep using `full`.
  export function toCanonicalRelative(full: string): string {
    const rel = path.relative(Instance.directory, full)
    return rel.split(path.sep).join("/")
  }

  // Result of a write: the FINAL on-disk content (may differ from the sent
  // content when format=true reformatted it) + its stamp, so the editor can
  // reconcile its buffer and keep the next save's hash precondition correct.
  export interface WriteResult {
    content: string
    stamp: Stamp
    formatted: boolean
  }

  /**
   * Write text content to a file, guarded by a content-hash precondition.
   * - expectedHash present: overwrite only if the on-disk content still hashes to it (else 409).
   * - expectedHash absent: create only if the file does not exist (else 409 — no blind overwrite).
   * - format: after writing the raw content, run Format.file best-effort (it never
   *   throws, rewrites in place), under the same lock = atomic write→format→reread.
   *   Returns the final on-disk content; `formatted` indicates the formatter changed it.
   */
  export async function write(input: {
    path: string
    content: string
    expectedHash?: string
    format?: boolean
  }): Promise<WriteResult> {
    // FORK (BUG-A Phase 8): refuse absolute paths. On win32, `path.join(root, abs)`
    // silently truncates to `abs`, hiding cross-project writes. Frontend must send
    // project-relative paths via canonical().
    if (path.isAbsolute(input.path)) {
      throw new Error(
        `File.write: input.path must be relative to project root, got absolute: ${input.path}`,
      )
    }
    const full = path.join(Instance.directory, input.path)
    assertWritableTarget(full)
    return FileTime.withLock(full, async () => {
      const exists = await Filesystem.exists(full)
      if (exists) {
        if (input.expectedHash === undefined) {
          throw new ConflictError(input.path, "expectedHash is required to overwrite an existing file")
        }
        const current = await diskStamp(full)
        if (current.hash !== input.expectedHash) {
          throw new ConflictError(input.path, "File changed on disk since it was last read")
        }
      } else if (input.expectedHash !== undefined) {
        throw new ConflictError(input.path, "File no longer exists (a hash precondition was supplied)")
      }
      // Write the raw content first — it is always safely on disk even if a
      // later format step is interrupted (no data loss).
      await atomicWrite(full, input.content)
      let finalContent = input.content
      let formatted = false
      if (input.format) {
        await Format.file(full).catch(() => {})
        finalContent = await Filesystem.readText(full)
        formatted = finalContent !== input.content
      }
      await notifyWrite(full, exists ? "change" : "add")
      return { content: finalContent, stamp: stampOf(finalContent, Filesystem.stat(full)), formatted }
    })
  }

  /** Read raw (untrimmed) text + stamp, so the editor can round-trip the exact bytes for hashing. */
  export async function readRaw(file: string): Promise<RawContent> {
    // FORK (BUG-A Phase 8): same defensive check as write() — refuse absolute.
    if (path.isAbsolute(file)) {
      throw new Error(
        `File.readRaw: file must be relative to project root, got absolute: ${file}`,
      )
    }
    const full = path.join(Instance.directory, file)
    assertInsideProject(full)
    if (!(await Filesystem.exists(full))) throw new PathNotFoundError(file)
    if (await Filesystem.isDir(full)) throw new PathNotFoundError(file)
    const content = await Filesystem.readText(full)
    return { content, stamp: stampOf(content, Filesystem.stat(full)) }
  }

  async function relocate(from: string, to: string, expectedHash?: string): Promise<Stamp> {
    const fromFull = path.join(Instance.directory, from)
    const toFull = path.join(Instance.directory, to)
    if (fromFull === toFull) throw new Error("Source and destination are the same path")
    assertInsideProject(fromFull)
    assertWritableTarget(toFull)
    const [first, second] = [fromFull, toFull].sort()
    return FileTime.withLock(first, () =>
      FileTime.withLock(second, async () => {
        if (!(await Filesystem.exists(fromFull))) throw new PathNotFoundError(from)
        if (expectedHash !== undefined) {
          const current = await diskStamp(fromFull)
          if (current.hash !== expectedHash) {
            throw new ConflictError(from, "Source changed on disk since it was last read")
          }
        }
        // Best-effort no-clobber: POSIX rename(2) overwrites and there is no atomic
        // cross-platform no-replace primitive in Node/Bun (ADR-0004).
        if (await Filesystem.exists(toFull)) throw new TargetExistsError(to)
        await fsMkdir(path.dirname(toFull), { recursive: true })
        await fsRename(fromFull, toFull)
        await notifyDelete(fromFull)
        await notifyWrite(toFull, "add")
        return diskStamp(toFull)
      }),
    )
  }

  export function rename(from: string, to: string, expectedHash?: string): Promise<Stamp> {
    return relocate(from, to, expectedHash)
  }

  export function move(from: string, to: string, expectedHash?: string): Promise<Stamp> {
    return relocate(from, to, expectedHash)
  }

  /** Delete a file or directory. 404 if absent; optional source-hash precondition (files only). */
  export async function remove(input: { path: string; expectedHash?: string }): Promise<void> {
    const full = path.join(Instance.directory, input.path)
    assertInsideProject(full)
    return FileTime.withLock(full, async () => {
      if (!(await Filesystem.exists(full))) throw new PathNotFoundError(input.path)
      const isDirectory = await Filesystem.isDir(full)
      if (isDirectory) throw new Error("Access denied: cannot remove a directory")
      if (input.expectedHash !== undefined) {
        const current = await diskStamp(full)
        if (current.hash !== input.expectedHash) {
          throw new ConflictError(input.path, "File changed on disk since it was last read")
        }
      }
      await fsRm(full, { recursive: isDirectory, force: false })
      await notifyDelete(full)
    })
  }
  // END FORK
}
