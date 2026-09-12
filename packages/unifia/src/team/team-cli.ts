/**
 * team-cli.ts — TEAM-G01
 *
 * Single entry point for the team CLI subcommands.
 * Lives in the repo at packages/unifia/src/team/team-cli.ts.
 *
 * Subcommands (defined in package.json scripts):
 *   team claim          — acquire a new lease (interactive or with --lease-id, ...)
 *   team heartbeat      — refresh an existing lease
 *   team validate       — check a lease is still ACTIVE and tokens match
 *   team release        — free a lease (worker must own it)
 *   team inspect        — list all leases (debug)
 *   team recover        — sweep stale leases + correct watermark
 *   team precommit-check — verify current diff is inside allowed_files
 *   team preintegrate-check — full verify + patch-id stability check
 *
 * The CLI exposes the same primitives as the lock-manager API, but with JSON
 * output and exit codes suitable for shell hook usage.
 */

import { claim, heartbeat, release, validate, inspect, recover, forceRelease, type LeaseSpec } from "./lock-manager";
import { verifyScope, type ScopeManifest, type DiffEntry } from "./scope-monitor";
import {
  createWorktree,
  attachWorktree,
  detachWorktree,
  validateWorktreeScope,
  listWorktrees,
  inspectWorktree,
  type CreateWorktreeOpts,
  type AttachWorktreeOpts,
  type DetachWorktreeOpts,
  type ValidateScopeOpts,
} from "./worktree-manager";

function exitOk(result: unknown): never {
  console.log(JSON.stringify({ ok: true, result }, null, 2));
  process.exit(0);
}
function exitErr(code: number, msg: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ ok: false, code, error: msg, ...extra }, null, 2));
  process.exit(code);
}

