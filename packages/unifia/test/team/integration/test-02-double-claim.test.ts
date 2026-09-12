import { test, expect, beforeEach, afterEach } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim } from "../../../src/team/lock-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let db: ReturnType<typeof getDbInMemory>;

beforeEach(() => { repo = createTempGitRepo(); db = getDbInMemory(); });
afterEach(() => { repo.cleanup(); });

test("integration-02: double acquisition — second fails", () => {
  const r1 = claim({
    lease_id: "LEASE-T02-A",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/double",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r1.ok).toBe(true);
  const r2 = claim({
    lease_id: "LEASE-T02-B",
    card_id: "TEAM-G01",
    worker_id: "worker-B",
    branch: "c-G01/double",
    worktree: repo.path + "-other",
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r2.ok).toBe(false);
  if (!r2.ok) expect(r2.code).toBe("BRANCH_TAKEN");
});
