// FORK: Phase 3 — Git write routes (ADR-0005 roadmap).
// Exposes the git write layer (add/reset/commit/push/pull/log/blame/branches)
// over HTTP so the Source Control UI and future agents can drive VCS operations
// without invoking the git binary directly.
//
// Auth for push/pull deliberately uses the system credential store — SSH keys
// and token-based auth are a dedicated sub-project and are NOT handled here.
// The WorkspaceRouterMiddleware injects `Instance.directory` before these
// handlers run; every route reads it from there, not from the request.
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Git } from "../../git"
import { Instance } from "../../project/instance"
import { withTimeout } from "../../util/timeout"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "git-routes" })

const WRITE_TIMEOUT = 30_000 // network ops (push/pull) need headroom
const READ_TIMEOUT = 5_000

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CommitEntrySchema = z
  .object({
    hash: z.string(),
    shortHash: z.string(),
    author: z.string(),
    email: z.string(),
    timestamp: z.number().int(),
    subject: z.string(),
  })
  .meta({ ref: "GitCommitEntry" })

const BlameEntrySchema = z
  .object({
    hash: z.string(),
    line: z.number().int(),
    author: z.string(),
    timestamp: z.number().int(),
    content: z.string(),
  })
  .meta({ ref: "GitBlameEntry" })

const BranchEntrySchema = z
  .object({
    name: z.string(),
    current: z.boolean(),
    remote: z.boolean(),
  })
  .meta({ ref: "GitBranchEntry" })

const OpResultSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
  })
  .meta({ ref: "GitOpResult" })

const WorkingStatusEntrySchema = z
  .object({
    file: z.string(),
    code: z.string().meta({ description: "Two-character XY status code from git status --porcelain=v1" }),
    status: z.enum(["added", "deleted", "modified"]),
  })
  .meta({ ref: "GitWorkingStatusEntry" })

// ─── Routes ──────────────────────────────────────────────────────────────────

