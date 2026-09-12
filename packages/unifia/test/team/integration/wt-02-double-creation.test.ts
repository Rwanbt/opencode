/**
 * wt-02-double-creation.test.ts — TEAM-G02
 *
 * Integration test: a second createWorktree on the same path/branch is REJECTED
 * by the lock-manager's UNIQUE partial indexes.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createTempGitRepo } from "../helper";
import {
  createWorktree,
  detachWorktree,
} from "../../../src/team/worktree-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let baseSha: string;
let worktreePath: string;
let leaseId1: string;
let leaseId2: string;
let workerId: string;
let branch1: string;
let branch2: string;
let counter = 0;

beforeEach(() => {
  repo = createTempGitRepo();
  baseSha = repo.exec("git rev-parse HEAD").trim();
  counter++;
  workerId = `MM2-wt-02-${counter}-${Date.now()}`;
  leaseId1 = `LEASE-WT02-A-${counter}-${Date.now()}`;
  leaseId2 = `LEASE-WT02-B-${counter}-${Date.now()}`;
  branch1 = `c-wt02/branch-A-${counter}-${Date.now()}`;
  branch2 = `c-wt02/branch-B-${counter}-${Date.now()}`;
  worktreePath = join(repo.path, `wt02-${counter}-${Date.now()}`);
});

afterEach(() => {
  for (const id of [leaseId1, leaseId2]) {
    try {
      detachWorktree({
        lease_id: id,
        worker_id: workerId,
        repo_root: repo.path,
        remove_worktree: true,
        force: true,
      });
    } catch {
      // ignore
    }
  }
  try {
    rmSync(worktreePath, { recursive: true, force: true });
  } catch {
    // ignore
  }
  repo.cleanup();
});

test("integration-wt-02: second claim on same worktree path is rejected", () => {
  // First claim succeeds.
  const r1 = createWorktree({
    lease_id: leaseId1,
    card_id: "TEAM-G02",
    worker_id: workerId,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch: branch1,
    base_sha: baseSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r1.ok).toBe(true);

  // Second claim with different branch but same worktree is rejected.
  const r2 = createWorktree({
    lease_id: leaseId2,
    card_id: "TEAM-G02",
    worker_id: workerId,
    repo_root: repo.path,
    worktree_path: worktreePath, // SAME path
    branch: branch2, // DIFFERENT branch
    base_sha: baseSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r2.ok).toBe(false);
  if (!r2.ok) {
    expect(["WORKTREE_TAKEN", "WORKTREE_EXISTS"]).toContain(r2.code);
  }
});

test("integration-wt-02: second claim with same branch is rejected", () => {
  const r1 = createWorktree({
    lease_id: leaseId1,
    card_id: "TEAM-G02",
    worker_id: workerId,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch: branch1,
    base_sha: baseSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r1.ok).toBe(true);

  // Different worktree path, same branch.
  const altPath = join(repo.path, `wt02-alt-${counter}-${Date.now()}`);
  const r2 = createWorktree({
    lease_id: leaseId2,
    card_id: "TEAM-G02",
    worker_id: workerId,
    repo_root: repo.path,
    worktree_path: altPath,
    branch: branch1, // SAME branch
    base_sha: baseSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r2.ok).toBe(false);
  if (!r2.ok) {
    expect(["BRANCH_TAKEN", "BRANCH_EXISTS"]).toContain(r2.code);
  }
  try {
    rmSync(altPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
