import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { verifyScope } from "../../../src/team/scope-monitor";

test("integration-16: husky hook missing — scope does not block on the gate (fail-open at precommit)", () => {
  // The scope monitor does not read .husky/pre-commit; the husky status is a
  // worker-side concern. This test asserts that an empty .husky/ directory
  // does not produce a scope violation when the file is excluded.
  const repo = createTempGitRepo();
  const v = verifyScope(
    {
      schema_version: "1.0.0",
      card_id: "TEAM-G01",
      lease_id: "L",
      base_sha: "0".repeat(40),
      scope_mode: "OPEN",
      allowed_files: [".husky/pre-commit"],
      protected_files: [],
      reserved_paths: [],
      symlink_policy: "REJECT",
      case_policy: "LENIENT",
      long_path_policy: "ALLOW",
      eol_policy: "LF_NORMALIZED",
      exclusions: [".husky/pre-commit"],
    },
    [{ path: ".husky/pre-commit", change_type: "modified" }],
    repo.path,
  );
  expect(v.ok).toBe(true);
  repo.cleanup();
});
