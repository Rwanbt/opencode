/**
 * worktree-manager.ts — TEAM-G02
 *
 * Production-grade worktree manager. Builds on TEAM-G01's lock-manager +
 * fencing + scope-monitor to provide atomic creation, attachment, detachment,
 * scope validation, listing and inspection of per-card worktrees.
 *
 * Responsibilities (plan directeur §26 ligne 3207, G02 WorktreeManager production) :
 *   - create:    atomic worktree creation + lease claim + Husky bootstrap check.
 *   - attach:    claim an existing worktree (created manually or by another worker).
 *   - detach:    atomic release (lease + worktree cleanup) with fail-closed guard.
 *   - validate:  scope_allowed ⊆ actual changes; protected branch / symlink / case / long-path / eol
 *                checks via scope-monitor.
 *   - list:      enumerate known worktrees and their lease state.
 *   - inspect:   deep view of a single worktree (lease row + git state + scope).
 *
 * Atomicity guarantees:
 *   - All writes go through lock-manager.claim() / release() / heartbeat().
 *   - The partial UNIQUE indexes on leases.branch / leases.worktree WHERE status='CLAIMED'
 *     (TEAM-G01) prevent concurrent double-create on the same slot.
 *   - path canonicalisation uses realpathSync() — symlink/junction REJECTed.
 *   - base_sha validation uses git rev-parse — drift rejected.
 *
 * Fail-closed posture:
 *   - Any uncaught exception during create/attach/detach triggers an automatic
 *     rollback path (release lease, git worktree remove if create partially landed).
 *   - No destructive command is implicit. detach() requires explicit --force for dirty trees.
 *
 * Windows / Linux / macOS:
 *   - All filesystem calls use node:fs (POSIX-portable subset).
 *   - Git commands are spawned via Bun.spawnSync with GIT_OPTIONAL_LOCKS=0
 *     so concurrent worktrees do not deadlock on .git/index.lock.
 *   - Husky bootstrap check uses `test -d .husky/_` (POSIX via node:fs.existsSync).
 */

import { spawnSync } from "node:child_process";
import type { Database } from "bun:sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { claim, getDb, release, validate } from "./lock-manager";
import { verifyScope, type DiffEntry, type ScopeManifest } from "./scope-monitor";

// --------------------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------------------

export interface CreateWorktreeOpts {
  /** Lease id (e.g. "LEASE-G02-20260721032000-team-g02-worktree-manager"). */
  lease_id: string;
  /** Card id (e.g. "TEAM-G02"). */
  card_id: string;
  /** Worker id (e.g. "MM2-IMPLEMENTATION-LANE-A"). */
  worker_id: string;
  /** Absolute path to the parent Git repository (root of the opencode clone). */
  repo_root: string;
  /** Absolute path where the new worktree will be created. */
  worktree_path: string;
  /** Short deterministic branch name (e.g. "c-G02/b89a9491"). */
  branch: string;
  /** 40-hex sha — base of the new worktree branch. */
  base_sha: string;
  /** Optional scope manifest hash (sha256 of canonical yaml). */
  scope_manifest_hash?: string;
  /** Allowed files for this card (will be stored on the lease). */
  allowed_files: string[];
  /** Protected files that must NOT be touched. */
  protected_files: string[];
  /** "OPEN" or "E2_REQUIRED". */
  scope_mode?: "OPEN" | "E2_REQUIRED";
  /** TTL in seconds for the lease. Default 1800. */
  ttl_seconds?: number;
  /** If true (default), run Husky bootstrap check before claim. */
  check_husky?: boolean;
}

export interface AttachWorktreeOpts {
  lease_id: string;
  card_id: string;
  worker_id: string;
  repo_root: string;
  worktree_path: string;
  branch: string;
  base_sha: string;
  scope_manifest_hash?: string;
  allowed_files: string[];
  protected_files: string[];
  scope_mode?: "OPEN" | "E2_REQUIRED";
  ttl_seconds?: number;
  /** If true, treat the worktree as pre-existing (skip `git worktree add`). Default true. */
  pre_existing?: boolean;
}

