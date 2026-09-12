import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim, recover } from "../../../src/team/lock-manager";

test("integration-08: crash before commit — claim is preserved, expirable", () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const r = claim({
    lease_id: "LEASE-T08",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/crash-before-commit",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
    ttl_seconds: 3600, // long enough that recover doesn't sweep
  }, db);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("claim must succeed for this test");
  // Simulate "crash": worker dies, but DB still has the lease.
  // recover() should NOT expire it (TTL still in future).
  const rep = recover(db);
  expect(rep.expired).not.toContain(r.lease_id);
  repo.cleanup();
});
