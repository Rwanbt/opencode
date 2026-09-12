/**
 * wt-08-fail-closed-path.test.ts — TEAM-G02
 *
 * Integration test: WorktreeManager refuses symlink worktree paths and paths
 * that escape the canonical root.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  attachWorktree,
  createWorktree,
  inspectWorktree,
} from "../../../src/team/worktree-manager";
import { createTempGitRepo } from "../helper";

let repo: ReturnType<typeof createTempGitRepo>;
let baseSha: string;
let tmp: string;
let counter = 0;

beforeEach(() => {
  repo = createTempGitRepo();
  baseSha = repo.exec("git rev-parse HEAD").trim();
  tmp = mkdtempSync(join(tmpdir(), "wt08-"));
  counter++;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  repo.cleanup();
});

test("integration-wt-08: attachWorktree rejects symlink path", () => {
  const target = mkdtempSync(join(tmpdir(), "wt08-tgt-"));
  try {
    const link = join(tmp, "link");
    symlinkSync(target, link, "dir");
    const r = attachWorktree({
      lease_id: `LEASE-WT08-sym-${counter}-${Date.now()}`,
      card_id: "TEAM-G02",
      worker_id: `MM2-wt08-${counter}`,
      repo_root: repo.path,
      worktree_path: link,
      branch: `c-wt08/sym-${counter}-${Date.now()}`,
      base_sha: baseSha,
      allowed_files: ["**/*.ts"],
      protected_files: [],
      scope_mode: "OPEN",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Either rejected because lstat sees a symlink, or because path doesn't exist as canonical.
      expect(["PATH_NOT_FOUND", "WORKTREE_MISSING", "INVALID_PATH"]).toContain(r.code);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("integration-wt-08: createWorktree rejects when path parent is outside canonical root", () => {
  // tmp is outside the repo_root and outside team-worktrees.
  const externalPath = join(tmp, `wt08-ext-${counter}-${Date.now()}`);
  const r = createWorktree({
    lease_id: `LEASE-WT08-ext-${counter}-${Date.now()}`,
    card_id: "TEAM-G02",
    worker_id: `MM2-wt08-${counter}`,
    repo_root: repo.path,
    worktree_path: externalPath,
    branch: `c-wt08/ext-${counter}-${Date.now()}`,
    base_sha: baseSha,
    allowed_files: ["**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("PATH_OUTSIDE_ROOT");
});

test("integration-wt-08: inspectWorktree rejects symlink", () => {
  const target = mkdtempSync(join(tmpdir(), "wt08-tgt2-"));
  try {
    const link = join(tmp, "inspect-link");
    symlinkSync(target, link, "dir");
    const r = inspectWorktree(link);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["PATH_NOT_DIRECTORY", "WORKTREE_MISSING"]).toContain(r.code);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
