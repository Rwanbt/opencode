/**
 * wt-04-detach-clean.test.ts — TEAM-G02
 *
 * Integration test: detachWorktree releases the lease and removes the worktree
 * when the worktree is clean.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";
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
  workerId = `MM2-wt-04-${counter}-${Date.now()}`;
  leaseId = `LEASE-WT04-${counter}-${Date.now()}`;
  branch = `c-wt04/branch-${counter}-${Date.now()}`;
  worktreePath = join(repo.path, `wt04-${counter}-${Date.now()}`);
});

afterEach(() => {
  try {
    rmSync(worktreePath, { recursive: true, force: true });
  } catch {
    // ignore
  }
  repo.cleanup();
});

test("integration-wt-04: detach clean worktree + release lease + remove", () => {
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

  const detach = detachWorktree({
    lease_id: leaseId,
    worker_id: workerId,
    repo_root: repo.path,
    remove_worktree: true,
    force: false,
  });
  expect(detach.ok).toBe(true);

  // Lease should be RELEASED.
  const row = getDb()
    .prepare(`SELECT status FROM leases WHERE lease_id = ?`)
    .get(leaseId) as { status: string } | undefined;
  expect(row?.status).toBe("RELEASED");

  // Worktree should be gone.
  expect(existsSync(worktreePath)).toBe(false);
});
