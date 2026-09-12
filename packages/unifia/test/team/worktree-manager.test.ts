/**
 * worktree-manager.test.ts — TEAM-G02
 *
 * Unit tests for the WorktreeManager. We exercise:
 *   - input validation paths (rejects invalid base_sha, non-absolute paths, protected branches, etc.)
 *   - path canonicalisation (rejects symlinks)
 *   - branch name validation (length, character set, protected)
 *   - listWorktrees / inspectWorktree failure modes
 *
 * Integration tests covering the full create → attach → detach flow live in
 * packages/unifia/test/team/integration/wt-*.test.ts.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

import {
  createWorktree,
  attachWorktree,
  detachWorktree,
  listWorktrees,
  inspectWorktree,
  validateWorktreeScope,
} from "../../src/team/worktree-manager";
import { getDbInMemory } from "../../src/team/lock-manager";

// Every database-reaching case receives its own in-memory DB explicitly. This
// keeps the tests hermetic without touching the on-disk leases.db.
let _isolatedDb: Database | null = null;

beforeEach(() => {
  _isolatedDb = getDbInMemory();
});

afterEach(() => {
  _isolatedDb?.close();
  _isolatedDb = null;
});

describe("worktree-manager — input validation", () => {
  test("createWorktree rejects missing lease_id", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    try {
      const r = createWorktree({
        lease_id: "",
        card_id: "TEAM-G02",
        worker_id: "MM2",
        repo_root: tmp,
        worktree_path: join(tmp, "wt"),
        branch: "c-G02/test",
        base_sha: "0".repeat(40),
        allowed_files: [],
        protected_files: [],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("createWorktree rejects non-40-hex base_sha", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    try {
      const r = createWorktree({
        lease_id: "LEASE-TEST-1",
        card_id: "TEAM-G02",
        worker_id: "MM2",
        repo_root: tmp,
        worktree_path: join(tmp, "wt"),
        branch: "c-G02/test",
        base_sha: "deadbeef",
        allowed_files: [],
        protected_files: [],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("BASE_SHA_INVALID");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("createWorktree rejects non-absolute repo_root", () => {
    const r = createWorktree({
      lease_id: "LEASE-TEST-1",
      card_id: "TEAM-G02",
      worker_id: "MM2",
      repo_root: "relative/path",
      worktree_path: "C:/abs/path",
      branch: "c-G02/test",
      base_sha: "0".repeat(40),
      allowed_files: [],
      protected_files: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PATH_NOT_ABSOLUTE");
  });

  test("createWorktree rejects branch with forbidden chars", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    try {
      const r = createWorktree({
        lease_id: "LEASE-TEST-1",
        card_id: "TEAM-G02",
        worker_id: "MM2",
        repo_root: tmp,
        worktree_path: join(tmp, "wt"),
        branch: "branch with spaces",
        base_sha: "0".repeat(40),
        allowed_files: [],
        protected_files: [],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("createWorktree rejects protected branch name (main)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    try {
      const r = createWorktree({
        lease_id: "LEASE-TEST-1",
        card_id: "TEAM-G02",
        worker_id: "MM2",
        repo_root: tmp,
        worktree_path: join(tmp, "wt"),
        branch: "main",
        base_sha: "0".repeat(40),
        allowed_files: [],
        protected_files: [],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("PROTECTED_BRANCH");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("createWorktree rejects branch > 80 chars", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    try {
      const r = createWorktree({
        lease_id: "LEASE-TEST-1",
        card_id: "TEAM-G02",
        worker_id: "MM2",
        repo_root: tmp,
        worktree_path: join(tmp, "wt"),
        branch: "a".repeat(81),
        base_sha: "0".repeat(40),
        allowed_files: [],
        protected_files: [],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("worktree-manager — attachWorktree validation", () => {
  test("attachWorktree rejects missing lease_id", () => {
    const r = attachWorktree({
      lease_id: "",
      card_id: "TEAM-G02",
      worker_id: "MM2",
      repo_root: "C:/abs",
      worktree_path: "C:/abs/wt",
      branch: "c-G02/test",
      base_sha: "0".repeat(40),
      allowed_files: [],
      protected_files: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });

  test("attachWorktree rejects when worktree_path does not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    try {
      const r = attachWorktree({
        lease_id: "LEASE-TEST-1",
        card_id: "TEAM-G02",
        worker_id: "MM2",
        repo_root: tmp,
        worktree_path: join(tmp, "nonexistent"),
        branch: "c-G02/test",
        base_sha: "0".repeat(40),
        allowed_files: [],
        protected_files: [],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("WORKTREE_MISSING");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("attachWorktree rejects symlink at worktree_path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    const target = mkdtempSync(join(tmpdir(), "wtm-ut-target-"));
    const link = join(tmp, "link");
    try {
      symlinkSync(target, link);
      const r = attachWorktree({
        lease_id: "LEASE-TEST-1",
        card_id: "TEAM-G02",
        worker_id: "MM2",
        repo_root: tmp,
        worktree_path: link,
        branch: "c-G02/test",
        base_sha: "0".repeat(40),
        allowed_files: [],
        protected_files: [],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(["PATH_NOT_FOUND", "WORKTREE_MISSING", "INVALID_PATH"]).toContain(r.code);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });
});

describe("worktree-manager — detachWorktree validation", () => {
  test("detachWorktree rejects missing lease_id", () => {
    const r = detachWorktree({ lease_id: "", worker_id: "MM2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });

  test("detachWorktree rejects missing worker_id", () => {
    const r = detachWorktree({ lease_id: "LEASE-TEST-1", worker_id: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });

  test("detachWorktree without remove_worktree requires no repo_root", () => {
    const r = detachWorktree(
      {
        lease_id: "LEASE-DOES-NOT-EXIST",
        worker_id: "MM2",
        remove_worktree: false,
      },
      _isolatedDb!,
    );
    // Should return INTERNAL because lease not found (release fails).
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["INTERNAL", "INVALID_INPUT"]).toContain(r.code);
  });
});

describe("worktree-manager — listWorktrees", () => {
  test("listWorktrees rejects non-absolute repo_root", () => {
    const r = listWorktrees("relative");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PATH_NOT_ABSOLUTE");
  });

  test("listWorktrees rejects missing repo_root", () => {
    // A literal "C:/..." path isn't absolute on POSIX, so this used to only
    // exercise the intended PATH_NOT_DIRECTORY/GIT_COMMAND_FAILED codes on
    // Windows — on Linux it hit PATH_NOT_ABSOLUTE instead (a different,
    // already-covered validation path). tmpdir() is absolute on every platform.
    const missing = join(tmpdir(), "opencode-test-nonexistent-repo-root-that-does-not-exist");
    const r = listWorktrees(missing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["PATH_NOT_DIRECTORY", "GIT_COMMAND_FAILED"]).toContain(r.code);
  });
});

describe("worktree-manager — inspectWorktree", () => {
  test("inspectWorktree rejects non-absolute path", () => {
    const r = inspectWorktree("relative");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PATH_NOT_ABSOLUTE");
  });

  test("inspectWorktree rejects missing worktree", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wtm-ut-"));
    try {
      const r = inspectWorktree(join(tmp, "nonexistent"));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(["WORKTREE_MISSING", "PATH_NOT_DIRECTORY"]).toContain(r.code);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("worktree-manager — validateWorktreeScope", () => {
  test("validateWorktreeScope rejects when lease not found", () => {
    const r = validateWorktreeScope(
      {
        lease_id: "LEASE-NONEXISTENT",
        expected_fencing_token: 1,
        manifest: {
          schema_version: "1.0.0",
          card_id: "TEAM-G02",
          lease_id: "LEASE-NONEXISTENT",
          base_sha: "0".repeat(40),
          scope_mode: "E2_REQUIRED",
          allowed_files: [],
          protected_files: [],
          reserved_paths: [],
          symlink_policy: "REJECT",
          case_policy: "REJECT_DUPLICATE_CASE",
          long_path_policy: "FAIL_OVER_260",
          eol_policy: "LF_NORMALIZED",
        },
      },
      _isolatedDb!,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INTERNAL");
  });

  test("validateWorktreeScope rejects when manifest missing", () => {
    const r = validateWorktreeScope({
      lease_id: "LEASE-NONEXISTENT",
      expected_fencing_token: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });
});