async function loadManifestFromLease(lease_id: string): Promise<ScopeManifest> {
  const { getDb } = await import("./lock-manager");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT scope_manifest_hash, allowed_files_json, protected_files_json, scope_mode, lease_id, card_id, base_sha FROM leases WHERE lease_id = ?`,
    )
    .get(lease_id) as any;
  if (!row) exitErr(64, `lease ${lease_id} not found`);
  return {
    schema_version: "1.0.0",
    card_id: row.card_id,
    lease_id: row.lease_id,
    base_sha: row.base_sha,
    scope_mode: row.scope_mode as "OPEN" | "E2_REQUIRED",
    allowed_files: JSON.parse(row.allowed_files_json),
    protected_files: JSON.parse(row.protected_files_json),
    reserved_paths: [],
    symlink_policy: "REJECT",
    case_policy: "REJECT_DUPLICATE_CASE",
    long_path_policy: "FAIL_OVER_260",
    eol_policy: "LF_NORMALIZED",
  };
}

function readDiff(gitRoot: string): DiffEntry[] {
  // Read `git status --porcelain` and parse.
  const proc = Bun.spawnSync(
    ["git", "status", "--porcelain", "--untracked-files=all", "--ignore-submodules"],
    {
      cwd: gitRoot,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    },
  );
  if (proc.exitCode !== 0) {
    return [];
  }
  const out = proc.stdout.toString();
  const entries: DiffEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    // Porcelain format: XY <path>
    // For rename/copy, original path is before arrow.
    const idxArrow = line.indexOf(" -> ");
    let first: string, second: string | null = null;
    if (idxArrow > 0) {
      first = line.slice(0, idxArrow);
      second = line.slice(idxArrow + 4);
    } else {
      first = line;
    }
    const match = first.match(/^([?! MTADRCU]{2})\s+(.*)$/);
    if (!match) continue;
    const xy = match[1];
    const path = second ?? match[2];
    let change_type: DiffEntry["change_type"];
    if (xy === "??") change_type = "untracked";
    else if (xy.includes("D")) change_type = "deleted";
    else if (xy.includes("A")) change_type = "added";
    else change_type = "modified";
    entries.push({ path: path.trim(), change_type });
  }
  return entries;
}

async function cmdClaim(args: string[]): Promise<never> {
  // Parse minimal flag set.
  const spec: Partial<LeaseSpec> = {};
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--lease-id") { spec.lease_id = args[++i]; i++; continue; }
    if (a === "--card") { spec.card_id = args[++i]; i++; continue; }
    if (a === "--worker") { spec.worker_id = args[++i]; i++; continue; }
    if (a === "--branch") { spec.branch = args[++i]; i++; continue; }
    if (a === "--worktree") { spec.worktree = args[++i]; i++; continue; }
    if (a === "--base") { spec.base_sha = args[++i]; i++; continue; }
    if (a === "--manifest-hash") { spec.scope_manifest_hash = args[++i]; i++; continue; }
    if (a === "--scope-mode") { spec.scope_mode = args[++i] as any; i++; continue; }
    if (a === "--ttl") { spec.ttl_seconds = Number(args[++i]); i++; continue; }
    if (a === "--allowed-files") {
      spec.allowed_files = args[++i].split(",");
      i++;
      continue;
    }
    if (a === "--protected-files") {
      spec.protected_files = args[++i].split(",");
      i++;
      continue;
    }
    if (a === "--manifest-yaml") {
      const yamlPath = args[++i];
      const yamlText = await Bun.file(yamlPath).text();
      // Tiny YAML: read scope_manifest via plain JSON for now (we accept JSON-shaped YAML).
      const data = JSON.parse(yamlText);
      Object.assign(spec, data);
      i++;
      continue;
    }
    i++;
  }
  if (!spec.lease_id || !spec.card_id || !spec.worker_id || !spec.branch || !spec.worktree || !spec.base_sha) {
    exitErr(64, "missing required flags");
  }
  const result = claim(spec as LeaseSpec);
  if (!result.ok) exitErr(1, result.message, { code: result.code });
  exitOk(result);
}

async function cmdHeartbeat(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let worker_id: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--worker") worker_id = args[++i];
  }
  if (!lease_id || !worker_id) exitErr(64, "missing --lease-id or --worker");
  const r = heartbeat(lease_id, worker_id);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r);
}

async function cmdValidate(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let token: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--fencing-token") token = Number(args[++i]);
  }
  if (!lease_id || token === undefined) exitErr(64, "missing --lease-id or --fencing-token");
  const r = validate(lease_id, token);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r.lease);
}

async function cmdRelease(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let worker_id: string | undefined;
  let reason = "VOLUNTARY";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--worker") worker_id = args[++i];
    if (args[i] === "--reason") reason = args[++i];
  }
  if (!lease_id || !worker_id) exitErr(64, "missing --lease-id or --worker");
  const r = release(lease_id, worker_id, reason);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r);
}

async function cmdInspect(): Promise<never> {
  exitOk(inspect());
}

async function cmdRecover(args: string[]): Promise<never> {
  let force_lease: string | undefined;
  let reason = "MANUAL_RECOVERY";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force-lease") force_lease = args[++i];
    if (args[i] === "--reason") reason = args[++i];
  }
  if (force_lease) {
    const r = forceRelease(force_lease, reason, "team-cli");
    if (!r.ok) exitErr(1, r.message, { code: r.code });
    exitOk(r);
  } else {
    const r = recover();
    exitOk(r);
  }
}

async function cmdPrecommitCheck(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let git_root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--git-root") git_root = args[++i];
  }
  if (!lease_id) exitErr(64, "missing --lease-id");
  const manifest = await loadManifestFromLease(lease_id);
  const diff = readDiff(git_root);
  const verdict = verifyScope(manifest, diff, git_root);
  if (!verdict.ok) exitErr(2, "scope violations", { violations: verdict.violations });
  exitOk({ ok: true, n: diff.length });
}

async function cmdPreintegrateCheck(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let git_root = process.cwd();
  let base = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--git-root") git_root = args[++i];
    if (args[i] === "--base") base = args[++i];
  }
  if (!lease_id || !base) exitErr(64, "missing --lease-id or --base");
  // Step 1: scope check (same as precommit-check).
  const manifest = await loadManifestFromLease(lease_id);
  const diff = readDiff(git_root);
  const verdict = verifyScope(manifest, diff, git_root);
  if (!verdict.ok) exitErr(2, "scope violations", { violations: verdict.violations });

// Step 2: patch-id stability check.
  const proc = Bun.spawnSync(
    ["git", "format-patch", "--stdout", `${base}..HEAD`],
    {
      cwd: git_root,
    },
  );
  if (proc.exitCode !== 0) exitErr(3, `git format-patch failed: ${proc.stderr.toString()}`);
  const procId = Bun.spawnSync(
    ["git", "patch-id", "--stable"],
    {
      cwd: git_root,
      stdin: new TextEncoder().encode(proc.stdout.toString()),
    },
  );
  if (procId.exitCode !== 0 || !procId.stdout) exitErr(3, `git patch-id failed: ${procId.stderr.toString()}`);
  exitOk({ ok: true, n: diff.length, patch_id: procId.stdout.toString().trim() });
}

export async function main(argv: string[]): Promise<never> {
  const [, , sub, ...rest] = argv;
  switch (sub) {
    case "claim":
      return cmdClaim(rest);
    case "heartbeat":
      return cmdHeartbeat(rest);
    case "validate":
      return cmdValidate(rest);
    case "release":
      return cmdRelease(rest);
    case "inspect":
      return cmdInspect();
    case "recover":
      return cmdRecover(rest);
    case "precommit-check":
      return cmdPrecommitCheck(rest);
    case "preintegrate-check":
      return cmdPreintegrateCheck(rest);
    case "wt-create":
      return cmdWtCreate(rest);
    case "wt-attach":
      return cmdWtAttach(rest);
    case "wt-detach":
      return cmdWtDetach(rest);
    case "wt-validate":
      return cmdWtValidate(rest);
    case "wt-list":
      return cmdWtList(rest);
    case "wt-inspect":
      return cmdWtInspect(rest);
    default:
      exitErr(64, `unknown subcommand: ${sub}`);
  }
}

// --------------------------------------------------------------------------------------
// TEAM-G02 subcommands: worktree-manager CLI surface
// --------------------------------------------------------------------------------------

async function cmdWtCreate(args: string[]): Promise<never> {
  const opts: Partial<CreateWorktreeOpts> & { allowed_files: string[]; protected_files: string[] } = {
    allowed_files: [],
    protected_files: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "--lease-id": opts.lease_id = next(); break;
      case "--card": opts.card_id = next(); break;
      case "--worker": opts.worker_id = next(); break;
      case "--repo-root": opts.repo_root = next(); break;
      case "--worktree-path": opts.worktree_path = next(); break;
      case "--branch": opts.branch = next(); break;
      case "--base": opts.base_sha = next(); break;
      case "--scope-manifest-hash": opts.scope_manifest_hash = next(); break;
      case "--scope-mode":
        opts.scope_mode = next() as "OPEN" | "E2_REQUIRED";
        break;
      case "--ttl": opts.ttl_seconds = Number(next()); break;
      case "--allowed-files": opts.allowed_files = next().split(","); break;
      case "--protected-files": opts.protected_files = next().split(","); break;
      case "--no-husky-check": opts.check_husky = false; break;
      default: break;
    }
  }
  const required = ["lease_id", "card_id", "worker_id", "repo_root", "worktree_path", "branch", "base_sha"] as const;
  for (const k of required) {
    if (!(opts as any)[k]) exitErr(64, `missing --${k.replace(/_/g, "-")}`);
  }
  const r = createWorktree(opts as CreateWorktreeOpts);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r.value);
}

async function cmdWtAttach(args: string[]): Promise<never> {
  const opts: Partial<AttachWorktreeOpts> & { allowed_files: string[]; protected_files: string[] } = {
    allowed_files: [],
    protected_files: [],
    pre_existing: true,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "--lease-id": opts.lease_id = next(); break;
      case "--card": opts.card_id = next(); break;
      case "--worker": opts.worker_id = next(); break;
      case "--repo-root": opts.repo_root = next(); break;
      case "--worktree-path": opts.worktree_path = next(); break;
      case "--branch": opts.branch = next(); break;
      case "--base": opts.base_sha = next(); break;
      case "--allowed-files": opts.allowed_files = next().split(","); break;
      case "--protected-files": opts.protected_files = next().split(","); break;
      case "--ttl": opts.ttl_seconds = Number(next()); break;
      default: break;
    }
  }
  const required = ["lease_id", "card_id", "worker_id", "repo_root", "worktree_path", "branch", "base_sha"] as const;
  for (const k of required) {
    if (!(opts as any)[k]) exitErr(64, `missing --${k.replace(/_/g, "-")}`);
  }
  const r = attachWorktree(opts as AttachWorktreeOpts);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r.value);
}

async function cmdWtDetach(args: string[]): Promise<never> {
  const opts: Partial<DetachWorktreeOpts> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "--lease-id": opts.lease_id = next(); break;
      case "--worker": opts.worker_id = next(); break;
      case "--repo-root": opts.repo_root = next(); break;
      case "--remove": opts.remove_worktree = true; break;
      case "--force": opts.force = true; break;
      default: break;
    }
  }
  if (!opts.lease_id || !opts.worker_id) exitErr(64, "missing --lease-id or --worker");
  const r = detachWorktree(opts as DetachWorktreeOpts);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r.value);
}

async function cmdWtValidate(args: string[]): Promise<never> {
  const opts: Partial<ValidateScopeOpts> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "--lease-id": opts.lease_id = next(); break;
      case "--fencing-token": opts.expected_fencing_token = Number(next()); break;
      default: break;
    }
  }
  if (!opts.lease_id || opts.expected_fencing_token === undefined) {
    exitErr(64, "missing --lease-id or --fencing-token");
  }
  const r = validateWorktreeScope(opts as ValidateScopeOpts);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  if (!r.value.ok) exitErr(2, "scope violations", { violations: r.value.violations });
  exitOk(r.value);
}

async function cmdWtList(args: string[]): Promise<never> {
  const repo_root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const r = listWorktrees(repo_root);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk({ count: r.value.length, worktrees: r.value });
}

async function cmdWtInspect(args: string[]): Promise<never> {
  const worktree_path = args.find((a) => !a.startsWith("--"));
  if (!worktree_path) exitErr(64, "missing worktree path");
  const r = inspectWorktree(worktree_path);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r.value);
}
if (import.meta.main) await main(process.argv);
