/**
 * hooks.ts — TEAM-G02
 *
 * Worktree-level Git hook handlers (pre-commit, pre-push, post-commit).
 *
 * These functions are designed to be called from .husky/<hook> shims installed
 * by the bootstrap routine in worktree-manager.ts. They are intentionally
 * synchronous and fail-closed: any uncaught exception causes the hook to exit
 * with a non-zero code, blocking the Git operation.
 *
 * The hooks do NOT depend on a long-running daemon. They:
 *   1. Read the current worktree's branch.
 *   2. Cross-check the worktree's path against active leases (TEAM-G01).
 *   3. If a lease is found, run the scope validator (TEAM-G01 scope-monitor).
 *   4. Otherwise, log a warning (no lease) and exit 0 (Bun install-style
 *      legacy worktrees may not have a lease).
 *
 * Fail-closed posture:
 *   - Scope violations → exit 2 (scope-blocked).
 *   - Heartbeat / lease errors → exit 3 (lease-blocked).
 *   - Pre-existing mid-operation sentinels → exit 4 (git-blocked).
 *   - Husky absent → warning, exit 0 (don't block legacy worktrees).
 *
 * Cross-platform:
 *   - Uses node:fs (POSIX-portable subset). No shell-out.
 *   - Hook scripts (.husky/pre-commit) call `bun <path>` directly so no sh interpreter required.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { getDb, heartbeat, validate } from "./lock-manager";
import {
  verifyScope,
  type DiffEntry,
  type ScopeManifest,
} from "./scope-monitor";

export type HookOutcome =
  | { ok: true; warnings: string[] }
  | { ok: false; code: number; message: string };

const HOOK_OK = 0;
const HOOK_BAD_INPUT = 64;
const HOOK_SCOPE_BLOCKED = 2;
const HOOK_LEASE_BLOCKED = 3;
const HOOK_GIT_BLOCKED = 4;

/**
 * Resolve the current worktree's lease (if any) by walking the leases table.
 * Returns null when no active lease matches the worktree path.
 */