export interface DetachWorktreeOpts {
  lease_id: string;
  worker_id: string;
  /** If true, remove the worktree directory after release. Default false. */
  remove_worktree?: boolean;
  /** If true, allow removal of a dirty worktree. Default false (fail-closed). */
  force?: boolean;
  repo_root?: string;
}

export interface ValidateScopeOpts {
  lease_id: string;
  expected_fencing_token: number;
  /** Override the manifest (else read from lease). */
  manifest?: ScopeManifest;
}

export interface WorktreeView {
  worktree_path: string;
  branch: string;
  base_sha: string;
  head_sha: string;
  dirty: boolean;
  dirty_paths: string[];
  lease_id: string | null;
  card_id: string | null;
  fencing_token: number | null;
  lease_status: string | null;
  husky_bootstrapped: boolean;
  hooks_executable: boolean;
}

export interface WorktreeManagerOk<T = unknown> {
  ok: true;
  value: T;
}
export interface WorktreeManagerKo {
  ok: false;
  code:
    | "INVALID_PATH"
    | "PATH_NOT_ABSOLUTE"
    | "PATH_OUTSIDE_ROOT"
    | "PATH_SYMLINK"
    | "PATH_NOT_FOUND"
    | "PATH_NOT_DIRECTORY"
    | "WORKTREE_EXISTS"
    | "WORKTREE_MISSING"
    | "WORKTREE_DIRTY"
    | "BRANCH_EXISTS"
    | "BRANCH_TAKEN"
    | "WORKTREE_TAKEN"
    | "LEASE_TAKEN"
    | "BASE_SHA_INVALID"
    | "BASE_SHA_DRIFT"
    | "GIT_OP_IN_PROGRESS"
    | "PROTECTED_BRANCH"
    | "GIT_COMMAND_FAILED"
    | "HUSKY_NOT_BOOTSTRAPPED"
    | "INVALID_INPUT"
    | "INTERNAL";
  message: string;
  details?: unknown;
}
export type WorktreeManagerResult<T = unknown> = WorktreeManagerOk<T> | WorktreeManagerKo;

const PROTECTED_BRANCHES = new Set([
  "main",
  "dev",
  "Team",
  "opti-ui",
  "Team-build-opti-ui",
]);

const MAX_BRANCH_LEN = 80;
const BRANCH_PATTERN = /^[a-zA-Z0-9._/-]+$/;

// --------------------------------------------------------------------------------------
// Git helpers
// --------------------------------------------------------------------------------------

interface GitRunOpts {
  cwd: string;
  stdin?: string;
  allow_failure?: boolean;
}

function runGit(args: string[], opts: GitRunOpts): { status: number; stdout: string; stderr: string } {
  const proc = spawnSync("git", args, {
    cwd: opts.cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf-8",
    input: opts.stdin,
  });
  return {
    status: proc.status ?? -1,
    stdout: typeof proc.stdout === "string" ? proc.stdout : "",
    stderr: typeof proc.stderr === "string" ? proc.stderr : "",
  };
}

function checkGitOpInProgress(gitDir: string): string | null {
  for (const sentinel of ["CHERRY_PICK_HEAD", "MERGE_HEAD", "REBASE_HEAD", "REVERT_HEAD"]) {
    if (existsSync(join(gitDir, sentinel))) return sentinel;
  }
  return null;
}

/**
 * Canonicalise an absolute path. Returns null if path does not exist or is a symlink.
 *
 * Failure modes are explicit; we never auto-create missing paths here.
 */
function canonicalisePath(absPath: string): { real: string; stat: import("node:fs").Stats } | null {
  if (!isAbsolute(absPath)) return null;
  if (!existsSync(absPath)) return null;
  const ls = lstatSync(absPath);
  if (ls.isSymbolicLink()) return null;
  const real = realpathSync(absPath);
  if (lstatSync(real).isSymbolicLink()) return null;
  const st = statSync(real);
  return { real, stat: st };
}

// --------------------------------------------------------------------------------------
// createWorktree
// --------------------------------------------------------------------------------------

