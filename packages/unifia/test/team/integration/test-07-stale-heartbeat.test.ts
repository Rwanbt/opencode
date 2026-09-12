import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim, validate } from "../../../src/team/lock-manager";

test("integration-07: lease without heartbeat is flagged STALE", async () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const r = claim({
    lease_id: "LEASE-T07",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/stale-hb",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
    ttl_seconds: 1800,
  }, db);
  expect(r.ok).toBe(true);
  if (!r.ok) { repo.cleanup(); return; }
  // Manually rewind last_heartbeat_at to simulate stale heartbeat.
  db.prepare(`UPDATE leases SET last_heartbeat_at = ? WHERE lease_id = ?`)
    .run(new Date(Date.now() - 1000 * 60 * 16).toISOString(), r.lease_id); // 16 min ago
  const v = validate(r.lease_id, r.fencing_token, db);
  expect(v.ok).toBe(true);
  if (v.ok) expect(v.lease.stale).toBe(true);
  repo.cleanup();
});
