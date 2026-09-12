import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";
import { verifyScope, fileHasCrlf } from "../../../src/team/scope-monitor";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

test("integration-19: CRLF file detection", () => {
  const repo = createTempGitRepo();
  const dir = join(repo.path, "src", "team");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "crlf.ts");
  // Create parent dir then file with CRLF.
  writeFileSync(f, "export const x = 1;\r\nexport const y = 2;\r\n");
  expect(fileHasCrlf(f)).toBe(true);
  // The scope monitor's eol_policy=LF_NORMALIZED would report MIXED_EOL on the diff.
  // This test focuses on the underlying detector, which is what scope monitor delegates to.
  repo.cleanup();
});