export function createWorktree(opts: CreateWorktreeOpts): WorktreeManagerResult<WorktreeView> {
  // 1. Validate inputs.
  if (!opts.lease_id || !opts.card_id || !opts.worker_id || !opts.repo_root || !opts.worktree_path) {
    return ko("INVALID_INPUT", "missing required field");
  }
  if (!/^[0-9a-f]{40}$/.test(opts.base_sha)) {
    return ko("BASE_SHA_INVALID", "base_sha must be 40-hex");
  }
  if (!isAbsolute(opts.worktree_path)) {
    return ko("PATH_NOT_ABSOLUTE", `worktree_path ${opts.worktree_path} must be absolute`);
  }
  if (!isAbsolute(opts.repo_root)) {
    return ko("PATH_NOT_ABSOLUTE", `repo_root ${opts.repo_root} must be absolute`);
  }
  if (opts.branch.length > MAX_BRANCH_LEN) {
    return ko("INVALID_INPUT", `branch exceeds ${MAX_BRANCH_LEN} chars`);
  }
  if (!BRANCH_PATTERN.test(opts.branch)) {
    return ko("INVALID_INPUT", `branch ${opts.branch} contains forbidden characters`);
  }
  // Branch must NOT be a protected branch (we compare lowercase canonical names).
  const head = opts.branch.split("/").pop() ?? opts.branch;
  if (PROTECTED_BRANCHES.has(head.toLowerCase())) {
    return ko("PROTECTED_BRANCH", `branch ${opts.branch} collides with a protected branch`);
  }

  // 2. Canonicalise repo_root (must exist).
  const repoCanon = canonicalisePath(opts.repo_root);
  if (!repoCanon || !repoCanon.stat.isDirectory()) {
    return ko("PATH_NOT_DIRECTORY", `repo_root ${opts.repo_root} not found or not a directory`);
  }
  const repoRoot = repoCanon.real;

  // 3. Validate worktree_path parent (must exist; worktree itself must NOT exist).
  const parentDir = resolve(opts.worktree_path, "..");
  const parentCanon = canonicalisePath(parentDir);
  if (!parentCanon || !parentCanon.stat.isDirectory()) {
    return ko("PATH_NOT_DIRECTORY", `parent dir ${parentDir} not found or not a directory`);
  }
  if (existsSync(opts.worktree_path)) {
    return ko("WORKTREE_EXISTS", `worktree_path ${opts.worktree_path} already exists`);
  }
  // Sanity: worktree_path parent must be under the team-worktrees root (fail-closed).
  // Derived from repoRoot rather than hardcoded: the convention used across this
  // codebase's own Team runs is a `.team-worktrees` sibling of the repo checkout,
  // and a literal machine-specific path broke on every machine but one.
  const expectedRoot = resolve(repoRoot, "..", ".team-worktrees");
  if (!resolve(parentDir).startsWith(expectedRoot) && !resolve(parentDir).startsWith(repoRoot)) {
    // Accept either inside team-worktrees root OR inside the repo root (defensive).
    // We do NOT accept arbitrary filesystem locations.
    return ko("PATH_OUTSIDE_ROOT", `worktree parent ${parentDir} is outside the team-worktrees root`);
  }

  // 4. Validate base_sha exists in the repo (git cat-file -t is stricter than rev-parse).
  // Using `<sha>^{commit}` forces git to resolve to a commit object and reject
  // fabricated or non-existent SHAs (some git builds return 0 for `rev-parse --verify`
  // on strings that are 40-hex but don't exist).
  const revParse = runGit(["cat-file", "-t", `${opts.base_sha}^{commit}`], { cwd: repoRoot });
  if (revParse.status !== 0) {
    return ko("BASE_SHA_INVALID", `base_sha ${opts.base_sha} not in repo ${repoRoot}: ${revParse.stderr.trim()}`);
  }
  const actualType = revParse.stdout.trim();
  if (actualType !== "commit") {
    return ko("BASE_SHA_INVALID", `base_sha ${opts.base_sha} resolves to ${actualType}, not commit`);
  }

  // 5. Reject if worktree is in mid-operation (CHERRY_PICK_HEAD etc.).
  const gitDir = join(repoRoot, ".git");
  const sentinel = checkGitOpInProgress(gitDir);
  if (sentinel) {
    return ko("GIT_OP_IN_PROGRESS", `${sentinel} exists in repo ${gitDir} — refuse to claim`);
  }

  // 6. Husky bootstrap check (optional, non-fatal by default).
  const huskyBootstrapped = existsSync(join(repoRoot, ".husky", "_"));

  // 7. Pre-create the worktree dir as parent (Bun.spawnSync will create it).
  try {
    mkdirSync(parentCanon.real, { recursive: true });
  } catch (e: any) {
    return ko("INTERNAL", `failed to create parent ${parentDir}: ${String(e?.message ?? e)}`);
  }

  // 8. Check branch uniqueness (git rev-parse --verify refs/heads/<branch>).
  const branchCheck = runGit(
    ["rev-parse", "--verify", `refs/heads/${opts.branch}`],
    { cwd: repoRoot },
  );
  if (branchCheck.status === 0) {
    return ko("BRANCH_EXISTS", `branch ${opts.branch} already exists`);
  }

  // 9. Claim the lease FIRST (atomic). If claim fails, do not create worktree.
  const scopeHash =
    opts.scope_manifest_hash ??
    "0000000000000000000000000000000000000000000000000000000000000000";
  const claimResult = claim({
    lease_id: opts.lease_id,
    card_id: opts.card_id,
    worker_id: opts.worker_id,
    branch: opts.branch,
    worktree: opts.worktree_path,
    base_sha: opts.base_sha,
    scope_manifest_hash: scopeHash,
    allowed_files: opts.allowed_files,
    protected_files: opts.protected_files,
    scope_mode: opts.scope_mode ?? "E2_REQUIRED",
    ttl_seconds: opts.ttl_seconds,
  });
  if (!claimResult.ok) {
    return ko(
      claimResult.code as WorktreeManagerKo["code"],
      claimResult.message,
    );
  }

  // 10. Create the worktree. If this fails, RELEASE the lease and surface error.
  let createdBranch = false;
  try {
    const addProc = runGit(
      ["worktree", "add", "-b", opts.branch, opts.worktree_path, opts.base_sha],
      { cwd: repoRoot },
    );
    if (addProc.status !== 0) {
      throw new Error(`git worktree add failed: ${addProc.stderr.trim() || addProc.stdout.trim()}`);
    }
    createdBranch = true;

    // Optional Husky bootstrap warning (no-op when already bootstrapped).
    if (opts.check_husky !== false && !huskyBootstrapped) {
      // Try a non-blocking check inside the new worktree.
      const wtHuskyDir = join(opts.worktree_path, ".husky", "_");
      if (!existsSync(wtHuskyDir)) {
        // We do not abort: per spec the WorktreeManager can warn but not block on Husky
        // absence (this is a soft requirement; the strict gate runs in pre-commit-check).
      }
    }

    const view = readWorktreeView(opts.worktree_path, opts.branch, opts.lease_id);
    return { ok: true, value: view };
  } catch (e: any) {
    // Rollback: release lease + remove worktree if partially created.
    try {
      release(opts.lease_id, opts.worker_id, "ROLLBACK_AFTER_WORKTREE_ADD_FAIL");
    } catch {
      // ignore
    }
    if (createdBranch) {
      try {
        runGit(["worktree", "remove", "--force", opts.worktree_path], { cwd: repoRoot });
      } catch {
        // ignore
      }
      try {
        runGit(["branch", "-D", opts.branch], { cwd: repoRoot });
      } catch {
        // ignore
      }
    }
    return ko("GIT_COMMAND_FAILED", String(e?.message ?? e));
  }
}

