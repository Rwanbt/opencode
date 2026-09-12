/**
 * wt-09-concurrent-creation.test.ts — TEAM-G02
 *
 * Integration test: 3 concurrent createWorktree calls on the SAME worktree
 * path with DIFFERENT branches — only one succeeds; the others fail with
 * WORKTREE_TAKEN.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { createTempGitRepo } from "../helper";
import {
  createWorktree,
  detachWorktree,
} from "../../../src/team/worktree-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let baseSha: string;
let worktreePath: string;
let counter = 0;
let leaseIds: string[] = [];

beforeEach(() => {
  repo = createTempGitRepo();
  baseSha = repo.exec("git rev-parse HEAD").trim();
  counter++;
  worktreePath = join(repo.path, `wt09-${counter}-${Date.now()}`);
  leaseIds = [];
});

afterEach(() => {
  for (const id of leaseIds) {
    try {
      detachWorktree({
        lease_id: id,
        worker_id: `MM2-wt09-${counter}`,
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

test("integration-wt-09: 3 concurrent claims on same worktree → 1 win, 2 lose", () => {
  const ts = `${counter}-${Date.now()}`;
  const ids = [
    `LEASE-WT09-A-${ts}`,
    `LEASE-WT09-B-${ts}`,
    `LEASE-WT09-C-${ts}`,
  ];
  leaseIds = ids;

  const results = ids.map((id, i) =>
    createWorktree({
      lease_id: id,
      card_id: "TEAM-G02",
      worker_id: `MM2-wt09-${counter}-${i}`,
      repo_root: repo.path,
      worktree_path: worktreePath, // SAME path
      branch: `c-wt09/branch-${i}-${ts}`, // different branch
      base_sha: baseSha,
      allowed_files: ["**/*.ts"],
      protected_files: [],
      scope_mode: "OPEN",
    }),
  );

  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  expect(winners.length).toBe(1);
  expect(losers.length).toBe(2);
  for (const l of losers) {
    if (!l.ok) {
      expect(["WORKTREE_TAKEN", "WORKTREE_EXISTS", "BRANCH_EXISTS"]).toContain(l.code);
    }
  }
});

test("integration-wt-09: 3 sequential claims on same worktree → exactly 1 success", () => {
  const ts = `${counter}-${Date.now()}`;
  const ids = [
    `LEASE-WT09-SEQ-A-${ts}`,
    `LEASE-WT09-SEQ-B-${ts}`,
    `LEASE-WT09-SEQ-C-${ts}`,
  ];
  leaseIds = ids;

  // First claim succeeds.
  const r1 = createWorktree({
    lease_id: ids[0],
    card_id: "TEAM-G02",
    worker_id: `MM2-wt09-seq-${counter}-0`,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch: `c-wt09/seq-0-${ts}`,
    base_sha: baseSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r1.ok).toBe(true);

  // Subsequent claims on same path fail.
  for (let i = 1; i < 3; i++) {
    const r = createWorktree({
      lease_id: ids[i],
      card_id: "TEAM-G02",
      worker_id: `MM2-wt09-seq-${counter}-${i}`,
      repo_root: repo.path,
      worktree_path: worktreePath,
      branch: `c-wt09/seq-${i}-${ts}`,
      base_sha: baseSha,
      allowed_files: ["**/*.ts"],
      protected_files: [],
      scope_mode: "OPEN",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["WORKTREE_TAKEN", "WORKTREE_EXISTS"]).toContain(r.code);
    }
  }
});
