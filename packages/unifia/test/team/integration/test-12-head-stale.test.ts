import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim, validate } from "../../../src/team/lock-manager";

test("integration-12: HEAD has drifted from declared base_sha at validate time", () => {
  const repo = createTempGitRepo();
  const db = getDbInMemory();
  const originalHead = repo.exec("git rev-parse HEAD").trim();
  const r = claim({
    lease_id: "LEASE-T12",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/head-stale",
    worktree: repo.path,
    base_sha: originalHead, // honest declaration
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r.ok).toBe(true);
  if (!r.ok) { repo.cleanup(); return; }
  // Make a commit that moves HEAD.
  repo.commit("chore: advance HEAD", { "advance.txt": "x" });
  const newHead = repo.exec("git rev-parse HEAD").trim();
  expect(newHead).not.toBe(originalHead);
  // Validate still works (lease unaffected by HEAD movement) but a separate check
  // would compare base_sha vs HEAD.
  const v = validate(r.lease_id, r.fencing_token, db);
  expect(v.ok).toBe(true);
  if (v.ok) expect(v.lease.base_sha).toBe(originalHead);
  repo.cleanup();
});