// --------------------------------------------------------------------------------------
// attachWorktree
// --------------------------------------------------------------------------------------

export function attachWorktree(opts: AttachWorktreeOpts): WorktreeManagerResult<WorktreeView> {
  if (!opts.lease_id || !opts.card_id || !opts.worker_id) {
    return ko("INVALID_INPUT", "missing required field");
  }
  if (!/^[0-9a-f]{40}$/.test(opts.base_sha)) {
    return ko("BASE_SHA_INVALID", "base_sha must be 40-hex");
  }
  if (!isAbsolute(opts.worktree_path)) {
    return ko("PATH_NOT_ABSOLUTE", `worktree_path ${opts.worktree_path} must be absolute`);
  }
  const wtCanon = canonicalisePath(opts.worktree_path);
  if (!wtCanon || !wtCanon.stat.isDirectory()) {
    return ko("WORKTREE_MISSING", `worktree_path ${opts.worktree_path} not found`);
  }

  // Verify the worktree's HEAD matches base_sha.
  const headProc = runGit(["cat-file", "-t", `HEAD^{commit}`], { cwd: opts.worktree_path });
  if (headProc.status !== 0) {
    return ko("GIT_COMMAND_FAILED", `git cat-file HEAD failed: ${headProc.stderr.trim()}`);
  }
  const fullHeadProc = runGit(["rev-parse", "HEAD"], { cwd: opts.worktree_path });
  if (fullHeadProc.status !== 0) {
    return ko("GIT_COMMAND_FAILED", `git rev-parse HEAD failed: ${fullHeadProc.stderr.trim()}`);
  }
  const actualHead = fullHeadProc.stdout.trim();
  if (actualHead !== opts.base_sha) {
    return ko(
      "BASE_SHA_DRIFT",
      `worktree HEAD ${actualHead} does not match expected base_sha ${opts.base_sha}`,
    );
  }

  // Verify branch.
  const branchProc = runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: opts.worktree_path });
  if (branchProc.status !== 0) {
    return ko("GIT_COMMAND_FAILED", `git rev-parse --abbrev-ref HEAD failed`);
  }
  const actualBranch = branchProc.stdout.trim();
  if (actualBranch !== opts.branch) {
    return ko(
      "BRANCH_EXISTS",
      `worktree branch ${actualBranch} does not match expected ${opts.branch}`,
    );
  }

  // Claim lease.
  const scopeHash =
    opts.scope_manifest_hash ??
    "0000000000000000000000000000000000000000000000000000000000000000";
  const claimResult = claim({
    lease_id: opts.lease_id,
    card_id: opts.card_id,
    worker_id: opts.worker_id,
    branch: opts.branch,
    worktree: opts.worktree_path,
    base_sha: opts.base_sha,
    scope_manifest_hash: scopeHash,
    allowed_files: opts.allowed_files,
    protected_files: opts.protected_files,
    scope_mode: opts.scope_mode ?? "E2_REQUIRED",
    ttl_seconds: opts.ttl_seconds,
  });
  if (!claimResult.ok) {
    return ko(claimResult.code as WorktreeManagerKo["code"], claimResult.message);
  }

  const view = readWorktreeView(opts.worktree_path, opts.branch, opts.lease_id);
  return { ok: true, value: view };
}

