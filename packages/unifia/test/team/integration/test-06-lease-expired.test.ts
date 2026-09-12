import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim, recover, validate } from "../../../src/team/lock-manager";

test("integration-06: lease expires when TTL elapses, recovered by recover()", async () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const r = claim({
    lease_id: "LEASE-T06",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/expire",
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
  await new Promise((r) => setTimeout(r, 1200));
  const rep = recover(db);
  expect(rep.expired).toContain(r.lease_id);
  // After recover, branch can be claimed again.
  const r2 = claim({
    lease_id: "LEASE-T06-B",
    card_id: "TEAM-G01",
    worker_id: "worker-B",
    branch: "c-G01/expire",
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
