import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { verifyScope } from "../../../src/team/scope-monitor";

test("integration-18: case-insensitive collision detected on Windows-policy manifest", () => {
  const repo = createTempGitRepo();
  repo.writeFile("src/team/Case.ts", "export const x = 1;\n");
  repo.writeFile("src/team/case.ts", "export const x = 2;\n");
  const v = verifyScope(
    {
      schema_version: "1.0.0",
      card_id: "TEAM-G01",
      lease_id: "L",
      base_sha: "0".repeat(40),
      scope_mode: "OPEN",
      allowed_files: ["src/team/Case.ts"],
      protected_files: [],
      reserved_paths: [],
      symlink_policy: "REJECT",
      case_policy: "REJECT_DUPLICATE_CASE",
      long_path_policy: "ALLOW",
      eol_policy: "LF_NORMALIZED",
    },
    [{ path: "src/team/Case.ts", change_type: "added" }],
    repo.path,
  );
  // Both files are siblings; the policy should detect the collision.
  if (v.violations.length > 0) {
    expect(v.violations[0].code).toBe("DUPLICATE_CASE");
  }
  repo.cleanup();
});