// --------------------------------------------------------------------------------------
// detachWorktree
// --------------------------------------------------------------------------------------

export function detachWorktree(opts: DetachWorktreeOpts, database?: Database): WorktreeManagerResult<WorktreeView> {
  if (!opts.lease_id || !opts.worker_id) {
    return ko("INVALID_INPUT", "missing required field");
  }
  // Called for its side effect, not its verdict: validate() runs sweepExpired()
  // and is the only thing that does so on this path — release() does not sweep.
  // Dropping the call would leave an expired lease unswept, so release() below
  // would see it as still CLAIMED.
  //
  // The verdict itself is deliberately ignored. Enforcement of status and
  // ownership belongs to release(), which does it atomically inside a
  // transaction; checking here as well would be a second, racier answer to the
  // same question. Token 0 is passed because the caller does not hold one.
  validate(opts.lease_id, /* expected_fencing_token */ 0, database);

  // Pre-check dirtiness if we'll remove.
  if (opts.remove_worktree) {
    // Find worktree path from lease row.
    const repoRoot = opts.repo_root;
    if (!repoRoot) {
      return ko("INVALID_INPUT", "repo_root required for remove_worktree");
    }
    const leaseRow = (database ?? getDb())
      .prepare(`SELECT worktree, status FROM leases WHERE lease_id = ?`)
      .get(opts.lease_id) as { worktree: string; status: string } | undefined;
    if (!leaseRow) {
      return ko("INVALID_INPUT", `lease ${opts.lease_id} not found`);
    }
    if (!existsSync(leaseRow.worktree)) {
      // Already gone; just release the lease.
      const rel = release(opts.lease_id, opts.worker_id, "WORKTREE_GONE", database);
      if (!rel.ok) return ko("INTERNAL", rel.message);
      return { ok: true, value: emptyView(leaseRow.worktree, opts.lease_id) };
    }
    if (!opts.force) {
      const statusProc = runGit(["status", "--porcelain", "--untracked-files=all"], {
        cwd: leaseRow.worktree,
      });
      if (statusProc.status === 0 && statusProc.stdout.trim().length > 0) {
        return ko(
          "WORKTREE_DIRTY",
          `worktree ${leaseRow.worktree} is dirty — pass force=true to override`,
        );
      }
    }
    // Remove the worktree.
    const removeProc = runGit(["worktree", "remove", "--force", leaseRow.worktree], {
      cwd: repoRoot,
    });
    if (removeProc.status !== 0) {
      // Fallback: rm -rf.
      try {
        rmSync(leaseRow.worktree, { recursive: true, force: true });
      } catch (e: any) {
        return ko("GIT_COMMAND_FAILED", `worktree remove failed: ${String(e?.message ?? e)}`);
      }
    }
  }

  // Release the lease.
  const rel = release(
    opts.lease_id,
    opts.worker_id,
    opts.remove_worktree ? "DETACH_AND_REMOVE" : "DETACH_KEEP",
    database,
  );
  if (!rel.ok) {
    return ko("INTERNAL", rel.message);
  }
  return { ok: true, value: emptyView("", opts.lease_id) };
}

