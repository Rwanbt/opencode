import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim, recover, forceRelease } from "../../../src/team/lock-manager";

test("integration-10: crash before cherry-pick — lease swept and reusable", async () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const r = claim({
    lease_id: "LEASE-T10",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/crash-cp",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
    ttl_seconds: 1,
  }, db);
  expect(r.ok).toBe(true);
  if (!r.ok) { repo.cleanup(); return; }
  await new Promise((r) => setTimeout(r, 1100));
  const rep = recover(db);
  expect(rep.expired).toContain(r.lease_id);
  // Force release then reclaim.
  const r2 = claim({
    lease_id: "LEASE-T10-B",
    card_id: "TEAM-G01",
    worker_id: "worker-B",
    branch: "c-G01/crash-cp",
    worktree: repo.path + "-other",
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r2.ok).toBe(true);
  repo.cleanup();
});
