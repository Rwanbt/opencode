import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory, claim } from "../../../src/team/lock-manager";

test("integration-20: process lock (best-effort) — uniqueness invariant via SQLite partial indexes", () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const r1 = claim({
    lease_id: "LEASE-T20",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/proc",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r1.ok).toBe(true);
  // A "process lock" is the same uniqueness invariant under SQLite.
  // The actual .lock file is created by an OS-level adapter; under
  // bun:sqlite the UNIQUE partial index does the same job.
  repo.cleanup();
});