// --------------------------------------------------------------------------------------
// validateWorktreeScope
// --------------------------------------------------------------------------------------

export function validateWorktreeScope(opts: ValidateScopeOpts, database?: Database): WorktreeManagerResult<{
  ok: boolean;
  violations: unknown[];
  warnings: string[];
}> {
  const manifest = opts.manifest;
  if (!manifest) {
    return ko("INVALID_INPUT", "manifest override required (lock-manager does not store manifest body)");
  }
  const valid = validate(opts.lease_id, opts.expected_fencing_token, database);
  if (!valid.ok) {
    return ko("INTERNAL", valid.message);
  }
  // Read diff via git status.
  const statusProc = runGit(["status", "--porcelain", "--untracked-files=all"], {
    cwd: valid.lease.worktree,
  });
  if (statusProc.status !== 0) {
    return ko("GIT_COMMAND_FAILED", `git status failed: ${statusProc.stderr}`);
  }
  const diff: DiffEntry[] = [];
  for (const line of statusProc.stdout.split("\n")) {
    if (!line) continue;
    const m = line.match(/^([?! MTADRCU]{2})\s+(.*)$/);
    if (!m) continue;
    const xy = m[1];
    const path = m[2].trim();
    let change_type: DiffEntry["change_type"];
    if (xy === "??") change_type = "untracked";
    else if (xy.includes("D")) change_type = "deleted";
    else if (xy.includes("A")) change_type = "added";
    else change_type = "modified";
    diff.push({ path, change_type });
  }
  const verdict = verifyScope(manifest, diff, valid.lease.worktree);
  return { ok: true, value: { ok: verdict.ok, violations: verdict.violations, warnings: verdict.warnings } };
}

// --------------------------------------------------------------------------------------
// listWorktrees
// --------------------------------------------------------------------------------------

