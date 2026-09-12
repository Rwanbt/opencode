/**
 * wt-03-attach-existing.test.ts — TEAM-G02
 *
 * Integration test: attachWorktree claims a lease on a worktree that was
 * created externally (e.g. manually by a developer) and whose HEAD matches
 * the expected base_sha.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { createTempGitRepo } from "../helper";
import {
  attachWorktree,
  detachWorktree,
} from "../../../src/team/worktree-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let baseSha: string;
let worktreePath: string;
let branch: string;
let leaseId: string;
let workerId: string;
let counter = 0;

beforeEach(() => {
  repo = createTempGitRepo();
  baseSha = repo.exec("git rev-parse HEAD").trim();
  counter++;
  workerId = `MM2-wt-03-${counter}-${Date.now()}`;
  leaseId = `LEASE-WT03-${counter}-${Date.now()}`;
  branch = `c-wt03/branch-${counter}-${Date.now()}`;
  worktreePath = join(repo.path, `wt03-${counter}-${Date.now()}`);
  // Manually create the worktree (no lease).
  execSync(`git worktree add -b ${branch} "${worktreePath}" ${baseSha}`, {
    cwd: repo.path,
    stdio: "ignore",
  });
});

afterEach(() => {
  try {
    detachWorktree({
      lease_id: leaseId,
      worker_id: workerId,
      repo_root: repo.path,
      remove_worktree: true,
      force: true,
    });
  } catch {
    // ignore
  }
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: repo.path,
      stdio: "ignore",
    });
  } catch {
    // ignore
  }
  try {
    rmSync(worktreePath, { recursive: true, force: true });
  } catch {
    // ignore
  }
  repo.cleanup();
});

test("integration-wt-03: attach existing worktree + claim lease", () => {
  const r = attachWorktree({
    lease_id: leaseId,
    card_id: "TEAM-G02",
    worker_id: workerId,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch,
    base_sha: baseSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.lease_id).toBe(leaseId);
    expect(r.value.branch).toBe(branch);
    expect(r.value.head_sha).toBe(baseSha);
  }
});

test("integration-wt-03: attach rejects when HEAD does not match base_sha", () => {
  const wrongSha = "f".repeat(40);
  const r = attachWorktree({
    lease_id: leaseId,
    card_id: "TEAM-G02",
    worker_id: workerId,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch,
    base_sha: wrongSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(["BASE_SHA_DRIFT", "BASE_SHA_INVALID"]).toContain(r.code);
  }
});
