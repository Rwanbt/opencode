import { test, expect, beforeEach, afterEach } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim } from "../../../src/team/lock-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let db: ReturnType<typeof getDbInMemory>;

beforeEach(() => { repo = createTempGitRepo(); db = getDbInMemory(); });
afterEach(() => { repo.cleanup(); });

test("integration-03: branch already attached to a worktree blocks a second claim on same branch", () => {
  repo.setBranch("c-G01/attached");
  const r1 = claim({
    lease_id: "LEASE-T03",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/attached",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r1.ok).toBe(true);
  const r2 = claim({
    lease_id: "LEASE-T03-B",
    card_id: "TEAM-G01",
    worker_id: "worker-B",
    branch: "c-G01/attached",
    worktree: repo.path + "-other",
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r2.ok).toBe(false);
});
