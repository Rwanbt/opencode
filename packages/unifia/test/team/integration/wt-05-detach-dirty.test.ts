/**
 * wt-05-detach-dirty.test.ts — TEAM-G02
 *
 * Integration test: detachWorktree refuses to remove a dirty worktree
 * unless force=true is passed.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTempGitRepo } from "../helper";
import {
  createWorktree,
  detachWorktree,
} from "../../../src/team/worktree-manager";
import { getDb } from "../../../src/team/lock-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let baseSha: string;
let worktreePath: string;
let leaseId: string;
let workerId: string;
let branch: string;
let counter = 0;

beforeEach(() => {
  repo = createTempGitRepo();
  baseSha = repo.exec("git rev-parse HEAD").trim();
  counter++;
  workerId = `MM2-wt-05-${counter}-${Date.now()}`;
  leaseId = `LEASE-WT05-${counter}-${Date.now()}`;
  branch = `c-wt05/branch-${counter}-${Date.now()}`;
  worktreePath = join(repo.path, `wt05-${counter}-${Date.now()}`);
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
    rmSync(worktreePath, { recursive: true, force: true });
  } catch {
    // ignore
  }
  repo.cleanup();
});

test("integration-wt-05: detach refuses dirty worktree without force", () => {
  const create = createWorktree({
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
  expect(create.ok).toBe(true);

  // Make the worktree dirty.
  writeFileSync(join(worktreePath, "dirty-file.ts"), "console.log('dirty');\n");

  const detach = detachWorktree({
    lease_id: leaseId,
    worker_id: workerId,
    repo_root: repo.path,
    remove_worktree: true,
    force: false,
  });
  expect(detach.ok).toBe(false);
  if (!detach.ok) {
    expect(detach.code).toBe("WORKTREE_DIRTY");
  }

  // Worktree should still exist.
  expect(existsSync(worktreePath)).toBe(true);

  // Lease should still be CLAIMED (no release happened).
  const row = getDb()
    .prepare(`SELECT status FROM leases WHERE lease_id = ?`)
    .get(leaseId) as { status: string } | undefined;
  expect(row?.status).toBe("CLAIMED");
});

test("integration-wt-05: detach with force=true removes dirty worktree", () => {
  const create = createWorktree({
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
  expect(create.ok).toBe(true);

  writeFileSync(join(worktreePath, "dirty-file.ts"), "console.log('dirty');\n");

  const detach = detachWorktree({
    lease_id: leaseId,
    worker_id: workerId,
    repo_root: repo.path,
    remove_worktree: true,
    force: true,
  });
  expect(detach.ok).toBe(true);

  expect(existsSync(worktreePath)).toBe(false);
});