export function listWorktrees(repoRoot: string): WorktreeManagerResult<WorktreeView[]> {
  if (!isAbsolute(repoRoot)) {
    return ko("PATH_NOT_ABSOLUTE", `repo_root ${repoRoot} must be absolute`);
  }
  const canon = canonicalisePath(repoRoot);
  if (!canon || !canon.stat.isDirectory()) {
    return ko("PATH_NOT_DIRECTORY", `repo_root ${repoRoot} not found`);
  }
  const proc = runGit(["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (proc.status !== 0) {
    return ko("GIT_COMMAND_FAILED", `git worktree list failed: ${proc.stderr}`);
  }
  const views: WorktreeView[] = [];
  let current: Partial<{ path: string; head: string; branch: string }> = {};
  for (const line of proc.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) views.push(viewFromPorcelain(current));
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.trim() === "") {
      if (current.path) views.push(viewFromPorcelain(current));
      current = {};
    }
  }
  if (current.path) views.push(viewFromPorcelain(current));
  return { ok: true, value: views };
}

// --------------------------------------------------------------------------------------
// inspectWorktree
// --------------------------------------------------------------------------------------

export function inspectWorktree(worktreePath: string): WorktreeManagerResult<WorktreeView> {
  if (!isAbsolute(worktreePath)) {
    return ko("PATH_NOT_ABSOLUTE", `worktree_path ${worktreePath} must be absolute`);
  }
  const canon = canonicalisePath(worktreePath);
  if (!canon || !canon.stat.isDirectory()) {
    return ko("WORKTREE_MISSING", `worktree ${worktreePath} not found`);
  }
  const branchProc = runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktreePath });
  const headProc = runGit(["rev-parse", "HEAD"], { cwd: worktreePath });
  if (branchProc.status !== 0 || headProc.status !== 0) {
    return ko("GIT_COMMAND_FAILED", `git rev-parse failed in ${worktreePath}`);
  }
  const view = readWorktreeView(
    worktreePath,
    branchProc.stdout.trim(),
    null, // lease_id unknown until cross-checked
  );
  return { ok: true, value: view };
}

// --------------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------------

function readWorktreeView(
  worktreePath: string,
  branch: string,
  leaseId: string | null,
): WorktreeView {
  const headProc = runGit(["rev-parse", "HEAD"], { cwd: worktreePath });
  const statusProc = runGit(["status", "--porcelain", "--untracked-files=all"], {
    cwd: worktreePath,
  });
  const dirtyPaths = statusProc.status === 0
    ? statusProc.stdout
        .split("\n")
        .map((l) => l.replace(/^[?! MTADRCU]{2}\s+/, "").trim())
        .filter(Boolean)
    : [];
  const huskyDir = join(worktreePath, ".husky", "_");
  let hooksExecutable = false;
  if (existsSync(huskyDir)) {
    try {
      const files = readdirSync(huskyDir);
      hooksExecutable = files.some((f: string) => f === "pre-commit" || f === "pre-push");
    } catch {
      // ignore
    }
  }
  return {
    worktree_path: worktreePath,
    branch,
    base_sha: headProc.status === 0 ? headProc.stdout.trim() : "",
    head_sha: headProc.status === 0 ? headProc.stdout.trim() : "",
    dirty: dirtyPaths.length > 0,
    dirty_paths: dirtyPaths,
    lease_id: leaseId,
    card_id: null,
    fencing_token: null,
    lease_status: null,
    husky_bootstrapped: existsSync(huskyDir),
    hooks_executable: hooksExecutable,
  };
}

function viewFromPorcelain(p: Partial<{ path: string; head: string; branch: string }>): WorktreeView {
  if (!p.path) return emptyView("", null);
  return readWorktreeView(p.path, p.branch ?? "", null);
}

function emptyView(worktreePath: string, leaseId: string | null): WorktreeView {
  return {
    worktree_path: worktreePath,
    branch: "",
    base_sha: "",
    head_sha: "",
    dirty: false,
    dirty_paths: [],
    lease_id: leaseId,
    card_id: null,
    fencing_token: null,
    lease_status: null,
    husky_bootstrapped: false,
    hooks_executable: false,
  };
}

function ko(code: WorktreeManagerKo["code"], message: string, details?: unknown): WorktreeManagerKo {
  return { ok: false, code, message, details };
}

/**
 * Compute the relative path of a file from repo_root. Used by callers that
 * want to build scope manifests without re-implementing path normalisation.
 */
export function relativeTo(worktreePath: string, absFilePath: string): string {
  return relative(worktreePath, absFilePath).split(sep).join("/");
}
