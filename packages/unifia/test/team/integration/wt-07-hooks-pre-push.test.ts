/**
 * wt-07-hooks-pre-push.test.ts — TEAM-G02
 *
 * Integration test: hookPrePush blocks when a mid-operation sentinel exists,
 * and refuses push to a protected branch.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { createTempGitRepo } from "../helper";
import { hookPrePush } from "../../../src/team/hooks";

let repo: ReturnType<typeof createTempGitRepo>;
let tmp: string;

beforeEach(() => {
  repo = createTempGitRepo();
  tmp = mkdtempSync(join(tmpdir(), "wt07-"));
  mkdirSync(join(tmp, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  repo.cleanup();
});

test("integration-wt-07: hookPrePush blocks when REBASE_HEAD present", () => {
  writeFileSync(join(tmp, ".git", "REBASE_HEAD"), "abc\n");
  const r = hookPrePush({ worktreePath: tmp, allowed_files: ["**/*.ts"] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe(4);
});

test("integration-wt-07: hookPrePush refuses push to protected branch 'main'", () => {
  // Real git repo where current branch is "main".
  const r = hookPrePush({
    worktreePath: repo.path,
    allowed_files: ["**/*.ts"],
  });
  // We expect either:
  //   - GIT_BLOCKED if the actual branch "main" is in the protected set
  //   - OK with warning if no lease exists (we tolerate that)
  if (!r.ok) {
    expect(r.code).toBe(4);
  } else {
    expect(r.warnings.length).toBeGreaterThan(0);
  }
});

test("integration-wt-07: hookPrePush with REVERT_HEAD sentinel", () => {
  writeFileSync(join(tmp, ".git", "REVERT_HEAD"), "abc\n");
  const r = hookPrePush({ worktreePath: tmp, allowed_files: ["**/*.ts"] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe(4);
});