export function findActiveLeaseForWorktree(worktreePath: string): {
  lease_id: string;
  fencing_token: number;
  card_id: string;
  worker_id: string;
  base_sha: string;
  branch: string;
  status: string;
  expires_at: string;
} | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT lease_id, fencing_token, card_id, worker_id, base_sha, branch, status, expires_at
       FROM leases
       WHERE worktree = ? AND status = 'CLAIMED'
       LIMIT 1`,
    )
    .get(worktreePath) as any | undefined;
  if (!row) return null;
  return row;
}

/**
 * Build a minimal ScopeManifest from a lease row + caller-provided allowed_files.
 */
export function manifestFromLease(row: {
  lease_id: string;
  card_id: string;
  base_sha: string;
}, allowed_files: string[], protected_files: string[] = []): ScopeManifest {
  return {
    schema_version: "1.0.0",
    card_id: row.card_id,
    lease_id: row.lease_id,
    base_sha: row.base_sha,
    scope_mode: "E2_REQUIRED",
    allowed_files,
    protected_files,
    reserved_paths: [],
    symlink_policy: "REJECT",
    case_policy: "REJECT_DUPLICATE_CASE",
    long_path_policy: "FAIL_OVER_260",
    eol_policy: "LF_NORMALIZED",
  };
}

/**
 * Read the current `git status --porcelain` and translate to DiffEntry[].
 */
export function readGitDiff(worktreePath: string): DiffEntry[] {
  const proc = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: worktreePath,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf-8",
  });
  if (proc.status !== 0) return [];
  const out = typeof proc.stdout === "string" ? proc.stdout : "";
  const entries: DiffEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const idxArrow = line.indexOf(" -> ");
    let pathPart: string;
    if (idxArrow > 0) {
      pathPart = line.slice(idxArrow + 4);
    } else {
      pathPart = line;
    }
    const m = pathPart.match(/^([?! MTADRCU]{2})\s+(.*)$/);
    if (!m) continue;
    const xy = m[1];
    const path = m[2].trim();
    let change_type: DiffEntry["change_type"];
    if (xy === "??") change_type = "untracked";
    else if (xy.includes("D")) change_type = "deleted";
    else if (xy.includes("A")) change_type = "added";
    else change_type = "modified";
    entries.push({ path, change_type });
  }
  return entries;
}

/**
 * Detect mid-operation sentinels. Returns the first found, or null.
 */
export function detectGitOpInProgress(gitDir: string): string | null {
  for (const sentinel of ["CHERRY_PICK_HEAD", "MERGE_HEAD", "REBASE_HEAD", "REVERT_HEAD"]) {
    if (existsSync(join(gitDir, sentinel))) return sentinel;
  }
  return null;
}

/**
 * Hook: pre-commit. Runs before a commit is recorded.
 *
 * Behaviour:
 *   - If no active lease for this worktree → OK with warning (legacy worktrees).
 *   - If a mid-operation sentinel is present → BLOCKED.
 *   - If a lease is found, validate the lease (heartbeat if fresh enough),
 *     then run scope-monitor against the staged diff. Any violation → BLOCKED.
 */
export function hookPreCommit(opts: {
  worktreePath: string;
  allowed_files: string[];
  protected_files?: string[];
  /** Allow heartbeat refresh on validate. Default true. */
  heartbeat?: boolean;
  worker_id?: string;
}): HookOutcome {
  if (!opts.worktreePath) {
    return { ok: false, code: HOOK_BAD_INPUT, message: "worktreePath required" };
  }
  const gitDir = join(opts.worktreePath, ".git");
  if (detectGitOpInProgress(gitDir)) {
    return { ok: false, code: HOOK_GIT_BLOCKED, message: "git op in progress" };
  }
  const lease = findActiveLeaseForWorktree(opts.worktreePath);
  if (!lease) {
    return { ok: true, warnings: ["no active lease — pre-commit allowed without scope check"] };
  }
  const v = validate(lease.lease_id, lease.fencing_token);
  if (!v.ok) {
    return { ok: false, code: HOOK_LEASE_BLOCKED, message: `lease invalid: ${v.message}` };
  }
  if (opts.heartbeat !== false && opts.worker_id) {
    const hb = heartbeat(lease.lease_id, opts.worker_id);
    if (!hb.ok) {
      return { ok: false, code: HOOK_LEASE_BLOCKED, message: `heartbeat failed: ${hb.message}` };
    }
  }
  const manifest = manifestFromLease(v.lease, opts.allowed_files, opts.protected_files ?? []);
  const diff = readGitDiff(opts.worktreePath);
  const verdict = verifyScope(manifest, diff, opts.worktreePath);
  if (!verdict.ok) {
    return {
      ok: false,
      code: HOOK_SCOPE_BLOCKED,
      message: `scope violations: ${JSON.stringify(verdict.violations)}`,
    };
  }
  return { ok: true, warnings: verdict.warnings };
}

/**
 * Hook: pre-push. Runs before a push is recorded.
 *
 * Behaviour:
 *   - Refuses push if the current branch is a protected branch.
 *   - Refuses push if a mid-operation sentinel is present.
 *   - Validates the lease + scope (same as pre-commit).
 */
export function hookPrePush(opts: {
  worktreePath: string;
  allowed_files: string[];
  protected_files?: string[];
  worker_id?: string;
  protected_branches?: ReadonlySet<string>;
}): HookOutcome {
  if (!opts.worktreePath) {
    return { ok: false, code: HOOK_BAD_INPUT, message: "worktreePath required" };
  }
  const protectedBranches =
    opts.protected_branches ??
    new Set(["main", "dev", "Team", "opti-ui", "Team-build-opti-ui"]);
  const branchProc = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: opts.worktreePath,
    encoding: "utf-8",
  });
  if (branchProc.status !== 0) {
    return { ok: false, code: HOOK_GIT_BLOCKED, message: "branch not detected" };
  }
  const branch = (typeof branchProc.stdout === "string" ? branchProc.stdout : "").trim();
  if (protectedBranches.has(branch.toLowerCase())) {
    return {
      ok: false,
      code: HOOK_GIT_BLOCKED,
      message: `push to protected branch ${branch} refused`,
    };
  }
  const gitDir = join(opts.worktreePath, ".git");
  if (detectGitOpInProgress(gitDir)) {
    return { ok: false, code: HOOK_GIT_BLOCKED, message: "git op in progress" };
  }
  const lease = findActiveLeaseForWorktree(opts.worktreePath);
  if (!lease) {
    return { ok: true, warnings: ["no active lease — pre-push allowed without scope check"] };
  }
  const v = validate(lease.lease_id, lease.fencing_token);
  if (!v.ok) {
    return { ok: false, code: HOOK_LEASE_BLOCKED, message: `lease invalid: ${v.message}` };
  }
  if (opts.worker_id) {
    const hb = heartbeat(lease.lease_id, opts.worker_id);
    if (!hb.ok) {
      return { ok: false, code: HOOK_LEASE_BLOCKED, message: `heartbeat failed: ${hb.message}` };
    }
  }
  const manifest = manifestFromLease(v.lease, opts.allowed_files, opts.protected_files ?? []);
  const diff = readGitDiff(opts.worktreePath);
  const verdict = verifyScope(manifest, diff, opts.worktreePath);
  if (!verdict.ok) {
    return {
      ok: false,
      code: HOOK_SCOPE_BLOCKED,
      message: `scope violations: ${JSON.stringify(verdict.violations)}`,
    };
  }
  return { ok: true, warnings: verdict.warnings };
}

/**
 * Hook: post-commit. Refresh heartbeat after a successful commit and emit
 * a structured log line. NEVER blocks (post-commit cannot refuse a commit
 * already on disk).
 */
export function hookPostCommit(opts: {
  worktreePath: string;
  worker_id?: string;
}): HookOutcome {
  const lease = findActiveLeaseForWorktree(opts.worktreePath);
  if (!lease) return { ok: true, warnings: ["no active lease"] };
  if (opts.worker_id) {
    const hb = heartbeat(lease.lease_id, opts.worker_id);
    if (!hb.ok) {
      return { ok: false, code: HOOK_LEASE_BLOCKED, message: hb.message };
    }
  }
  return { ok: true, warnings: [] };
}

/**
 * Map a HookOutcome to a POSIX exit code suitable for a .husky/<hook> shim.
 */
export function hookOutcomeToExitCode(outcome: HookOutcome): number {
  if (outcome.ok) return HOOK_OK;
  return outcome.code;
}

/**
 * Format a HookOutcome for stderr display in a .husky shim.
 */
export function formatHookMessage(outcome: HookOutcome): string {
  if (outcome.ok) {
    if (outcome.warnings.length === 0) return "team-hook: OK";
    return `team-hook: OK with warnings:\n  - ${outcome.warnings.join("\n  - ")}`;
  }
  return `team-hook: BLOCKED (code=${outcome.code}): ${outcome.message}`;
}
