import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim, release, validate } from "../../../src/team/lock-manager";

test("integration-09: crash mid-commit — lease preserved with leftover state", () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const r = claim({
    lease_id: "LEASE-T09",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/crash-mid",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r.ok).toBe(true);
  if (!r.ok) { repo.cleanup(); return; }
  // Simulate crash mid-commit: validate works (lease is consistent), but no commit happened.
  const v = validate(r.lease_id, r.fencing_token, db);
  expect(v.ok).toBe(true);
  // Recovery is the release() call when the worker realizes the crash.
  const rel = release(r.lease_id, "worker-A", "crash-recovery", db);
  expect(rel.ok).toBe(true);
  repo.cleanup();
});
