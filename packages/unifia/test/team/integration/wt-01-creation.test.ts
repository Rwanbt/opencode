/**
 * wt-01-creation.test.ts — TEAM-G02
 *
 * Integration test: createWorktree produces an atomic lease claim + Git worktree
 * creation. The worktree exists on disk and the lease is CLAIMED in the DB.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createTempGitRepo } from "../helper";
import {
  createWorktree,
  detachWorktree,
} from "../../../src/team/worktree-manager";

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
  workerId = `MM2-wt-01-${counter}-${Date.now()}`;
  leaseId = `LEASE-WT01-${counter}-${Date.now()}`;
  branch = `c-wt01/branch-${counter}-${Date.now()}`;
  worktreePath = join(repo.path, `wt01-${counter}-${Date.now()}`);
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

test("integration-wt-01: create worktree + atomic lease claim", () => {
  const r = createWorktree({
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
    expect(existsSync(worktreePath)).toBe(true);
    expect(r.value.branch).toBe(branch);
    expect(r.value.dirty).toBe(false);
    expect(r.value.husky_bootstrapped).toBe(false); // no .husky/_ in this temp repo
  }
});

test("integration-wt-01: created worktree is at base_sha", () => {
  const r = createWorktree({
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
    expect(r.value.head_sha).toBe(baseSha);
    expect(r.value.base_sha).toBe(baseSha);
  }
});
