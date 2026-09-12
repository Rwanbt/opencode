/**
 * wt-06-hooks-pre-commit.test.ts — TEAM-G02
 *
 * Integration test: hookPreCommit blocks when a mid-operation sentinel exists
 * (CHERRY_PICK_HEAD), and passes when no sentinel exists.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hookPreCommit } from "../../../src/team/hooks";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wt06-"));
  // Simulate a .git directory with sentinel.
  mkdirSync(join(tmp, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("integration-wt-06: hookPreCommit blocks when CHERRY_PICK_HEAD present", () => {
  writeFileSync(join(tmp, ".git", "CHERRY_PICK_HEAD"), "abc123\n");
  const r = hookPreCommit({ worktreePath: tmp, allowed_files: ["**/*.ts"] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe(4);
});

test("integration-wt-06: hookPreCommit passes without sentinel and without lease", () => {
  const r = hookPreCommit({ worktreePath: tmp, allowed_files: ["**/*.ts"] });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.warnings.some((w) => w.match(/no active lease/))).toBe(true);
  }
});

test("integration-wt-06: hookPreCommit blocks when MERGE_HEAD present", () => {
  writeFileSync(join(tmp, ".git", "MERGE_HEAD"), "def456\n");
  const r = hookPreCommit({ worktreePath: tmp, allowed_files: ["**/*.ts"] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe(4);
});
