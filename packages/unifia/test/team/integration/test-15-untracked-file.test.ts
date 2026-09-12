import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { verifyScope } from "../../../src/team/scope-monitor";

test("integration-15: untracked file detection — must be in allowed_files", () => {
  const repo = createTempGitRepo();
  // Create an untracked file.
  repo.writeFile("src/team/untracked.ts", "export const x = 1;\n");
  // The diff reader would emit change_type=untracked for that file.
  const v = verifyScope(
    {
      schema_version: "1.0.0",
      card_id: "TEAM-G01",
      lease_id: "L",
      base_sha: "0".repeat(40),
      scope_mode: "OPEN",
      allowed_files: ["src/team/untracked.ts"],
      protected_files: [],
      reserved_paths: [],
      symlink_policy: "REJECT",
      case_policy: "LENIENT",
      long_path_policy: "ALLOW",
      eol_policy: "LF_NORMALIZED",
    },
    [{ path: "src/team/untracked.ts", change_type: "untracked" }],
    repo.path,
  );
  expect(v.ok).toBe(true);
  // Now invert: NOT in allowed_files, expect OUT_OF_SCOPE.
  const v2 = verifyScope(
    {
      schema_version: "1.0.0",
      card_id: "TEAM-G01",
      lease_id: "L",
      base_sha: "0".repeat(40),
      scope_mode: "OPEN",
      allowed_files: ["src/team/lock-manager.ts"],
      protected_files: [],
      reserved_paths: [],
      symlink_policy: "REJECT",
      case_policy: "LENIENT",
      long_path_policy: "ALLOW",
      eol_policy: "LF_NORMALIZED",
    },
    [{ path: "src/team/untracked.ts", change_type: "untracked" }],
    repo.path,
  );
  expect(v2.ok).toBe(false);
  expect(v2.violations[0].code).toBe("OUT_OF_SCOPE");
  repo.cleanup();
});
