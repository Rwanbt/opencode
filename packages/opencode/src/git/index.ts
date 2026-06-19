import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Effect, Layer, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { makeRuntime } from "@/effect/run-service"

export namespace Git {
  const cfg = [
    "--no-optional-locks",
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.longpaths=true",
    "-c",
    "core.symlinks=true",
    "-c",
    "core.quotepath=false",
  ] as const

  const out = (result: { text(): string }) => result.text().trim()
  const nuls = (text: string) => text.split("\0").filter(Boolean)
  const fail = (err: unknown) =>
    ({
      exitCode: 1,
      text: () => "",
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
    }) satisfies Result

  export type Kind = "added" | "deleted" | "modified"

  export type Base = {
    readonly name: string
    readonly ref: string
  }

  export type Item = {
    readonly file: string
    readonly code: string
    readonly status: Kind
  }

  export type Stat = {
    readonly file: string
    readonly additions: number
    readonly deletions: number
  }

  // FORK: Phase 3 — git write types

  export type CommitEntry = {
    readonly hash: string
    readonly shortHash: string
    readonly author: string
    readonly email: string
    readonly timestamp: number
    readonly subject: string
  }

  export type BlameEntry = {
    readonly hash: string
    readonly line: number
    readonly author: string
    readonly timestamp: number
    readonly content: string
  }

  export type BranchEntry = {
    readonly name: string
    readonly current: boolean
    readonly remote: boolean
  }

  export type CommitResult = {
    readonly ok: boolean
    readonly hash: string
    readonly error?: string
  }

  export type PushResult = {
    readonly ok: boolean
    readonly error?: string
  }

  export type PullResult = {
    readonly ok: boolean
    readonly error?: string
  }

  export interface Result {
    readonly exitCode: number
    readonly text: () => string
    readonly stdout: Buffer
    readonly stderr: Buffer
  }

  export interface Options {
    readonly cwd: string
    readonly env?: Record<string, string>
  }

  export interface Interface {
    readonly run: (args: string[], opts: Options) => Effect.Effect<Result>
    readonly branch: (cwd: string) => Effect.Effect<string | undefined>
    readonly prefix: (cwd: string) => Effect.Effect<string>
    readonly defaultBranch: (cwd: string) => Effect.Effect<Base | undefined>
    readonly hasHead: (cwd: string) => Effect.Effect<boolean>
    readonly mergeBase: (cwd: string, base: string, head?: string) => Effect.Effect<string | undefined>
    readonly show: (cwd: string, ref: string, file: string, prefix?: string) => Effect.Effect<string>
    readonly status: (cwd: string) => Effect.Effect<Item[]>
    readonly diff: (cwd: string, ref: string) => Effect.Effect<Item[]>
    readonly stats: (cwd: string, ref: string) => Effect.Effect<Stat[]>
    readonly fetch: (cwd: string, remote?: string) => Effect.Effect<boolean>
    readonly upstream: (cwd: string, branch?: string) => Effect.Effect<string | undefined>
    readonly revCount: (cwd: string, range: string) => Effect.Effect<number>
    // FORK: Phase 3 — write operations
    readonly add: (cwd: string, files?: string[]) => Effect.Effect<boolean>
    readonly reset: (cwd: string, files?: string[]) => Effect.Effect<boolean>
    readonly commit: (cwd: string, message: string) => Effect.Effect<CommitResult>
    readonly push: (cwd: string, remote?: string, branch?: string) => Effect.Effect<PushResult>
    readonly pull: (cwd: string, remote?: string, branch?: string) => Effect.Effect<PullResult>
    readonly log: (cwd: string, limit?: number) => Effect.Effect<CommitEntry[]>
    readonly blame: (cwd: string, file: string) => Effect.Effect<BlameEntry[]>
    readonly branches: (cwd: string) => Effect.Effect<BranchEntry[]>
    readonly createBranch: (cwd: string, name: string, from?: string) => Effect.Effect<boolean>
    readonly switchBranch: (cwd: string, name: string) => Effect.Effect<boolean>
  }