export function GitRoutes() {
  return new Hono()
    // ── Working-tree status ───────────────────────────────────────────────────
    .get(
      "/working-status",
      describeRoute({
        summary: "Get working tree status",
        description:
          "Return the working tree status as parsed `git status --porcelain=v1` entries. Each entry includes the XY code so the UI can distinguish staged vs unstaged changes: index (X) is not a space/? → staged; worktree (Y) is not a space/? → unstaged.",
        operationId: "git.workingStatus",
        responses: {
          200: {
            description: "Working tree status entries",
            content: { "application/json": { schema: resolver(WorkingStatusEntrySchema.array()) } },
          },
        },
      }),
      async (c) => {
        const result = await withTimeout(Git.workingStatus(Instance.directory), READ_TIMEOUT).catch((err) => {
          log.warn("git.workingStatus failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as Git.Item[]
        })
        return c.json(result)
      },
    )
    // ── Stage ────────────────────────────────────────────────────────────────
    .post(
      "/add",
      describeRoute({
        summary: "Stage files",
        description:
          "Run `git add` on the given files. Pass an empty `files` array to stage all modified/untracked files (`git add -A`).",
        operationId: "git.add",
        responses: {
          200: {
            description: "Whether staging succeeded",
            content: { "application/json": { schema: resolver(OpResultSchema) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          files: z.string().array().optional().meta({ description: "Relative paths to stage; empty = all" }),
        }),
      ),
      async (c) => {
        const { files } = c.req.valid("json")
        const ok = await withTimeout(Git.add(Instance.directory, files), WRITE_TIMEOUT).catch((err) => {
          log.warn("git.add failed", { error: err instanceof Error ? err.message : String(err) })
          return false
        })
        return c.json({ ok })
      },
    )
    // ── Unstage ──────────────────────────────────────────────────────────────
    .post(
      "/reset",
      describeRoute({
        summary: "Unstage files",
        description:
          "Run `git reset HEAD` on the given files. Pass an empty `files` array to unstage everything.",
        operationId: "git.reset",
        responses: {
          200: {
            description: "Whether unstaging succeeded",
            content: { "application/json": { schema: resolver(OpResultSchema) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          files: z.string().array().optional().meta({ description: "Relative paths to unstage; empty = all" }),
        }),
      ),
      async (c) => {
        const { files } = c.req.valid("json")
        const ok = await withTimeout(Git.reset(Instance.directory, files), WRITE_TIMEOUT).catch((err) => {
          log.warn("git.reset failed", { error: err instanceof Error ? err.message : String(err) })
          return false
        })
        return c.json({ ok })
      },
    )
    // ── Commit ───────────────────────────────────────────────────────────────
    .post(
      "/commit",
      describeRoute({
        summary: "Create a commit",
        description:
          "Run `git commit -m <message>`. Returns the short hash of the new commit on success. Returns a 400 if there is nothing to commit or git rejects the operation.",
        operationId: "git.commit",
        responses: {
          200: {
            description: "Short hash of the new commit",
            content: { "application/json": { schema: resolver(z.object({ hash: z.string() })) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          message: z.string().min(1).meta({ description: "Commit message" }),
        }),
      ),
      async (c) => {
        const { message } = c.req.valid("json")
        const result = await withTimeout(Git.commit(Instance.directory, message), WRITE_TIMEOUT).catch((err) => ({
          ok: false,
          hash: "",
          error: err instanceof Error ? err.message : "git commit failed",
        }))
        if (!result.ok) {
          log.warn("git.commit failed", { error: result.error })
          return c.json({ error: result.error ?? "git commit failed" }, 400)
        }
        return c.json({ hash: result.hash })
      },
    )
    // ── Push ─────────────────────────────────────────────────────────────────
    .post(
      "/push",
      describeRoute({
        summary: "Push to remote",
        description:
          "Run `git push <remote> [<branch>]`. Uses system credential helpers — SSH/token auth UI is a separate sub-project. The `ok` field is false and `error` is populated when git exits non-zero.",
        operationId: "git.push",
        responses: {
          200: {
            description: "Push result",
            content: { "application/json": { schema: resolver(OpResultSchema) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          remote: z.string().default("origin").meta({ description: "Remote name" }),
          branch: z.string().optional().meta({ description: "Branch to push (default: current)" }),
        }),
      ),
      async (c) => {
        const { remote, branch } = c.req.valid("json")
        const result = await withTimeout(Git.push(Instance.directory, remote, branch), WRITE_TIMEOUT).catch(
          (err) => ({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        return c.json(result)
      },
    )
    // ── Pull ─────────────────────────────────────────────────────────────────
    .post(
      "/pull",
      describeRoute({
        summary: "Pull from remote",
        description:
          "Run `git pull --rebase <remote> [<branch>]`. Rebases the local branch on top of the remote — keeps history linear. Returns `ok: false` and `error` on failure (e.g. conflicts).",
        operationId: "git.pull",
        responses: {
          200: {
            description: "Pull result",
            content: { "application/json": { schema: resolver(OpResultSchema) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          remote: z.string().default("origin").meta({ description: "Remote name" }),
          branch: z.string().optional().meta({ description: "Branch to pull (default: upstream tracking)" }),
        }),
      ),
      async (c) => {
        const { remote, branch } = c.req.valid("json")
        const result = await withTimeout(Git.pull(Instance.directory, remote, branch), WRITE_TIMEOUT).catch(
          (err) => ({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        return c.json(result)
      },
    )
    // ── Log ──────────────────────────────────────────────────────────────────
    .get(
      "/log",
      describeRoute({
        summary: "Get commit history",
        description: "Return the last N commits in newest-first order. Default limit: 50.",
        operationId: "git.log",
        responses: {
          200: {
            description: "Commit history",
            content: { "application/json": { schema: resolver(CommitEntrySchema.array()) } },
          },
        },
      }),
      validator(
        "query",
        z.object({
          limit: z
            .string()
            .optional()
            .transform((v) => (v ? Number.parseInt(v, 10) : 50))
            .meta({ description: "Maximum number of commits to return" }),
        }),
      ),
      async (c) => {
        const { limit } = c.req.valid("query")
        const result = await withTimeout(Git.log(Instance.directory, limit), READ_TIMEOUT).catch((err) => {
          log.warn("git.log failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as Git.CommitEntry[]
        })
        return c.json(result)
      },
    )
    // ── Blame ────────────────────────────────────────────────────────────────
    .get(
      "/blame",
      describeRoute({
        summary: "Get blame info for a file",
        description: "Return per-line blame information using `git blame --porcelain`.",
        operationId: "git.blame",
        responses: {
          200: {
            description: "Blame entries (one per line, 1-indexed)",
            content: { "application/json": { schema: resolver(BlameEntrySchema.array()) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          file: z.string().meta({ description: "Relative path to the file" }),
        }),
      ),
      async (c) => {
        const { file } = c.req.valid("query")
        const result = await withTimeout(Git.blame(Instance.directory, file), READ_TIMEOUT).catch((err) => {
          log.warn("git.blame failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as Git.BlameEntry[]
        })
        return c.json(result)
      },
    )
    // ── Branches ─────────────────────────────────────────────────────────────
    .get(
      "/branches",
      describeRoute({
        summary: "List branches",
        description: "Return all local and remote-tracking branches with current-branch marker.",
        operationId: "git.branches",
        responses: {
          200: {
            description: "Branch list",
            content: { "application/json": { schema: resolver(BranchEntrySchema.array()) } },
          },
        },
      }),
      async (c) => {
        const result = await withTimeout(Git.branches(Instance.directory), READ_TIMEOUT).catch((err) => {
          log.warn("git.branches failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as Git.BranchEntry[]
        })
        return c.json(result)
      },
    )
    // ── Create / switch branch ────────────────────────────────────────────────
    .post(
      "/branch",
      describeRoute({
        summary: "Create or switch branch",
        description:
          "Pass `create: true` to run `git checkout -b <name> [<from>]`. Pass `create: false` (default) to switch to an existing local branch via `git checkout <name>`.",
        operationId: "git.branch",
        responses: {
          200: {
            description: "Whether the operation succeeded",
            content: { "application/json": { schema: resolver(OpResultSchema) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string().min(1).meta({ description: "Branch name" }),
          create: z.boolean().default(false).meta({ description: "Create new branch if true, switch if false" }),
          from: z
            .string()
            .optional()
            .meta({ description: "Start point for new branch (only used when create: true)" }),
        }),
      ),
      async (c) => {
        const { name, create, from } = c.req.valid("json")
        let ok: boolean
        try {
          if (create) {
            ok = await withTimeout(Git.createBranch(Instance.directory, name, from), WRITE_TIMEOUT)
          } else {
            ok = await withTimeout(Git.switchBranch(Instance.directory, name), WRITE_TIMEOUT)
          }
        } catch (err) {
          ok = false
          log.warn("git.branch failed", { error: err instanceof Error ? err.message : String(err) })
        }
        return c.json({ ok })
      },
    )
}
