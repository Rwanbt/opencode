import { test, expect } from "bun:test";
import { verifyScope } from "../../../src/team/scope-monitor";

test("integration-14: file outside allowed_files is reported OUT_OF_SCOPE", () => {
  const v = verifyScope(
    {
      schema_version: "1.0.0",
      card_id: "TEAM-G01",
      lease_id: "L",
      base_sha: "0".repeat(40),
      scope_mode: "OPEN",
      allowed_files: ["src/team/"],
      protected_files: [],
      reserved_paths: [],
      symlink_policy: "REJECT",
      case_policy: "LENIENT",
      long_path_policy: "ALLOW",
      eol_policy: "LF_NORMALIZED",
    },
    [{ path: "docs/secret.md", change_type: "added" }],
    "/",
  );
  expect(v.ok).toBe(false);
  expect(v.violations[0].code).toBe("OUT_OF_SCOPE");
});