  const kind = (code: string): Kind => {
    if (code === "??") return "added"
    if (code.includes("U")) return "modified"
    if (code.includes("A") && !code.includes("D")) return "added"
    if (code.includes("D") && !code.includes("A")) return "deleted"
    return "modified"
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Git") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const run = Effect.fn("Git.run")(
        function* (args: string[], opts: Options) {
          const proc = ChildProcess.make("git", [...cfg, ...args], {
            cwd: opts.cwd,
            env: opts.env,
            extendEnv: true,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          })
          const handle = yield* spawner.spawn(proc)
          const [stdout, stderr] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          return {
            exitCode: yield* handle.exitCode,
            text: () => stdout,
            stdout: Buffer.from(stdout),
            stderr: Buffer.from(stderr),
          } satisfies Result
        },
        Effect.scoped,
        Effect.catch((err) => Effect.succeed(fail(err))),
      )

      const text = Effect.fn("Git.text")(function* (args: string[], opts: Options) {
        return (yield* run(args, opts)).text()
      })

      const lines = Effect.fn("Git.lines")(function* (args: string[], opts: Options) {
        return (yield* text(args, opts))
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      })

      const refs = Effect.fnUntraced(function* (cwd: string) {
        return yield* lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
      })

      const configured = Effect.fnUntraced(function* (cwd: string, list: string[]) {
        const result = yield* run(["config", "init.defaultBranch"], { cwd })
        const name = out(result)
        if (!name || !list.includes(name)) return
        return { name, ref: name } satisfies Base
      })

      const primary = Effect.fnUntraced(function* (cwd: string) {
        const list = yield* lines(["remote"], { cwd })
        if (list.includes("origin")) return "origin"
        if (list.length === 1) return list[0]
        if (list.includes("upstream")) return "upstream"
        return list[0]
      })

