import { test, expect, beforeEach, afterEach } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim } from "../../../src/team/lock-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let db: ReturnType<typeof getDbInMemory>;

beforeEach(() => { repo = createTempGitRepo(); db = getDbInMemory(); });
afterEach(() => { repo.cleanup(); });

test("integration-01: normal acquisition on a free slot", () => {
  const r = claim({
    lease_id: "LEASE-T01",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/integration-01",
    worktree: repo.path,
    base_sha: "0000000000000000000000000000000000000000",
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src/**/*.ts"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fencing_token).toBe(1);
});
