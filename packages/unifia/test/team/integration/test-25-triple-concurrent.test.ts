import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { getDbInMemory, claim } from "../../../src/team/lock-manager";

test("integration-25: triple concurrent — only one wins on a shared branch", async () => {
  const repos = [
    createTempGitRepo(),
    createTempGitRepo(),
    createTempGitRepo(),
  ];
  const db = getDbInMemory();
  const branch = "c-G01/triple";
  const promises = repos.map((r, i) =>
    Promise.resolve(claim({
      lease_id: `LEASE-T25-${i}`,
      card_id: "TEAM-G01",
      worker_id: `worker-${i}`,
      branch,
      worktree: r.path,
      base_sha: "0".repeat(40),
      scope_manifest_hash: "h".repeat(64),
      allowed_files: ["src"],
      protected_files: [],
      scope_mode: "OPEN",
    }, db)),
  );
  const results = await Promise.all(promises);
  const oks = results.filter((r) => r.ok);
  const kos = results.filter((r) => !r.ok);
  expect(oks.length).toBe(1);
  expect(kos.length).toBe(2);
  for (const r of kos) {
    if (!r.ok) expect(r.code).toBe("BRANCH_TAKEN");
  }
  for (const r of repos) r.cleanup();
});
