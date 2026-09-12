/**
 * wt-10-base-sha-mismatch.test.ts — TEAM-G02
 *
 * Integration test: createWorktree rejects when base_sha is not a valid commit
 * in the repo (drift, typo, fabricated value).
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
let worktreePath: string;
let counter = 0;
let leaseIds: string[] = [];

beforeEach(() => {
  repo = createTempGitRepo();
  counter++;
  worktreePath = join(repo.path, `wt10-${counter}-${Date.now()}`);
  leaseIds = [];
});

afterEach(() => {
  for (const id of leaseIds) {
    try {
      detachWorktree({
        lease_id: id,
        worker_id: `MM2-wt10-${counter}`,
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

test("integration-wt-10: rejects fabricated base_sha (random hex)", () => {
  const fakeSha = "abcdef1234567890abcdef1234567890abcdef12";
  const id = `LEASE-WT10-fake-${counter}-${Date.now()}`;
  leaseIds = [id];
  const r = createWorktree({
    lease_id: id,
    card_id: "TEAM-G02",
    worker_id: `MM2-wt10-${counter}`,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch: `c-wt10/fake-${counter}-${Date.now()}`,
    base_sha: fakeSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("BASE_SHA_INVALID");
});

test("integration-wt-10: rejects base_sha not 40-hex", () => {
  const id = `LEASE-WT10-bad-${counter}-${Date.now()}`;
  leaseIds = [id];
  const r = createWorktree({
    lease_id: id,
    card_id: "TEAM-G02",
    worker_id: `MM2-wt10-${counter}`,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch: `c-wt10/bad-${counter}-${Date.now()}`,
    base_sha: "NOT_HEX",
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("BASE_SHA_INVALID");
});

test("integration-wt-10: rejects valid hex but unknown commit", () => {
  const unknownSha = "0".repeat(40);
  const id = `LEASE-WT10-unk-${counter}-${Date.now()}`;
  leaseIds = [id];
  const r = createWorktree({
    lease_id: id,
    card_id: "TEAM-G02",
    worker_id: `MM2-wt10-${counter}`,
    repo_root: repo.path,
    worktree_path: worktreePath,
    branch: `c-wt10/unk-${counter}-${Date.now()}`,
    base_sha: unknownSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("BASE_SHA_INVALID");
});
