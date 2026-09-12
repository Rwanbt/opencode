import { test, expect, beforeEach, afterEach } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim } from "../../../src/team/lock-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let db: ReturnType<typeof getDbInMemory>;

beforeEach(() => { repo = createTempGitRepo(); db = getDbInMemory(); });
afterEach(() => { repo.cleanup(); });

test("integration-04: same worktree, different branch — second fails WORKTREE_TAKEN", () => {
  const r1 = claim({
    lease_id: "LEASE-T04",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/wt-A",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r1.ok).toBe(true);
  const r2 = claim({
    lease_id: "LEASE-T04-B",
    card_id: "TEAM-G01",
    worker_id: "worker-B",
    branch: "c-G01/wt-B",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r2.ok).toBe(false);
  if (!r2.ok) expect(r2.code).toBe("WORKTREE_TAKEN");
});
