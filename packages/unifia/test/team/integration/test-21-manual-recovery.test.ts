import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory, claim, recover, forceRelease } from "../../../src/team/lock-manager";

test("integration-21: manual recovery — operator force-releases an orphan lease", async () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const r = claim({
    lease_id: "LEASE-T21",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/orphan",
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
  // Wait for TTL.
  await new Promise((r) => setTimeout(r, 1100));
  // Sweep.
  const rep = recover(db);
  expect(rep.expired).toContain(r.lease_id);
  // Or operator force-release.
  const fr = forceRelease(r.lease_id, "MANUAL_OPERATOR", "test.operator", db);
  // After recover swept it, status is EXPIRED, not CLAIMED, so forceRelease refuses.
  expect(fr.ok).toBe(false);
  if (!fr.ok) expect(fr.code).toBe("NOT_CLAIMED");
  repo.cleanup();
});