      const branch = Effect.fn("Git.branch")(function* (cwd: string) {
        const result = yield* run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd })
        if (result.exitCode !== 0) return
        const text = out(result)
        return text || undefined
      })

      const prefix = Effect.fn("Git.prefix")(function* (cwd: string) {
        const result = yield* run(["rev-parse", "--show-prefix"], { cwd })
        if (result.exitCode !== 0) return ""
        return out(result)
      })

      const defaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string) {
        const remote = yield* primary(cwd)
        if (remote) {
          const head = yield* run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
          if (head.exitCode === 0) {
            const ref = out(head).replace(/^refs\/remotes\//, "")
            const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
            if (name) return { name, ref } satisfies Base
          }
        }

        const list = yield* refs(cwd)
        const next = yield* configured(cwd, list)
        if (next) return next
        if (list.includes("main")) return { name: "main", ref: "main" } satisfies Base
        if (list.includes("master")) return { name: "master", ref: "master" } satisfies Base
      })

      const hasHead = Effect.fn("Git.hasHead")(function* (cwd: string) {
        const result = yield* run(["rev-parse", "--verify", "HEAD"], { cwd })
        return result.exitCode === 0
      })

      const mergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, base: string, head = "HEAD") {
        const result = yield* run(["merge-base", base, head], { cwd })
        if (result.exitCode !== 0) return
        const text = out(result)
        return text || undefined
      })

      const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, file: string, prefix = "") {
        const target = prefix ? `${prefix}${file}` : file
        const result = yield* run(["show", `${ref}:${target}`], { cwd })
        if (result.exitCode !== 0) return ""
        if (result.stdout.includes(0)) return ""
        return result.text()
      })

      const status = Effect.fn("Git.status")(function* (cwd: string) {
        return nuls(
          yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], {
            cwd,
          }),
        ).flatMap((item) => {
          const file = item.slice(3)
          if (!file) return []
          const code = item.slice(0, 2)
          return [{ file, code, status: kind(code) } satisfies Item]
        })
      })

      const diff = Effect.fn("Git.diff")(function* (cwd: string, ref: string) {
        const list = nuls(
          yield* text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }),
        )
        return list.flatMap((code, idx) => {
          if (idx % 2 !== 0) return []
          const file = list[idx + 1]
          if (!code || !file) return []
          return [{ file, code, status: kind(code) } satisfies Item]
        })
      })

      const stats = Effect.fn("Git.stats")(function* (cwd: string, ref: string) {
        return nuls(
          yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }),
        ).flatMap((item) => {
          const a = item.indexOf("\t")
          const b = item.indexOf("\t", a + 1)
          if (a === -1 || b === -1) return []
          const file = item.slice(b + 1)
          if (!file) return []
          const adds = item.slice(0, a)
          const dels = item.slice(a + 1, b)
          const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
          const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
          return [
            {
              file,
              additions: Number.isFinite(additions) ? additions : 0,
              deletions: Number.isFinite(deletions) ? deletions : 0,
            } satisfies Stat,
          ]
        })
      })

      // Non-mutating network fetch of remote refs. Does not touch working tree
      // or local branches; only updates refs/remotes/* and FETCH_HEAD. Returns
      // false if the remote is unreachable, the caller decides what to do.
      const fetchRemote = Effect.fn("Git.fetch")(function* (cwd: string, remote = "origin") {
        const result = yield* run(["fetch", "--quiet", "--prune", remote], { cwd })
        return result.exitCode === 0
      })

      // Resolve the upstream tracking ref (e.g. "origin/main") for a branch.
      // Returns undefined if the branch is not tracking any remote.
      const upstream = Effect.fn("Git.upstream")(function* (cwd: string, branch?: string) {
        const target = branch ? `${branch}@{upstream}` : "HEAD@{upstream}"
        const result = yield* run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", target], { cwd })
        if (result.exitCode !== 0) return
        const ref = out(result)
        return ref || undefined
      })

      // Count revisions in a range like "HEAD..origin/main" (behind) or
      // "origin/main..HEAD" (ahead). Returns 0 on any failure — callers
      // interpret that as "no divergence detected" rather than propagating.
      const revCount = Effect.fn("Git.revCount")(function* (cwd: string, range: string) {
        const result = yield* run(["rev-list", "--count", range], { cwd })
        if (result.exitCode !== 0) return 0
        const n = Number.parseInt(out(result), 10)
        return Number.isFinite(n) ? n : 0
      })

      // FORK: Phase 3 — write operations ─────────────────────────────────────

      // Stage files. Passing an empty array stages all tracked modifications.
      const add = Effect.fn("Git.add")(function* (cwd: string, files?: string[]) {
        const args = files && files.length > 0 ? ["add", "--", ...files] : ["add", "-A"]
        const result = yield* run(args, { cwd })
        return result.exitCode === 0
      })

      // Unstage files. Passing an empty array unstages everything.
      const reset = Effect.fn("Git.reset")(function* (cwd: string, files?: string[]) {
        const args = files && files.length > 0 ? ["reset", "HEAD", "--", ...files] : ["reset", "HEAD"]
        const result = yield* run(args, { cwd })
        return result.exitCode === 0
      })

      // Create a commit with the given message. Returns CommitResult with
      // the new short hash on success; ok: false + error message on failure.
      const commit = Effect.fn("Git.commit")(function* (cwd: string, message: string) {
        const result = yield* run(["commit", "-m", message], { cwd })
        if (result.exitCode !== 0) {
          return {
            ok: false,
            hash: "",
            error: result.stderr.toString("utf8").trim() || "git commit failed",
          } satisfies CommitResult
        }
        const hashResult = yield* run(["rev-parse", "--short", "HEAD"], { cwd })
        return { ok: true, hash: out(hashResult) || "" } satisfies CommitResult
      })

      // Push the current branch to remote. Uses system credential helpers.
      // Phase 3 does not add SSH/token UI — that is a dedicated sub-project.
      const push = Effect.fn("Git.push")(function* (cwd: string, remote = "origin", branch?: string) {
        const args = branch ? ["push", remote, branch] : ["push", remote]
        const result = yield* run(args, { cwd })
        return {
          ok: result.exitCode === 0,
          error: result.exitCode !== 0 ? result.stderr.toString("utf8").trim() : undefined,
        } satisfies PushResult
      })

      // Pull from remote. Uses --rebase to keep history linear.
      const pull = Effect.fn("Git.pull")(function* (cwd: string, remote = "origin", branch?: string) {
        const args = branch ? ["pull", "--rebase", remote, branch] : ["pull", "--rebase", remote]
        const result = yield* run(args, { cwd })
        return {
          ok: result.exitCode === 0,
          error: result.exitCode !== 0 ? result.stderr.toString("utf8").trim() : undefined,
        } satisfies PullResult
      })

      // Return the commit log. Uses unit-separator (0x1F) as field delimiter
      // and NUL as commit delimiter — both safe against message content.
      const log = Effect.fn("Git.log")(function* (cwd: string, limit = 50) {
        const format = ["%H", "%h", "%an", "%ae", "%at", "%s"].join("\x1f") + "\x00"
        const result = yield* run(["log", `--max-count=${limit}`, `--format=${format}`], { cwd })
        if (result.exitCode !== 0) return [] as CommitEntry[]
        return result
          .text()
          .split("\0")
          .filter(Boolean)
          .flatMap((entry): CommitEntry[] => {
            const parts = entry.split("\x1f")
            if (parts.length < 6) return []
            const ts = Number.parseInt(parts[4] ?? "0", 10)
            return [
              {
                hash: parts[0] ?? "",
                shortHash: parts[1] ?? "",
                author: parts[2] ?? "",
                email: parts[3] ?? "",
                timestamp: Number.isFinite(ts) ? ts : 0,
                subject: parts[5] ?? "",
              },
            ]
          })
      })

      // Return blame info for a file. Uses porcelain format for reliable parsing.
      const blame = Effect.fn("Git.blame")(function* (cwd: string, file: string) {
        const result = yield* run(["blame", "--porcelain", "--", file], { cwd })
        if (result.exitCode !== 0) return [] as BlameEntry[]
        const entries: BlameEntry[] = []
        let currentHash = ""
        let currentAuthor = ""
        let currentTimestamp = 0
        let currentLine = 0
        for (const rawLine of result.text().split("\n")) {
          const line = rawLine.trimEnd()
          // Boundary line: "<40-hex> <orig-line> <result-line> [<count>]"
          const boundaryMatch = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line)
          if (boundaryMatch) {
            currentHash = boundaryMatch[1] ?? ""
            currentLine = Number.parseInt(boundaryMatch[2] ?? "0", 10)
            continue
          }
          if (line.startsWith("author ")) {
            currentAuthor = line.slice(7)
            continue
          }
          if (line.startsWith("committer-time ")) {
            currentTimestamp = Number.parseInt(line.slice(15), 10)
            continue
          }
          if (line.startsWith("\t")) {
            entries.push({
              hash: currentHash,
              line: currentLine,
              author: currentAuthor,
              timestamp: Number.isFinite(currentTimestamp) ? currentTimestamp : 0,
              content: line.slice(1),
            })
          }
        }
        return entries
      })

      // List all branches (local and remote tracking). Marks the current branch.
      const branches = Effect.fn("Git.branches")(function* (cwd: string) {
        const result = yield* run(["branch", "-a", "--format=%(refname:short)\x1f%(HEAD)"], { cwd })
        if (result.exitCode !== 0) return [] as BranchEntry[]
        return result
          .text()
          .split(/\r?\n/)
          .filter(Boolean)
          .flatMap((line): BranchEntry[] => {
            const sep = line.indexOf("\x1f")
            if (sep === -1) return []
            const name = line.slice(0, sep).trim()
            const head = line.slice(sep + 1).trim()
            if (!name) return []
            return [{ name, current: head === "*", remote: name.startsWith("remotes/") }]
          })
      })

      // Create and switch to a new branch. Optionally specify the start point.
      const createBranch = Effect.fn("Git.createBranch")(function* (cwd: string, name: string, from?: string) {
        const args = from ? ["checkout", "-b", name, from] : ["checkout", "-b", name]
        const result = yield* run(args, { cwd })
        return result.exitCode === 0
      })

      // Switch to an existing local branch.
      const switchBranch = Effect.fn("Git.switchBranch")(function* (cwd: string, name: string) {
        const result = yield* run(["checkout", name], { cwd })
        return result.exitCode === 0
      })

      return Service.of({
        run,
        branch,
        prefix,
        defaultBranch,
        hasHead,
        mergeBase,
        show,
        status,
        diff,
        stats,
        fetch: fetchRemote,
        upstream,
        revCount,
        add,
        reset,
        commit,
        push,
        pull,
        log,
        blame,
        branches,
        createBranch,
        switchBranch,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(CrossSpawnSpawner.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function run(args: string[], opts: Options) {
    return runPromise((git) => git.run(args, opts))
  }

  export async function branch(cwd: string) {
    return runPromise((git) => git.branch(cwd))
  }

  export async function prefix(cwd: string) {
    return runPromise((git) => git.prefix(cwd))
  }

  export async function defaultBranch(cwd: string) {
    return runPromise((git) => git.defaultBranch(cwd))
  }

  export async function hasHead(cwd: string) {
    return runPromise((git) => git.hasHead(cwd))
  }

  export async function mergeBase(cwd: string, base: string, head?: string) {
    return runPromise((git) => git.mergeBase(cwd, base, head))
  }

  export async function show(cwd: string, ref: string, file: string, prefix?: string) {
    return runPromise((git) => git.show(cwd, ref, file, prefix))
  }

  export async function status(cwd: string) {
    return runPromise((git) => git.status(cwd))
  }

  export async function diff(cwd: string, ref: string) {
    return runPromise((git) => git.diff(cwd, ref))
  }

  export async function stats(cwd: string, ref: string) {
    return runPromise((git) => git.stats(cwd, ref))
  }

  export async function fetch(cwd: string, remote?: string) {
    return runPromise((git) => git.fetch(cwd, remote))
  }

  export async function upstream(cwd: string, branch?: string) {
    return runPromise((git) => git.upstream(cwd, branch))
  }

  export async function revCount(cwd: string, range: string) {
    return runPromise((git) => git.revCount(cwd, range))
  }

  // FORK: Phase 3 — write operation wrappers ─────────────────────────────────

  export async function workingStatus(cwd: string) {
    return runPromise((git) => git.status(cwd))
  }

  export async function add(cwd: string, files?: string[]) {
    return runPromise((git) => git.add(cwd, files))
  }

  export async function reset(cwd: string, files?: string[]) {
    return runPromise((git) => git.reset(cwd, files))
  }

  export async function commit(cwd: string, message: string): Promise<CommitResult> {
    return runPromise((git) => git.commit(cwd, message))
  }

  export async function push(cwd: string, remote?: string, branch?: string) {
    return runPromise((git) => git.push(cwd, remote, branch))
  }

  export async function pull(cwd: string, remote?: string, branch?: string) {
    return runPromise((git) => git.pull(cwd, remote, branch))
  }

  export async function log(cwd: string, limit?: number) {
    return runPromise((git) => git.log(cwd, limit))
  }

  export async function blame(cwd: string, file: string) {
    return runPromise((git) => git.blame(cwd, file))
  }

  export async function branches(cwd: string) {
    return runPromise((git) => git.branches(cwd))
  }

  export async function createBranch(cwd: string, name: string, from?: string) {
    return runPromise((git) => git.createBranch(cwd, name, from))
  }

  export async function switchBranch(cwd: string, name: string) {
    return runPromise((git) => git.switchBranch(cwd, name))
  }
}
