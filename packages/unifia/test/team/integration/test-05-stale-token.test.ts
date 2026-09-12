import { test, expect, beforeEach, afterEach } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim, validate } from "../../../src/team/lock-manager";

let repo: ReturnType<typeof createTempGitRepo>;
let db: ReturnType<typeof getDbInMemory>;

beforeEach(() => { repo = createTempGitRepo(); db = getDbInMemory(); });
afterEach(() => { repo.cleanup(); });

test("integration-05: stale token rejected by validate", () => {
  const r1 = claim({
    lease_id: "LEASE-T05-A",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "c-G01/stale-1",
    worktree: repo.path,
    base_sha: "0".repeat(40),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  expect(r1.ok).toBe(true);
  if (!r1.ok) return;
  // After r1, claim r2 to bump watermark (optional). Then validate r1 with the high-watermark token.
  const staleToken = r1.fencing_token - 1;
  const v = validate(r1.lease_id, staleToken, db);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.code).toBe("TOKEN_STALE");
});
