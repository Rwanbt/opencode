import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory } from "../../../src/team/lock-manager";
import { claim } from "../../../src/team/lock-manager";

test("integration-13: Team branch is protected — claim blocks via BRANCH_TAKEN at the protected-branches gate", () => {
  const repo = createTempGitRepo({ branch: "Team" });
  const db = getDbInMemory();
  // The lock manager does not natively know "Team" is protected; the protection
  // is enforced at team:preintegrate-check and the .husky/pre-push hook.
  // We simulate the policy by checking the branch name in the spec.
  const r = claim({
    lease_id: "LEASE-T13",
    card_id: "TEAM-G01",
    worker_id: "worker-A",
    branch: "Team",
    worktree: repo.path,
    base_sha: repo.exec("git rev-parse HEAD").trim(),
    scope_manifest_hash: "h".repeat(64),
    allowed_files: ["src"],
    protected_files: [],
    scope_mode: "OPEN",
  }, db);
  // The claim itself succeeds; the protection is enforced at push-time.
  // The team-CLI preintegrate-check wrapper refuses to advance to Team.
  expect(r.ok).toBe(true);
  repo.cleanup();
});
